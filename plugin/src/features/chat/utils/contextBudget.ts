import type { ProviderSettings } from 'src/features/tars/providers';

export const DEFAULT_CONTEXT_LENGTH = 128000;
export const DEFAULT_OUTPUT_RESERVE_RATIO = 0.25;
export const MAX_OUTPUT_RESERVE_TOKENS = 16384;
export const AUTO_COMPACTION_TRIGGER_RATIO = 0.75;
export const AUTO_COMPACTION_TARGET_RATIO = 0.45;

export interface ResolvedContextBudget {
	contextLength: number;
	reserveForOutput: number;
	usableInputTokens: number;
	triggerTokens: number;
	targetTokens: number;
	triggerRatio: number;
	targetRatio: number;
}

const toPositiveInteger = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return null;
};

const getConfiguredOutputReserve = (
	provider: ProviderSettings | null | undefined
): number | null => {
	if (!provider) {
		return null;
	}

	const options = (provider.options ?? {}) as Record<string, unknown>;
	const parameters =
		options.parameters && typeof options.parameters === 'object'
			? (options.parameters as Record<string, unknown>)
			: {};

	const candidates = [
		options.max_output_tokens,
		options.max_tokens,
		options.maxOutputTokens,
		parameters.max_output_tokens,
		parameters.max_tokens,
		parameters.maxOutputTokens,
	];

	for (const candidate of candidates) {
		const parsed = toPositiveInteger(candidate);
		if (parsed !== null) {
			return parsed;
		}
	}

	return null;
};

export const resolveProviderContextLength = (
	provider: ProviderSettings | null | undefined
): number => {
	const resolved = toPositiveInteger(provider?.options?.contextLength);
	return resolved ?? DEFAULT_CONTEXT_LENGTH;
};

export const resolveContextBudget = (
	provider: ProviderSettings | null | undefined
): ResolvedContextBudget => {
	const contextLength = resolveProviderContextLength(provider);
	const fallbackReserve = Math.min(
		Math.floor(contextLength * DEFAULT_OUTPUT_RESERVE_RATIO),
		MAX_OUTPUT_RESERVE_TOKENS
	);
	const configuredReserve = getConfiguredOutputReserve(provider);
	const reserveUpperBound =
		contextLength > 1024
			? contextLength - 1024
			: Math.max(1, contextLength - 1);
	const reserveForOutput = Math.min(
		configuredReserve ?? fallbackReserve,
		reserveUpperBound
	);
	const usableInputTokens = Math.max(1, contextLength - reserveForOutput);

	return {
		contextLength,
		reserveForOutput,
		usableInputTokens,
		triggerTokens: Math.floor(usableInputTokens * AUTO_COMPACTION_TRIGGER_RATIO),
		targetTokens: Math.floor(usableInputTokens * AUTO_COMPACTION_TARGET_RATIO),
		triggerRatio: AUTO_COMPACTION_TRIGGER_RATIO,
		targetRatio: AUTO_COMPACTION_TARGET_RATIO,
	};
};
