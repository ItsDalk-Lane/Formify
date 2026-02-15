import { Notice, requestUrl } from 'obsidian'
import OpenAI from 'openai'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'
import { buildReasoningBlockEnd, buildReasoningBlockStart, convertEmbedToImageUrl } from './utils'
import { withToolMessageContext } from './messageFormat'
import { DebugLogger } from '../../../utils/DebugLogger'
import { withOpenAIMcpToolCallSupport } from '../mcp/mcpToolCallHandler'

export interface QianFanOptions extends BaseOptions {
	enableThinking?: boolean
	imageResponseFormat?: 'url' | 'b64_json'
	imageCount?: number
	imageSize?: string
	imageDisplayWidth?: number
	// legacy field, kept for backward compatibility with old settings objects
	apiSecret?: string
}

type QianFanAPIError = Error & {
	statusCode?: number
	retryable?: boolean
	category?: string
}

type ContentItem =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| {
			type: 'text'
			text: string
	  }

const isRetryableStatus = (status: number) => status === 429 || status >= 500
export const qianFanShouldRetryStatus = isRetryableStatus
export const qianFanComputeTokenExp = (expiresInSeconds: number, now = Date.now()) => now + expiresInSeconds * 1000
export const QIANFAN_DEFAULT_BASE_URL = 'https://qianfan.baidubce.com/v2'

const buildQianFanApiError = (status: number, detail: string) => {
	let message = `QianFan API error (${status}): ${detail || 'Unknown error'}`
	if (status === 401) {
		message = 'QianFan authentication failed (401). Please verify your bearer token API key.'
	} else if (status === 403) {
		message = 'QianFan access denied (403). Your API key may not have permission for this model.'
	} else if (status === 429) {
		message = 'QianFan rate limit exceeded (429). Please retry later.'
	} else if (status >= 500) {
		message = `QianFan server error (${status}). Please retry later.`
	}
	const error = new Error(message) as QianFanAPIError
	error.statusCode = status
	error.retryable = isRetryableStatus(status)
	error.category =
		status === 401 ? 'auth' : status === 403 ? 'permission' : status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'invalid_request'
	return error
}
export const qianFanBuildApiError = buildQianFanApiError

const LEGACY_QIANFAN_RPC_PATTERN = /\/rpc\/2\.0\/ai_custom\/v1\/wenxinworkshop/i
const QIANFAN_HOST_PATTERN = /^qianfan(?:\.[a-z0-9-]+)?\.baidubce\.com$/i

const qianFanNormalizeBaseURL = (baseURL: string | undefined) => {
	const raw = (baseURL || '').trim()
	if (!raw) {
		return QIANFAN_DEFAULT_BASE_URL
	}

	let parsed: URL
	try {
		parsed = new URL(raw)
	} catch {
		return QIANFAN_DEFAULT_BASE_URL
	}

	if (/^aip\.baidubce\.com$/i.test(parsed.hostname) && LEGACY_QIANFAN_RPC_PATTERN.test(parsed.pathname)) {
		// Migrate legacy Wenxin RPC endpoint to current OpenAI-compatible endpoint.
		return QIANFAN_DEFAULT_BASE_URL
	}

	if (!QIANFAN_HOST_PATTERN.test(parsed.hostname)) {
		return QIANFAN_DEFAULT_BASE_URL
	}

	let pathname = parsed.pathname.replace(/\/+$/, '')
	pathname = pathname.replace(/\/chat\/completions$/i, '')
	pathname = pathname.replace(/\/images\/generations$/i, '')
	pathname = pathname.replace(/\/models$/i, '')
	if (!pathname || pathname === '/') {
		pathname = '/v2'
	}
	if (!/\/v2$/i.test(pathname)) {
		pathname = `${pathname}/v2`
	}
	return `${parsed.origin}${pathname}`
}
export const qianFanNormalizeBaseURLForTest = qianFanNormalizeBaseURL
export { qianFanNormalizeBaseURL }

const KNOWN_IMAGE_GENERATION_MODELS = ['qwen-image', 'flux-1-schnell', 'air-image', 'qwen-image-plus']

export const qianFanIsImageGenerationModel = (model: string) => {
	const normalized = (model || '').trim().toLowerCase()
	if (!normalized) return false
	if (KNOWN_IMAGE_GENERATION_MODELS.includes(normalized)) return true
	if (normalized.startsWith('qwen-image')) return true
	if (normalized.startsWith('flux-')) return true
	if (normalized.includes('air-image')) return true
	return false
}

