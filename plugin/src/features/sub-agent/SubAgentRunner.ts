import type { Message, ResolveEmbedAsBinary } from 'src/features/tars/providers';
import { parseContentBlocks } from 'src/features/chat/utils/markdown';
import type {
	SubAgentRunOptions,
	SubAgentRunResult,
	SubAgentRunnerDependencies,
} from './types';

const JSON_FENCE_PATTERN = /```json\s*([\s\S]*?)```/i;

export class SubAgentRunner {
	constructor(private readonly dependencies: SubAgentRunnerDependencies) {}

	async run(options: SubAgentRunOptions): Promise<SubAgentRunResult> {
		const providerConfig = this.dependencies.resolveProviderByTag(options.modelTag);
		if (!providerConfig) {
			throw new Error(`Sub-agent model tag is not configured or not found: ${options.modelTag}`);
		}

		const vendor = this.dependencies.getVendorByName(providerConfig.vendorName);
		if (!vendor) {
			throw new Error(`Sub-agent vendor not found: ${providerConfig.vendorName}`);
		}

		const messages: Message[] = [
			{ role: 'system', content: options.systemPrompt },
			{ role: 'user', content: options.userPrompt },
		];
		const sendRequest = vendor.sendRequestFunc({
			...providerConfig.options,
			enableReasoning: options.enableReasoning ?? false,
			enableThinking: options.enableThinking ?? false,
			enableWebSearch: options.enableWebSearch ?? false,
			mcpTools: options.mcpTools ?? [],
			mcpGetTools: undefined,
			mcpCallTool: options.mcpCallTool,
			mcpMaxToolCallLoops: options.mcpMaxToolCallLoops,
		});
		const controller = new AbortController();
		const timeoutId = globalThis.setTimeout(
			() => controller.abort(),
			Math.max(500, options.timeoutMs)
		);

		try {
			let content = '';
			const resolveEmbed: ResolveEmbedAsBinary = async () => new ArrayBuffer(0);
			for await (const chunk of sendRequest(messages, controller, resolveEmbed)) {
				content += chunk;
			}

			return {
				content,
				messages,
			};
		} finally {
			globalThis.clearTimeout(timeoutId);
		}
	}
}

export const extractStructuredTextContent = (content: string): string =>
	parseContentBlocks(content)
		.filter((block) => block.type === 'text')
		.map((block) => block.content)
		.join('')
		.trim();

export const parseJsonResponseFromContent = (content: string): unknown => {
	const textOnly = extractStructuredTextContent(content);
	const fenced = textOnly.match(JSON_FENCE_PATTERN)?.[1]?.trim();
	const candidates = [fenced, textOnly, extractJsonObject(textOnly)].filter(
		(value): value is string => typeof value === 'string' && value.trim().length > 0
	);

	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch {
			continue;
		}
	}

	throw new Error('Sub-agent returned an invalid JSON payload.');
};

const extractJsonObject = (value: string): string | null => {
	const firstBrace = value.indexOf('{');
	const lastBrace = value.lastIndexOf('}');
	if (firstBrace < 0 || lastBrace <= firstBrace) {
		return null;
	}
	return value.slice(firstBrace, lastBrace + 1);
};
