export type ProviderErrorType =
	| 'auth'
	| 'permission'
	| 'rate_limit'
	| 'network'
	| 'server'
	| 'invalid_request'

export type NormalizedProviderError = Error & {
	type: ProviderErrorType
	status?: number
	retryable: boolean
	isAbort?: boolean
	original?: unknown
}

const NETWORK_ERROR_PATTERN = /(network|timeout|timed out|econnreset|econnrefused|enotfound|eai_again|fetch failed|socket hang up)/i

const ABORT_ERROR_PATTERN = /(abort|aborted|cancelled|canceled|generation cancelled)/i

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const toErrorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message || ''
	if (typeof error === 'string') return error
	if (isObject(error) && typeof error.message === 'string') return error.message
	return ''
}

const tryParseStatusFromMessage = (message: string): number | undefined => {
	const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/)
	if (!statusMatch) return undefined
	const parsed = Number.parseInt(statusMatch[1], 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

const extractStatusCode = (error: unknown): number | undefined => {
	if (!isObject(error)) return undefined
	const candidates = [
		error.status,
		error.statusCode,
		isObject(error.response) ? error.response.status : undefined,
		isObject(error.cause) ? error.cause.status : undefined
	]
	for (const value of candidates) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value
		}
	}
	const message = toErrorMessage(error)
	return message ? tryParseStatusFromMessage(message) : undefined
}

export const isAbortLikeError = (error: unknown): boolean => {
	if (error instanceof Error) {
		if (error.name === 'AbortError') return true
	}
	const message = toErrorMessage(error)
	return ABORT_ERROR_PATTERN.test(message)
}

const classifyByStatus = (status: number): ProviderErrorType => {
	if (status === 401) return 'auth'
	if (status === 403) return 'permission'
	if (status === 429) return 'rate_limit'
	if (status >= 500) return 'server'
	return 'invalid_request'
}

const classifyByMessage = (message: string): ProviderErrorType => {
	if (NETWORK_ERROR_PATTERN.test(message)) return 'network'
	return 'invalid_request'
}

const isRetryableType = (type: ProviderErrorType) => {
	return type === 'rate_limit' || type === 'server' || type === 'network'
}

const createDefaultMessage = (type: ProviderErrorType, status?: number): string => {
	switch (type) {
		case 'auth':
			return status ? `Authentication failed (${status})` : 'Authentication failed'
		case 'permission':
			return status ? `Permission denied (${status})` : 'Permission denied'
		case 'rate_limit':
			return status ? `Rate limit exceeded (${status})` : 'Rate limit exceeded'
		case 'network':
			return 'Network request failed'
		case 'server':
			return status ? `Provider server error (${status})` : 'Provider server error'
		case 'invalid_request':
		default:
			return status ? `Invalid request (${status})` : 'Invalid request'
	}
}

const ensureError = (error: unknown, fallbackMessage: string) => {
	if (error instanceof Error) return error
	if (typeof error === 'string') return new Error(error)
	return new Error(fallbackMessage)
}

export const normalizeProviderError = (error: unknown, fallbackMessage = 'Provider request failed'): NormalizedProviderError => {
	if (isObject(error) && (error as NormalizedProviderError).type && typeof (error as NormalizedProviderError).retryable === 'boolean') {
		return error as NormalizedProviderError
	}

	const abortLike = isAbortLikeError(error)
	const status = extractStatusCode(error)
	const sourceMessage = toErrorMessage(error)
	const type = abortLike ? 'network' : typeof status === 'number' ? classifyByStatus(status) : classifyByMessage(sourceMessage)
	const baseError = ensureError(error, fallbackMessage)
	const message =
		sourceMessage && sourceMessage.trim().length > 0
			? sourceMessage
			: createDefaultMessage(type, status)

	const normalized = new Error(message) as NormalizedProviderError
	normalized.type = type
	normalized.status = status
	normalized.retryable = !abortLike && isRetryableType(type)
	normalized.isAbort = abortLike
	normalized.original = baseError
	return normalized
}

export const shouldRetryNormalizedError = (error: unknown): boolean => {
	const normalized = normalizeProviderError(error)
	if (normalized.isAbort) return false
	return normalized.retryable
}
