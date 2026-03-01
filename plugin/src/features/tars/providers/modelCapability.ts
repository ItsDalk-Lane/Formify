export type ReasoningCapabilityState = 'supported' | 'unsupported' | 'unknown'
export type ReasoningCapabilitySource = 'metadata' | 'probe' | 'default'

export interface ReasoningCapabilityRecord {
	state: ReasoningCapabilityState
	source: ReasoningCapabilitySource
	confidence: number
	checkedAt: number
	expiresAt?: number
	thinkingModes?: string[]
	supportsReasoningEffort?: boolean
	reason?: string
}

export type ModelCapabilityCache = Record<string, ReasoningCapabilityRecord>

export interface ResolveReasoningCapabilityInput {
	vendorName: string
	baseURL?: string
	model?: string
	rawModel?: unknown
	cache?: ModelCapabilityCache
	now?: number
}

export interface ModelCapabilityProbeResult {
	state: ReasoningCapabilityState
	reason?: string
	statusCode?: number
}

export const REASONING_CAPABILITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const clampConfidence = (value: number) => Math.max(0, Math.min(1, value))

const toLowerSafe = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '')

const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s\-]+/g, '_')

const normalizeBaseURLForCache = (baseURL?: string) => {
	const trimmed = (baseURL || '').trim()
	if (!trimmed) return ''
	try {
		const parsed = new URL(trimmed)
		const pathname = parsed.pathname.replace(/\/+$/, '')
		return `${parsed.origin}${pathname}`.toLowerCase()
	} catch {
		return trimmed.replace(/\/+$/, '').toLowerCase()
	}
}

const toStringArray = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === 'string' ? item.trim() : ''))
			.filter((item) => item.length > 0)
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		return trimmed ? [trimmed] : []
	}
	return []
}

const uniqueStrings = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))

const extractThinkingModes = (rawModel: unknown): string[] | undefined => {
	if (!rawModel || typeof rawModel !== 'object') return undefined
	const raw = rawModel as Record<string, unknown>
	const candidates = [
		raw.thinking_modes,
		raw.thinkingTypes,
		raw.thinking_types,
		raw.reasoning_modes,
		raw.reasoningModes,
		raw.reasoning_types,
		raw.reasoningTypes
	]
	for (const candidate of candidates) {
		const normalized = uniqueStrings(toStringArray(candidate).map((item) => item.toLowerCase()))
		const modes = normalized.filter((mode) => mode === 'enabled' || mode === 'disabled' || mode === 'auto')
		if (modes.length > 0) return modes
	}
	return undefined
}

const extractReasoningEffortSupport = (rawModel: unknown): boolean | undefined => {
	if (!rawModel || typeof rawModel !== 'object') return undefined
	const raw = rawModel as Record<string, unknown>
	const candidates = [
		raw.supports_reasoning_effort,
		raw.supportReasoningEffort,
		raw.reasoning_effort_supported,
		raw.reasoningEffortSupported
	]
	for (const candidate of candidates) {
		if (typeof candidate === 'boolean') return candidate
	}
	return undefined
}

const findBooleanSignal = (
	value: unknown,
	keys: Set<string>,
	depth = 0
): { found: boolean; value?: boolean } => {
	if (depth > 4 || value === null || value === undefined) {
		return { found: false }
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const matched = findBooleanSignal(item, keys, depth + 1)
			if (matched.found) return matched
		}
		return { found: false }
	}

	if (typeof value !== 'object') {
		return { found: false }
	}

	for (const [rawKey, rawChild] of Object.entries(value as Record<string, unknown>)) {
		const key = normalizeKey(rawKey)
		if (keys.has(key) && typeof rawChild === 'boolean') {
			return { found: true, value: rawChild }
		}
		const matched = findBooleanSignal(rawChild, keys, depth + 1)
		if (matched.found) return matched
	}

	return { found: false }
}

const supportsReasoningFromWords = (items: string[]) => {
	if (items.length === 0) return undefined
	const normalized = items.map((item) => item.toLowerCase())
	const hasReasoning = normalized.some(
		(item) =>
			item === 'reasoning' ||
			item.includes('reasoning') ||
			item.includes('thinking') ||
			item.includes('deep_thinking')
	)
	return hasReasoning
}

const buildRecord = (
	overrides: Partial<ReasoningCapabilityRecord> & Pick<ReasoningCapabilityRecord, 'state' | 'source'>,
	now = Date.now()
): ReasoningCapabilityRecord => {
	return {
		state: overrides.state,
		source: overrides.source,
		confidence: clampConfidence(overrides.confidence ?? 0.5),
		checkedAt: overrides.checkedAt ?? now,
		expiresAt: overrides.expiresAt,
		thinkingModes: overrides.thinkingModes,
		supportsReasoningEffort: overrides.supportsReasoningEffort,
		reason: overrides.reason
	}
}

