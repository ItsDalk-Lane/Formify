import {
	SubAgentRunner,
	extractStructuredTextContent,
	parseJsonResponseFromContent,
	type ResolvedSubAgentProvider,
} from 'src/features/sub-agent';
import type { Vendor } from 'src/features/tars/providers';
import { ResultProcessor } from './result-processor';
import { SafetyChecker } from './safety-checker';
import { ToolCallAgentPromptBuilder } from './ToolCallAgentPromptBuilder';
import type { ToolAgentSettings as ToolAgentSettingsConfig } from './types';
import type {
	ToolAgentProviderResolverResult,
	ToolAgentRequest,
	ToolAgentResponse,
	ToolAgentRuntimeTool,
	ToolExecutionStep,
} from './types';

export interface ToolCallAgentDependencies {
	safetyChecker?: SafetyChecker;
	resultProcessor?: ResultProcessor;
	promptBuilder?: ToolCallAgentPromptBuilder;
	runner?: SubAgentRunner;
	getSettings: () => ToolAgentSettingsConfig;
	resolveProviderByTag: (tag: string) => ToolAgentProviderResolverResult | null;
	getVendorByName: (vendorName: string) => Vendor | undefined;
	callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<string>;
	getAvailableTools: () => Promise<ToolAgentRuntimeTool[]>;
	protectedPathPrefixes?: string[];
}

export class ToolCallAgent {
	private readonly safetyChecker: SafetyChecker;
	private readonly resultProcessor: ResultProcessor;
	private readonly promptBuilder: ToolCallAgentPromptBuilder;
	private readonly runner: SubAgentRunner;

	constructor(private readonly dependencies: ToolCallAgentDependencies) {
		this.safetyChecker =
			dependencies.safetyChecker ?? new SafetyChecker(dependencies.protectedPathPrefixes ?? []);
		this.resultProcessor = dependencies.resultProcessor ?? new ResultProcessor();
		this.promptBuilder = dependencies.promptBuilder ?? new ToolCallAgentPromptBuilder();
		this.runner = dependencies.runner ?? new SubAgentRunner({
			resolveProviderByTag: (tag) =>
				this.dependencies.resolveProviderByTag(tag) as ResolvedSubAgentProvider | null,
			getVendorByName: (vendorName) => this.dependencies.getVendorByName(vendorName),
		});
	}

	isEnabled(): boolean {
		const settings = this.dependencies.getSettings();
		return settings.enabled === true && typeof settings.modelTag === 'string' && settings.modelTag.trim().length > 0;
	}

	async execute(request: ToolAgentRequest): Promise<ToolAgentResponse> {
		const startedAt = Date.now();
		const settings = this.dependencies.getSettings();
		const mergedConstraints = {
			maxToolCalls: settings.defaultConstraints.maxToolCalls,
			timeoutMs: settings.defaultConstraints.timeoutMs,
			allowShell: settings.defaultConstraints.allowShell,
			allowScript: settings.defaultConstraints.allowScript,
			...request.constraints,
		};

		const trace: ToolExecutionStep[] = [];
		const availableTools = await this.dependencies.getAvailableTools();
		const prompt = this.promptBuilder.build({
			request: {
				...request,
				constraints: mergedConstraints,
			},
			tools: availableTools.map((tool) => ({
				name: tool.name,
				serverId: tool.serverId,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
		});

		const result = await this.runner.run({
			modelTag: settings.modelTag,
			timeoutMs: mergedConstraints.timeoutMs,
			systemPrompt: prompt.systemPrompt,
			userPrompt: prompt.userPrompt,
			mcpTools: prompt.modelTools,
			mcpCallTool: async (serverId, toolName, args) =>
				await this.executeOneToolCall(
					serverId,
					toolName,
					args,
					mergedConstraints,
					trace,
					request.task,
					request.runtime?.callTool
				),
			mcpMaxToolCallLoops: mergedConstraints.maxToolCalls,
		});

		const parsed = this.parseAgentResponse(result.content);
		return {
			status: parsed.status,
			summary: parsed.summary,
			...(parsed.data !== undefined ? { data: parsed.data } : {}),
			trace,
			...(parsed.clarificationNeeded ? { clarificationNeeded: parsed.clarificationNeeded } : {}),
			metrics: {
				toolCallCount: trace.length,
				totalTokens: 0,
				durationMs: Date.now() - startedAt,
			},
		};
	}

	private async executeOneToolCall(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
		constraints: NonNullable<ToolAgentRequest['constraints']>,
		trace: ToolExecutionStep[],
		task: string,
		callToolOverride?: (
			serverId: string,
			toolName: string,
			args: Record<string, unknown>
		) => Promise<string>
	): Promise<string> {
		const stepIndex = trace.length + 1;
		const startedAt = Date.now();
		const safety = this.safetyChecker.check(toolName, args, constraints, trace);
		if (!safety.allowed) {
			const result = JSON.stringify({
				error: safety.reason,
				suggestion: safety.suggestion,
			});
			trace.push({
				stepIndex,
				toolName,
				serverId,
				arguments: args,
				result,
				status: 'failed',
				error: safety.reason,
				durationMs: Date.now() - startedAt,
			});
			return result;
		}

		try {
			const rawResult = await (
				callToolOverride ?? this.dependencies.callTool
			)(serverId, toolName, args);
			const processed = this.resultProcessor.processResult(toolName, rawResult, { task });
			trace.push({
				stepIndex,
				toolName,
				serverId,
				arguments: args,
				result: processed.rawResult,
				status: 'success',
				durationMs: Date.now() - startedAt,
			});
			return processed.contentForModel;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const result = JSON.stringify({
				error: errorMessage,
				suggestion: 'Check arguments, choose a more precise tool, or ask for clarification.',
			});
			trace.push({
				stepIndex,
				toolName,
				serverId,
				arguments: args,
				result,
				status: 'failed',
				error: errorMessage,
				durationMs: Date.now() - startedAt,
			});
			return result;
		}
	}

	private parseAgentResponse(content: string): {
		status: ToolAgentResponse['status'];
		summary: string;
		data?: unknown;
		clarificationNeeded?: string;
	} {
		const textOnly = extractStructuredTextContent(content);

		try {
			const parsed = parseJsonResponseFromContent(content) as Record<string, unknown>;
			const status = this.normalizeStatus(parsed.status);
			const summary =
				typeof parsed.summary === 'string' && parsed.summary.trim()
					? parsed.summary.trim()
					: textOnly || 'Tool agent completed without a structured summary.';
			const clarificationNeeded =
				typeof parsed.clarificationNeeded === 'string' && parsed.clarificationNeeded.trim()
					? parsed.clarificationNeeded.trim()
					: undefined;
			return {
				status,
				summary,
				...(Object.prototype.hasOwnProperty.call(parsed, 'data') ? { data: parsed.data } : {}),
				...(clarificationNeeded ? { clarificationNeeded } : {}),
			};
		} catch {
			return {
				status: 'success',
				summary: textOnly || 'Tool agent completed without a structured JSON payload.',
			};
		}
	}

	private normalizeStatus(value: unknown): ToolAgentResponse['status'] {
		if (
			value === 'success'
			|| value === 'partial'
			|| value === 'failed'
			|| value === 'needs_clarification'
		) {
			return value;
		}
		return 'success';
	}
}