const normalizeImageCount = (value: unknown, fallback = 1) => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
	return Math.min(4, Math.max(1, Math.floor(value)))
}

const inferImageExtensionFromUrl = (url: string) => {
	try {
		const pathname = new URL(url).pathname.toLowerCase()
		const matched = pathname.match(/\.(png|jpg|jpeg|webp|gif)$/)
		if (matched) {
			const ext = matched[1]
			return ext === 'jpeg' ? 'jpg' : ext
		}
	} catch {
		// ignore invalid URL
	}
	return 'png'
}

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
	buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const content: ContentItem[] = msg.embeds
		? await Promise.all(msg.embeds.map((embed) => convertEmbedToImageUrl(embed, resolveEmbedAsBinary)))
		: []

	if (msg.content.trim()) {
		content.push({
			type: 'text',
			text: msg.content
		})
	}

	if (content.length === 1 && content[0].type === 'text') {
		return withToolMessageContext(msg, {
			role: msg.role,
			content: msg.content
		})
	}

	return withToolMessageContext(msg, {
		role: msg.role,
		content
	})
}

const streamChatCompletion = async function* (
	client: OpenAI,
	messages: Message[],
	controller: AbortController,
	resolveEmbedAsBinary: ResolveEmbedAsBinary,
	options: Record<string, unknown>
) {
	const { model, enableThinking = false, ...remains } = options
	const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
	const requestPayload: Record<string, unknown> = {
		model,
		messages: formattedMessages,
		stream: true,
		...remains
	}

	if (enableThinking && requestPayload.enable_thinking === undefined) {
		requestPayload.enable_thinking = true
	}

	const stream = await client.chat.completions.create(requestPayload as OpenAI.ChatCompletionCreateParamsStreaming, {
		signal: controller.signal
	})

	let reasoningActive = false
	let reasoningStartMs: number | null = null

	for await (const part of stream as any) {
		const delta = part.choices?.[0]?.delta
		const reasoningText = String(delta?.reasoning_content ?? '')
		if (reasoningText && enableThinking) {
			if (!reasoningActive) {
				reasoningActive = true
				reasoningStartMs = Date.now()
				yield buildReasoningBlockStart(reasoningStartMs)
			}
			yield reasoningText
		}

		const content = String(delta?.content ?? '')
		if (content) {
			if (reasoningActive) {
				reasoningActive = false
				const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
				reasoningStartMs = null
				yield buildReasoningBlockEnd(durationMs)
			}
			yield content
		}
	}

	if (reasoningActive) {
		const durationMs = Date.now() - (reasoningStartMs ?? Date.now())
		yield buildReasoningBlockEnd(durationMs)
	}
}

const generateImage = async function* (
	baseURL: string,
	apiKey: string,
	model: string,
	messages: Message[],
	controller: AbortController,
	saveAttachment: SaveAttachment | undefined,
	options: Record<string, unknown>
) {
	const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user') ?? messages[messages.length - 1]
	if (!lastUserMessage?.content?.trim()) {
		throw new Error(t('No user message found for image generation'))
	}

	new Notice(t('This is a non-streaming request, please wait...'), 5 * 1000)

	const {
		imageResponseFormat = 'b64_json',
		imageCount,
		imageSize,
		imageDisplayWidth = 400,
		...remains
	} = options as QianFanOptions & Record<string, unknown>

	const payload: Record<string, unknown> = {
		model,
		prompt: lastUserMessage.content,
		n: normalizeImageCount(imageCount, 1),
		response_format: imageResponseFormat,
		...remains
	}
	if (typeof imageSize === 'string' && imageSize.trim()) {
		payload.size = imageSize.trim()
	}

	const response = await fetch(`${baseURL}/images/generations`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload),
		signal: controller.signal
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw buildQianFanApiError(response.status, errorText)
	}

	const result = (await response.json()) as {
		data?: Array<{ b64_json?: string; url?: string }>
	}
	const images = Array.isArray(result?.data) ? result.data : []
	if (images.length === 0) {
		throw new Error(t('Failed to generate image. no data received from API'))
	}

	yield ' \n'
	const now = new Date()
	const formatTime =
		`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
		`_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

	for (let i = 0; i < images.length; i++) {
		const image = images[i]
		const indexFlag = images.length > 1 ? `-${i + 1}` : ''

		if (image.b64_json) {
			if (!saveAttachment) {
				yield `📷 QianFan image generated (base64, length: ${image.b64_json.length})\n\n`
				continue
			}
			const imageBuffer = Buffer.from(image.b64_json, 'base64')
			const filename = `qianfan-${formatTime}${indexFlag}.png`
			await saveAttachment(filename, toArrayBuffer(imageBuffer))
			yield `![[${filename}|${imageDisplayWidth}]]\n\n`
			continue
		}

		if (image.url) {
			if (!saveAttachment) {
				yield `📷 ${image.url}\n\n`
				continue
			}
			const imageResponse = await requestUrl({ url: image.url, method: 'GET' })
			const ext = inferImageExtensionFromUrl(image.url)
			const filename = `qianfan-${formatTime}${indexFlag}.${ext}`
			await saveAttachment(filename, imageResponse.arrayBuffer)
			yield `![[${filename}|${imageDisplayWidth}]]\n\n`
		}
	}
}

