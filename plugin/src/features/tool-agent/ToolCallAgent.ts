import type { Vendor, Message, ResolveEmbedAsBinary, SendRequest } from 'src/features/tars/providers';
import { parseContentBlocks } from 'src/features/chat/utils/markdown';
import { ToolCallAgentPromptBuilder } from './ToolCallAgentPromptBuilder';
import { ResultProcessor } from './result-processor';
import { ToolRegistry, toolRegistry } from './registry';
import { SafetyChecker } from './safety-checker';
import { ToolSelector } from './tool-selector';
import type { ToolAgentSettings as ToolAgentSettingsConfig } from './types';
import type {
	ToolAgentProviderResolverResult,
	ToolAgentRequest,
	ToolAgentResponse,
	ToolAgentRuntimeTool,
	ToolExecutionStep,
} from './types';

export interface ToolCallAgentDependencies {
	registry?: ToolRegistry;
	selector?: ToolSelector;
	safetyChecker?: SafetyChecker;
	resultProcessor?: ResultProcessor;
	promptBuilder?: ToolCallAgentPromptBuilder;
	getSettings: () => ToolAgentSettingsConfig;
	resolveProviderByTag: (tag: string) => ToolAgentProviderResolverResult | null;
	getVendorByName: (vendorName: string) => Vendor | undefined;
	callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<string>;
	getAvailableTools: () => Promise<ToolAgentRuntimeTool[]>;
	protectedPathPrefixes?: string[];
}

const jsonFencePattern = /```json\s*([\s\S]*?)```/i;

export class ToolCallAgent {
	private readonly registry: ToolRegistry;
	private readonly selector: ToolSelector;
	private readonly safetyChecker: SafetyChecker;
	private readonly resultProcessor: ResultProcessor;
	private readonly promptBuilder: ToolCallAgentPromptBuilder;

	constructor(private readonly dependencies: ToolCallAgentDependencies) {
		this.registry = dependencies.registry ?? toolRegistry;
		this.selector = dependencies.selector ?? new ToolSelector(this.registry);
		this.safetyChecker =
			dependencies.safetyChecker ?? new SafetyChecker(dependencies.protectedPathPrefixes ?? []);
		this.resultProcessor = dependencies.resultProcessor ?? new ResultProcessor();
		this.promptBuilder = dependencies.promptBuilder ?? new ToolCallAgentPromptBuilder();
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
		const selectedTools = this.selector.selectTools(request.task, request.hints);
		const availableTools = await this.dependencies.getAvailableTools();
		const externalTools = this.selector.selectExternalTools(
			request.task,
			availableTools.filter((tool) => !this.registry.getToolByName(tool.name)),
			request.hints
		);

		const prompt = this.promptBuilder.build({
			request: {
				...request,
				constraints: mergedConstraints,
			},
			selectedTools,
			externalTools,
		});

		const providerConfig = this.dependencies.resolveProviderByTag(settings.modelTag);
		if (!providerConfig) {
			throw new Error(`Tool agent model tag is not configured or not found: ${settings.modelTag}`);
		}

		const vendor = this.dependencies.getVendorByName(providerConfig.vendorName);
		if (!vendor) {
			throw new Error(`Tool agent vendor not found: ${providerConfig.vendorName}`);
		}

		const modelTools = [
			...selectedTools.map(({ tool }) => ({
				name: tool.name,
				description: prompt.modelTools.find((item) => item.tool.name === tool.name)?.enhancedDescription ?? tool.summary,
				inputSchema: tool.inputSchema,
				serverId: tool.serverId,
			})),
			...externalTools.map((tool) => ({
				name: tool.name,
				description: prompt.modelTools.find((item) => item.tool.name === tool.name)?.enhancedDescription ?? tool.description,
				inputSchema: tool.inputSchema,
				serverId: tool.serverId,
			})),
		];

		const sendRequest = vendor.sendRequestFunc({
			...providerConfig.options,
			mcpTools: modelTools,
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

		const controller = new AbortController();
		const timeoutId = globalThis.setTimeout(() => controller.abort(), mergedConstraints.timeoutMs);
		const messages: Message[] = [
			{ role: 'system', content: prompt.systemPrompt },
			{ role: 'user', content: prompt.userPrompt },
		];

		try {
			let content = '';
			const resolveEmbed: ResolveEmbedAsBinary = async () => new ArrayBuffer(0);
			for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
				content += chunk;
			}

			const parsed = this.parseAgentResponse(content);
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
		} finally {
			globalThis.clearTimeout(timeoutId);
		}
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
				suggestion: 'Check arguments, pick a narrower tool, or ask for clarification.',
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
		const textOnly = parseContentBlocks(content)
			.filter((block) => block.type === 'text')
			.map((block) => block.content)
			.join('')
			.trim();

		const fenced = textOnly.match(jsonFencePattern)?.[1]?.trim();
		const candidates = [fenced, textOnly, this.extractJsonObject(textOnly)].filter(
			(value): value is string => typeof value === 'string' && value.trim().length > 0
		);

		for (const candidate of candidates) {
			try {
				const parsed = JSON.parse(candidate) as Record<string, unknown>;
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
				continue;
			}
		}

		return {
			status: 'success',
			summary: textOnly || 'Tool agent completed without a structured JSON payload.',
		};
	}

	private extractJsonObject(content: string): string | null {
		const first = content.indexOf('{');
		const last = content.lastIndexOf('}');
		if (first === -1 || last === -1 || last <= first) {
			return null;
		}
		return content.slice(first, last + 1);
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
