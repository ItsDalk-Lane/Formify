import axios from 'axios'
import { Notice, Platform, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, Optional, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { DebugLogger } from '../../../utils/DebugLogger'
import { feedChunk } from './sse'

interface TokenResponse {
	access_token: string
	expires_in: number
}

interface Token {
	accessToken: string
	exp: number
	apiKey: string
	apiSecret: string
}

type QianFanOptions = BaseOptions & Pick<Optional, 'apiSecret'> & { token?: Token }

const isRetryableStatus = (status: number) => status === 429 || status >= 500
export const qianFanShouldRetryStatus = isRetryableStatus
export const qianFanComputeTokenExp = (expiresInSeconds: number, now = Date.now()) => now + expiresInSeconds * 1000

const buildQianFanApiError = (status: number, detail: string) => {
	let message = `QianFan API error (${status}): ${detail || 'Unknown error'}`
	if (status === 401) {
		message = 'QianFan authentication failed (401). Please verify API key and API secret.'
	} else if (status === 403) {
		message = 'QianFan access denied (403). Your account or key may not have permission for this model.'
	} else if (status === 429) {
		message = 'QianFan rate limit exceeded (429). Please retry later.'
	} else if (status >= 500) {
		message = `QianFan server error (${status}). Please retry later.`
	}
	const error = new Error(message) as Error & { statusCode?: number; retryable?: boolean; category?: string }
	error.statusCode = status
	error.retryable = isRetryableStatus(status)
	error.category =
		status === 401 ? 'auth' : status === 403 ? 'permission' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'invalid_request'
	return error
}
export const qianFanBuildApiError = buildQianFanApiError

const mapQianFanRequestError = (error: unknown) => {
	if (axios.isAxiosError(error)) {
		const status = error.response?.status
		if (status) {
			const detail =
				typeof error.response?.data === 'string'
					? error.response.data
					: JSON.stringify(error.response?.data ?? {})
			return buildQianFanApiError(status, detail)
		}
		const networkError = new Error(`QianFan request failed: ${error.message}`) as Error & {
			category?: string
			retryable?: boolean
		}
		networkError.category = 'network'
		networkError.retryable = true
		return networkError
	}
	return error instanceof Error ? error : new Error(String(error))
}

const createToken = async (apiKey: string, apiSecret: string) => {
	if (!apiKey || !apiSecret) throw new Error('Invalid API key secret')

	const queryParams = {
		grant_type: 'client_credentials',
		client_id: apiKey,
		client_secret: apiSecret
	}
	const queryString = new URLSearchParams(queryParams).toString()
	const res = await requestUrl(`https://aip.baidubce.com/oauth/2.0/token?${queryString}`)
	if (res.status >= 400) {
		throw buildQianFanApiError(res.status, res.text || JSON.stringify(res.json ?? {}))
	}
	const result = res.json as TokenResponse

	return {
		accessToken: result.access_token,
		exp: qianFanComputeTokenExp(result.expires_in),
		apiKey,
		apiSecret
	} as Token
}

const validOrCreate = async (currentToken: Token | undefined, apiKey: string, apiSecret: string) => {
	const now = Date.now()
	if (
		currentToken &&
		currentToken.apiKey === apiKey &&
		currentToken.apiSecret === apiSecret &&
		currentToken.exp > now + 3 * 60 * 1000
	) {
		return {
			isValid: true,
			token: currentToken
		}
	}
	const newToken = await createToken(apiKey, apiSecret)
	DebugLogger.debug('create new token', newToken)
	return {
		isValid: false,
		token: newToken
	}
}

const sendRequestFunc = (settings: QianFanOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, _resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, apiSecret, baseURL, model, token: currentToken, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!apiSecret) throw new Error(t('API secret is required'))
		if (!model) throw new Error(t('Model is required'))

		const { token } = await validOrCreate(currentToken, apiKey, apiSecret)
		settings.token = token

		if (Platform.isDesktopApp) {
			const data = {
				messages,
				stream: true,
				...remains
			}
			let response: Awaited<ReturnType<typeof axios.post>>
			try {
				response = await axios.post(baseURL + `/${model}?access_token=${token.accessToken}`, data, {
					headers: {
						'Content-Type': 'application/json'
					},
					adapter: 'fetch',
					responseType: 'stream',
					withCredentials: false,
					signal: controller.signal
				})
			} catch (error) {
				throw mapQianFanRequestError(error)
			}

			const decoder = new TextDecoder('utf-8')
			let sseRest = ''
			let shouldStop = false

			for await (const chunk of response.data) {
				const text = decoder.decode(Buffer.from(chunk), { stream: true })
				const parsed = feedChunk(sseRest, text)
				sseRest = parsed.rest
				for (const event of parsed.events) {
					if (event.isDone) {
						shouldStop = true
						break
					}
					if (event.parseError) {
						console.warn('[QianFan] Failed to parse SSE JSON:', event.parseError)
						continue
					}
					const payload = event.json as any
					const content = payload?.result
					if (content) {
						yield content
					}
				}
				if (shouldStop || parsed.done) {
					break
				}
			}

			const tailText = decoder.decode()
			if (!shouldStop) {
				const flushed = feedChunk(sseRest, `${tailText}\n\n`)
				for (const event of flushed.events) {
					if (event.isDone) break
					if (event.parseError) {
						console.warn('[QianFan] Failed to parse SSE JSON:', event.parseError)
						continue
					}
					const payload = event.json as any
					const content = payload?.result
					if (content) {
						yield content
					}
				}
			}
		} else {
			const data = {
				messages,
				stream: false,
				...remains
			}

			new Notice(t('This is a non-streaming request, please wait...'), 5 * 1000)

			const response = await requestUrl({
				url: baseURL + `/${model}?access_token=${token.accessToken}`,
				method: 'POST',
				body: JSON.stringify(data),
				headers: {
					'Content-Type': 'application/json'
				}
			})
			if (response.status >= 400) {
				throw buildQianFanApiError(response.status, response.text || JSON.stringify(response.json ?? {}))
			}

			DebugLogger.debug('response', response.json)
			yield response.json.result
		}
	}

const models = [
	'ernie-4.0-8k-latest',
	'ernie-4.0-turbo-8k',
	'ernie-3.5-128k',
	'ernie_speed',
	'ernie-speed-128k',
	'gemma_7b_it',
	'yi_34b_chat',
	'mixtral_8x7b_instruct',
	'llama_2_70b'
]

export const qianFanVendor: Vendor = {
	name: 'QianFan',
	defaultOptions: {
		apiKey: '',
		apiSecret: '',
		baseURL: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
		model: models[0],
		parameters: {}
	} as QianFanOptions,
	sendRequestFunc,
	models: models,
	websiteToObtainKey: 'https://qianfan.cloud.baidu.com',
	capabilities: ['Text Generation']
}