const sendRequestFunc = (settings: QianFanOptions): SendRequest =>
	async function* (
		messages: Message[],
		controller: AbortController,
		resolveEmbedAsBinary: ResolveEmbedAsBinary,
		saveAttachment?: SaveAttachment
	) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters } as QianFanOptions & Record<string, unknown>
		const {
			apiKey,
			baseURL,
			model,
			apiSecret: _legacyApiSecret,
			imageResponseFormat,
			imageCount,
			imageSize,
			imageDisplayWidth,
			enableThinking,
			...remains
		} = options
		if (!apiKey) throw new Error(t('API key is required'))
		if (!model) throw new Error(t('Model is required'))

		const normalizedBaseURL = qianFanNormalizeBaseURL(baseURL)
		DebugLogger.debug('QianFan request options', {
			normalizedBaseURL,
			model,
			enableThinking,
			isImageGenerationModel: qianFanIsImageGenerationModel(model)
		})

		if (qianFanIsImageGenerationModel(model)) {
			yield* generateImage(
				normalizedBaseURL,
				apiKey,
				model,
				messages,
				controller,
				saveAttachment,
				{
					imageResponseFormat,
					imageCount,
					imageSize,
					imageDisplayWidth,
					...remains
				}
			)
			return
		}

		const client = new OpenAI({
			apiKey,
			baseURL: normalizedBaseURL,
			dangerouslyAllowBrowser: true
		})

		yield* streamChatCompletion(client, messages, controller, resolveEmbedAsBinary, {
			model,
			enableThinking,
			...remains
		})
	}

export const QIANFAN_TEXT_MODELS = [
	'deepseek-v3.1-250821',
	'ernie-4.5-8k-preview',
	'qwen3-235b-a22b',
	'qwen3-30b-a3b',
	'ernie-4.0-8k-latest'
]

export const QIANFAN_VISION_MODELS = [
	'deepseek-vl2',
	'ernie-4.5-vl-28b-a3b',
	'qwen3-vl-30b-a3b-instruct',
	'qwen3-vl-32b-instruct'
]

export const QIANFAN_REASONING_MODELS = ['deepseek-r1', 'qwen3-235b-a22b', 'ernie-4.5-vl-28b-a3b']

export const QIANFAN_IMAGE_MODELS = ['qwen-image', 'flux-1-schnell', 'air-image']

const dedupeModels = (models: string[]) => Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))

export const QIANFAN_MODELS = dedupeModels([
	...QIANFAN_TEXT_MODELS,
	...QIANFAN_VISION_MODELS,
	...QIANFAN_REASONING_MODELS,
	...QIANFAN_IMAGE_MODELS
])

export const qianFanVendor: Vendor = {
	name: 'QianFan',
	defaultOptions: {
		apiKey: '',
		baseURL: QIANFAN_DEFAULT_BASE_URL,
		model: QIANFAN_TEXT_MODELS[0],
		enableThinking: false,
		imageResponseFormat: 'b64_json',
		imageCount: 1,
		imageDisplayWidth: 400,
		parameters: {}
	} as QianFanOptions,
	sendRequestFunc: withOpenAIMcpToolCallSupport(sendRequestFunc),
	models: QIANFAN_MODELS,
	websiteToObtainKey: 'https://qianfan.cloud.baidu.com',
	capabilities: ['Text Generation', 'Image Vision', 'Reasoning', 'Image Generation']
}
