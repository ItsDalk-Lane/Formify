import type { ResolveEmbedAsBinary, Vendor } from 'src/features/tars/providers';
import { parseContentBlocks } from 'src/features/chat/utils/markdown';
import { DebugLogger } from 'src/utils/DebugLogger';
import { IntentAgentPromptBuilder } from './IntentAgentPromptBuilder';
import { IntentResultValidator } from './IntentResultValidator';
import { ShortcutRules } from './rules/shortcut-rules';
import type {
	IntentAgentProviderResolverResult,
	IntentAgentSettings,
	IntentResult,
	RequestContext,
} from './types';

const jsonFencePattern = /```json\s*([\s\S]*?)```/i;

export interface IntentAgentDependencies {
	getSettings: () => IntentAgentSettings;
	resolveProviderByTag: (tag: string) => IntentAgentProviderResolverResult | null;
	getVendorByName: (vendorName: string) => Vendor | undefined;
	shortcutRules?: ShortcutRules;
	validator?: IntentResultValidator;
	promptBuilder?: IntentAgentPromptBuilder;
}

export class IntentAgent {
	private readonly shortcutRules: ShortcutRules;
	private readonly validator: IntentResultValidator;
	private readonly promptBuilder: IntentAgentPromptBuilder;

	constructor(private readonly dependencies: IntentAgentDependencies) {
		this.shortcutRules = dependencies.shortcutRules ?? new ShortcutRules();
		this.validator = dependencies.validator ?? new IntentResultValidator();
		this.promptBuilder = dependencies.promptBuilder ?? new IntentAgentPromptBuilder();
	}

	isEnabled(): boolean {
		const settings = this.dependencies.getSettings();
		return settings.enabled === true && settings.modelTag.trim().length > 0;
	}

	async recognize(context: RequestContext): Promise<IntentResult> {
		const settings = this.dependencies.getSettings();
		if (settings.shortcutRulesEnabled) {
			const shortcut = this.shortcutRules.evaluate(context);
			if (shortcut) {
				return this.validator.validate(shortcut, context, {
					confidenceThreshold: settings.confidenceThreshold,
				});
			}
		}

		if (!this.isEnabled()) {
			throw new Error('Intent agent is disabled or not configured.');
		}

		const providerConfig = this.dependencies.resolveProviderByTag(settings.modelTag);
		if (!providerConfig) {
			throw new Error(`Intent agent model tag is not configured or not found: ${settings.modelTag}`);
		}

		const vendor = this.dependencies.getVendorByName(providerConfig.vendorName);
		if (!vendor) {
			throw new Error(`Intent agent vendor not found: ${providerConfig.vendorName}`);
		}

		const systemPrompt = this.promptBuilder.buildSystemPrompt();
		const userPrompt = this.promptBuilder.buildUserPrompt(context);
		const sendRequest = vendor.sendRequestFunc({
			...providerConfig.options,
			enableReasoning: false,
			enableThinking: false,
			enableWebSearch: false,
			mcpTools: [],
			mcpGetTools: undefined,
			mcpCallTool: undefined,
			mcpMaxToolCallLoops: 0,
		} as typeof providerConfig.options);
		const controller = new AbortController();
		const timeoutId = globalThis.setTimeout(
			() => controller.abort(),
			Math.max(500, settings.timeoutMs)
		);

		try {
			let content = '';
			const resolveEmbed: ResolveEmbedAsBinary = async () => new ArrayBuffer(0);
			for await (const chunk of sendRequest(
				[
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				controller,
				resolveEmbed
			)) {
				content += chunk;
			}

			const parsed = this.parseResponse(content);
			const validated = this.validator.validate(parsed, context, {
				confidenceThreshold: settings.confidenceThreshold,
			});
			DebugLogger.debug('[IntentAgent] IntentResult', validated);
			return validated;
		} finally {
			globalThis.clearTimeout(timeoutId);
		}
	}

	private parseResponse(content: string): unknown {
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
				return JSON.parse(candidate);
			} catch {
				continue;
			}
		}

		throw new Error('Intent agent returned an invalid JSON payload.');
	}

	private extractJsonObject(value: string): string | null {
		const firstBrace = value.indexOf('{');
		const lastBrace = value.lastIndexOf('}');
		if (firstBrace < 0 || lastBrace <= firstBrace) {
			return null;
		}
		return value.slice(firstBrace, lastBrace + 1);
	}
}
