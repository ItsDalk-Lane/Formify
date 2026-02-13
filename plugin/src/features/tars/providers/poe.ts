import OpenAI from 'openai'
import { Platform, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import { convertEmbedToImageUrl } from './utils'

type ContentItem =
	| {
			type: 'image_url'
			image_url: {
				url: string
			}
	  }
	| { type: 'text'; text: string }

const sendRequestFunc = (settings: BaseOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, ...remains } = options
		if (!apiKey) throw new Error(t('API key is required'))

		const formattedMessages = await Promise.all(messages.map((msg) => formatMsg(msg, resolveEmbedAsBinary)))
		// 桌面端优先走 requestUrl，规避渲染层 fetch 的 CORS/网络栈限制导致的 Connection error
		if (Platform.isDesktopApp) {
			const completionUrl = buildCompletionUrl(baseURL)
			let response: Awaited<ReturnType<typeof requestUrl>>
			try {
				response = await requestUrl({
					url: completionUrl,
					method: 'POST',
					body: JSON.stringify({
						model,
						messages: formattedMessages,
						stream: false,
						...remains
					}),
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json'
					}
				})
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				throw new Error(`Poe request failed: ${message}`)
			}

			if (response.status >= 400) {
				const apiError = response.json?.error?.message || response.text || `HTTP ${response.status}`
				throw new Error(`Poe API error (${response.status}): ${apiError}`)
			}

			const firstChoice = response.json?.choices?.[0]
			const message = firstChoice?.message ?? {}
			const text = extractMessageText(message.content)
			if (text) {
				yield text
			}
			return
		}

		// 非桌面端保留 OpenAI SDK 流式实现
		const client = new OpenAI({
			apiKey,
			baseURL,
			dangerouslyAllowBrowser: true
		})

		const stream = await client.chat.completions.create(
			{
				model,
				messages: formattedMessages as OpenAI.ChatCompletionMessageParam[],
				stream: true,
				...remains
			},
			{ signal: controller.signal }
		)

		for await (const part of stream) {
			const delta: any = part.choices[0]?.delta
			const text = delta?.content
			if (text) {
				yield text
			}
		}
	}

const formatMsg = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const base: Record<string, unknown> = {
		role: msg.role
	}

	if (msg.role === 'assistant' && typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
		base.reasoning_content = msg.reasoning_content
	}

	// Poe 的兼容层对纯文本字符串格式更稳定；只有用户消息带图片时才使用数组 content
	if (msg.role !== 'user' || !msg.embeds || msg.embeds.length === 0) {
		return {
			...base,
			content: msg.content
		}
	}

	const content: ContentItem[] = await Promise.all(msg.embeds.map((embed) => convertEmbedToImageUrl(embed, resolveEmbedAsBinary)))
	if (msg.content.trim()) {
		content.push({
			type: 'text' as const,
			text: msg.content
		})
	}

	return {
		...base,
		content
	}
}

const buildCompletionUrl = (baseURL: string) => {
	const trimmed = (baseURL || '').trim().replace(/\/+$/, '')
	if (!trimmed) return 'https://api.poe.com/v1/chat/completions'
	if (trimmed.endsWith('/chat/completions')) return trimmed
	return `${trimmed}/chat/completions`
}

const extractMessageText = (content: unknown): string => {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''

	const parts: string[] = []
	for (const item of content) {
		if (typeof item === 'string') {
			parts.push(item)
			continue
		}
		if (item && typeof item === 'object') {
			const text = (item as any).text
			if (typeof text === 'string') {
				parts.push(text)
			}
		}
	}
	return parts.join('')
}

export const poeVendor: Vendor = {
	name: 'Poe',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.poe.com/v1',
		model: 'Claude-Sonnet-4',
		parameters: {}
	},
	sendRequestFunc,
	models: [],
	websiteToObtainKey: 'https://poe.com/api_key',
	capabilities: ['Text Generation', 'Image Vision']
}
