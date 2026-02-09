import { normalizeProviderError, shouldRetryNormalizedError, type NormalizedProviderError } from './errors'

export type RetryOptions = {
	maxRetries?: number
	baseDelayMs?: number
	maxDelayMs?: number
	jitterRatio?: number
	signal?: AbortSignal
	shouldRetry?: (error: NormalizedProviderError, attempt: number) => boolean | Promise<boolean>
	onRetry?: (error: NormalizedProviderError, attempt: number, delayMs: number) => void
}

const DEFAULT_RETRY_OPTIONS: Required<Pick<RetryOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio'>> = {
	maxRetries: 2,
	baseDelayMs: 300,
	maxDelayMs: 3000,
	jitterRatio: 0.2
}

const createAbortError = () => {
	const abortError = new Error('Request cancelled by user')
	abortError.name = 'AbortError'
	return abortError
}

const delayWithSignal = (ms: number, signal?: AbortSignal) => {
	if (ms <= 0) return Promise.resolve()
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(createAbortError())
			return
		}

		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)

		const onAbort = () => {
			clearTimeout(timer)
			reject(createAbortError())
		}

		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

const computeDelay = (attempt: number, baseDelayMs: number, maxDelayMs: number, jitterRatio: number) => {
	const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
	const jitterRange = exponential * Math.max(0, jitterRatio)
	const jitter = jitterRange === 0 ? 0 : (Math.random() * 2 - 1) * jitterRange
	return Math.max(0, Math.round(exponential + jitter))
}

export const withRetry = async <T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
	const maxRetries = options.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries
	const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_OPTIONS.baseDelayMs
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs
	const jitterRatio = options.jitterRatio ?? DEFAULT_RETRY_OPTIONS.jitterRatio
	const signal = options.signal

	let attempt = 0

	while (true) {
		if (signal?.aborted) {
			throw normalizeProviderError(createAbortError())
		}

		try {
			return await operation()
		} catch (error) {
			const normalized = normalizeProviderError(error)
			const canRetryByType = shouldRetryNormalizedError(normalized)
			const canRetryByHook = options.shouldRetry
				? await options.shouldRetry(normalized, attempt + 1)
				: true
			const canRetry = canRetryByType && canRetryByHook && attempt < maxRetries

			if (!canRetry) {
				throw normalized
			}

			const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio)
			options.onRetry?.(normalized, attempt + 1, delayMs)
			await delayWithSignal(delayMs, signal)
			attempt += 1
		}
	}
}