export const createUnknownReasoningCapability = (now = Date.now()): ReasoningCapabilityRecord =>
	buildRecord({
		state: 'unknown',
		source: 'default',
		confidence: 0.4,
		checkedAt: now,
		reason: 'No explicit reasoning capability signal from metadata or probe.'
	}, now)

export const buildReasoningCapabilityCacheKey = (vendorName: string, baseURL: string | undefined, model: string) => {
	const vendor = (vendorName || '').trim().toLowerCase()
	const normalizedBaseURL = normalizeBaseURLForCache(baseURL)
	const normalizedModel = (model || '').trim().toLowerCase()
	return `${vendor}|${normalizedBaseURL}|${normalizedModel}`
}

export const isReasoningCapabilityExpired = (record: ReasoningCapabilityRecord, now = Date.now()) => {
	if (typeof record.expiresAt !== 'number') return false
	return record.expiresAt <= now
}

export const readReasoningCapabilityCache = (
	cache: ModelCapabilityCache | undefined,
	key: string,
	now = Date.now()
): ReasoningCapabilityRecord | undefined => {
	if (!cache || !key) return undefined
	const record = cache[key]
	if (!record) return undefined
	if (isReasoningCapabilityExpired(record, now)) {
		return undefined
	}
	return record
}

export const pruneExpiredReasoningCapabilityCache = (
	cache: ModelCapabilityCache | undefined,
	now = Date.now()
): ModelCapabilityCache => {
	const source = cache || {}
	const pruned: ModelCapabilityCache = {}
	for (const [key, record] of Object.entries(source)) {
		if (!isReasoningCapabilityExpired(record, now)) {
			pruned[key] = record
		}
	}
	return pruned
}

export const writeReasoningCapabilityCache = (
	cache: ModelCapabilityCache | undefined,
	key: string,
	record: ReasoningCapabilityRecord,
	now = Date.now(),
	ttlMs = REASONING_CAPABILITY_CACHE_TTL_MS
): ModelCapabilityCache => {
	const merged = pruneExpiredReasoningCapabilityCache(cache, now)
	merged[key] = {
		...record,
		checkedAt: now,
		expiresAt: now + ttlMs
	}
	return merged
}

export const inferReasoningCapabilityFromMetadata = (
	vendorName: string,
	rawModel: unknown,
	now = Date.now()
): ReasoningCapabilityRecord | undefined => {
	if (!rawModel || typeof rawModel !== 'object') return undefined

	const vendor = (vendorName || '').trim().toLowerCase()
	const raw = rawModel as Record<string, unknown>

	if (vendor === 'openrouter') {
		const supportedParameters = uniqueStrings([
			...toStringArray(raw.supported_parameters),
			...toStringArray(raw.supportedParameters)
		])
		if (supportedParameters.length > 0) {
			const normalized = supportedParameters.map((item) => item.toLowerCase())
			const hasReasoning = normalized.some(
				(item) => item === 'reasoning' || item.startsWith('reasoning.') || item.startsWith('reasoning_')
			)
			return buildRecord(
				{
					state: hasReasoning ? 'supported' : 'unsupported',
					source: 'metadata',
					confidence: hasReasoning ? 0.96 : 0.9,
					reason: hasReasoning
						? 'OpenRouter supported_parameters includes reasoning.'
						: 'OpenRouter supported_parameters does not include reasoning.'
				},
				now
			)
		}
	}

	if (vendor === 'qianfan') {
		const capabilityStrings = uniqueStrings([
			...toStringArray(raw.capabilities),
			...toStringArray(raw.features),
			...toStringArray((raw.meta as Record<string, unknown> | undefined)?.capabilities),
			...toStringArray((raw.meta as Record<string, unknown> | undefined)?.features)
		])
		const capabilitySignal = supportsReasoningFromWords(capabilityStrings)
		if (typeof capabilitySignal === 'boolean') {
			return buildRecord(
				{
					state: capabilitySignal ? 'supported' : 'unsupported',
					source: 'metadata',
					confidence: capabilitySignal ? 0.9 : 0.82,
					reason: capabilitySignal
						? 'QianFan metadata capabilities include reasoning/thinking.'
						: 'QianFan metadata capabilities explicitly exclude reasoning/thinking.'
				},
				now
			)
		}

		const booleanSignal = findBooleanSignal(
			raw,
			new Set([
				'supports_reasoning',
				'support_reasoning',
				'reasoning_supported',
				'supports_thinking',
				'support_thinking',
				'thinking_supported',
				'support_deep_thinking',
				'deep_thinking_supported',
				'support_chain_of_thought',
				'chain_of_thought_supported'
			])
		)
		if (booleanSignal.found) {
			return buildRecord(
				{
					state: booleanSignal.value ? 'supported' : 'unsupported',
					source: 'metadata',
					confidence: booleanSignal.value ? 0.88 : 0.82,
					reason: `QianFan metadata boolean signal indicates ${booleanSignal.value ? 'supported' : 'unsupported'}.`
				},
				now
			)
		}
	}

	if (vendor === 'doubao') {
		const thinkingModes = extractThinkingModes(rawModel)
		const supportsReasoningEffort = extractReasoningEffortSupport(rawModel)
		if (thinkingModes && thinkingModes.length > 0) {
			const hasReasoning = thinkingModes.some((mode) => mode !== 'disabled')
			return buildRecord(
				{
					state: hasReasoning ? 'supported' : 'unsupported',
					source: 'metadata',
					confidence: hasReasoning ? 0.85 : 0.78,
					thinkingModes,
					supportsReasoningEffort,
					reason: 'Doubao metadata returned explicit thinking mode definitions.'
				},
				now
			)
		}
	}

	return undefined
}

export const resolveReasoningCapability = (input: ResolveReasoningCapabilityInput): ReasoningCapabilityRecord => {
	const now = input.now ?? Date.now()
	const model = (input.model || '').trim()
	if (!model) {
		return createUnknownReasoningCapability(now)
	}

	const metadataRecord = inferReasoningCapabilityFromMetadata(input.vendorName, input.rawModel, now)
	if (metadataRecord && metadataRecord.state !== 'unknown') {
		return metadataRecord
	}

	const cacheKey = buildReasoningCapabilityCacheKey(input.vendorName, input.baseURL, model)
	const cached = readReasoningCapabilityCache(input.cache, cacheKey, now)
	if (cached) {
		return cached
	}

	if (metadataRecord) {
		return metadataRecord
	}

	return createUnknownReasoningCapability(now)
}

const resolveErrorStatus = (error: unknown): number | undefined => {
	if (!error || typeof error !== 'object') return undefined
	const candidate = [
		(error as any).status,
		(error as any).statusCode,
		(error as any).response?.status
	].find((value) => typeof value === 'number')
	return typeof candidate === 'number' ? candidate : undefined
}

export const classifyReasoningProbeError = (error: unknown): ModelCapabilityProbeResult => {
	const statusCode = resolveErrorStatus(error)
	const message = toLowerSafe((error as any)?.message ?? error)

	if (statusCode === 401 || statusCode === 403) {
		return {
			state: 'unknown',
			statusCode,
			reason: 'Authentication/permission error cannot determine reasoning capability.'
		}
	}

	const unsupportedPatterns = [
		'not support',
		'unsupported',
		'does not support',
		'unknown parameter',
		'invalid parameter',
		'invalid_request_error',
		'reasoning',
		'thinking',
		'enable_thinking',
		'thinking_type'
	]

	const hitUnsupportedPattern = unsupportedPatterns.some((pattern) => message.includes(pattern))
	if (hitUnsupportedPattern && statusCode !== 429 && statusCode !== 500 && statusCode !== 502 && statusCode !== 503) {
		return {
			state: 'unsupported',
			statusCode,
			reason: 'Provider returned explicit reasoning/thinking unsupported signal.'
		}
	}

	return {
		state: 'unknown',
		statusCode,
		reason: 'Probe failed with non-decisive error.'
	}
}

export const createProbeCapabilityRecord = (
	result: ModelCapabilityProbeResult,
	now = Date.now()
): ReasoningCapabilityRecord => {
	if (result.state === 'supported') {
		return buildRecord(
			{
				state: 'supported',
				source: 'probe',
				confidence: 0.86,
				reason: result.reason || 'Reasoning probe succeeded.'
			},
			now
		)
	}

	if (result.state === 'unsupported') {
		return buildRecord(
			{
				state: 'unsupported',
				source: 'probe',
				confidence: 0.82,
				reason: result.reason || 'Reasoning probe returned unsupported signal.'
			},
			now
		)
	}

	return buildRecord(
		{
			state: 'unknown',
			source: 'probe',
			confidence: 0.45,
			reason: result.reason || 'Reasoning probe failed with non-decisive signal.'
		},
		now
	)
}
