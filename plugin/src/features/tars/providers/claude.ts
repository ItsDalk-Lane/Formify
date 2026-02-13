import Anthropic from '@anthropic-ai/sdk'
import { EmbedCache } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SendRequest, Vendor } from '.'
import {
	arrayBufferToBase64,
	CALLOUT_BLOCK_END,
	CALLOUT_BLOCK_START,
	getMimeTypeFromFilename
} from './utils'
import { normalizeProviderError } from './errors'
import { withRetry } from './retry'

export interface ClaudeOptions extends BaseOptions {
	max_tokens: number
	enableWebSearch: boolean
	enableThinking: boolean
	budget_tokens: number
}

const formatMsgForClaudeAPI = async (msg: Message, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const content: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] = msg.embeds
		? await Promise.all(msg.embeds.map((embed) => formatEmbed(embed, resolveEmbedAsBinary)))
		: []

	if (msg.content.trim()) {
		content.push({
			type: 'text',
			text: msg.content
		})
	}

	return {
		role: msg.role as 'user' | 'assistant',
		content
	}
}

const formatEmbed = async (embed: EmbedCache, resolveEmbedAsBinary: ResolveEmbedAsBinary) => {
	const mimeType = getMimeTypeFromFilename(embed.link)
	if (mimeType === 'application/pdf') {
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'document',
			source: {
				type: 'base64',
				media_type: mimeType,
				data: base64Data
			}
		} as Anthropic.DocumentBlockParam
	} else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
		const embedBuffer = await resolveEmbedAsBinary(embed)
		const base64Data = arrayBufferToBase64(embedBuffer)
		return {
			type: 'image',
			source: {
				type: 'base64',
				media_type: mimeType,
				data: base64Data
			}
		} as Anthropic.ImageBlockParam
	} else {
		throw new Error(t('Only PNG, JPEG, GIF, WebP, and PDF files are supported.'))
	}
}

const sendRequestFunc = (settings: ClaudeOptions): SendRequest =>
	async function* (messages: Message[], controller: AbortController, resolveEmbedAsBinary: ResolveEmbedAsBinary) {
		try {
			const { parameters, ...optionsExcludingParams } = settings
			const options = { ...optionsExcludingParams, ...parameters }
			const {
				apiKey,
				baseURL: originalBaseURL,
				model,
				max_tokens,
				enableWebSearch: _enableWebSearch = false,
				enableThinking = false,
				budget_tokens = 1600
			} = options
			let baseURL = originalBaseURL
			if (!apiKey) throw new Error(t('API key is required'))

			// Remove /v1/messages from baseURL if present, as Anthropic SDK will add it automatically
			if (baseURL.endsWith('/v1/messages/')) {
				baseURL = baseURL.slice(0, -'/v1/messages/'.length)
			} else if (baseURL.endsWith('/v1/messages')) {
				baseURL = baseURL.slice(0, -'/v1/messages'.length)
			}

			const [system_msg, messagesWithoutSys] =
				messages[0].role === 'system' ? [messages[0], messages.slice(1)] : [null, messages]

			// Check if messagesWithoutSys only contains user or assistant roles
			messagesWithoutSys.forEach((msg) => {
				if (msg.role === 'system') {
					throw new Error('System messages are only allowed as the first message')
				}
			})

			const formattedMsgs = await Promise.all(
				messagesWithoutSys.map((msg) => formatMsgForClaudeAPI(msg, resolveEmbedAsBinary))
			)

			const client = new Anthropic({
				apiKey,
				baseURL,
				fetch: globalThis.fetch,
				dangerouslyAllowBrowser: true
			})

			const requestParams: Anthropic.MessageCreateParams = {
				model,
				max_tokens,
				messages: formattedMsgs,
				stream: true,
				...(system_msg && { system: system_msg.content }),
				...(enableThinking && {
					thinking: {
						type: 'enabled',
						budget_tokens
					}
				})
			}

			const stream = await withRetry(
				() =>
					client.messages.create(requestParams, {
						signal: controller.signal
					}),
				{ signal: controller.signal }
			)

			let startReasoning = false
			for await (const messageStreamEvent of stream) {
				// DebugLogger.debug('ClaudeNew messageStreamEvent', messageStreamEvent)

				// Handle different types of stream events
				if (messageStreamEvent.type === 'content_block_delta') {
					if (messageStreamEvent.delta.type === 'text_delta') {
						if (startReasoning) {
							startReasoning = false
							yield CALLOUT_BLOCK_END + messageStreamEvent.delta.text
						} else {
							yield messageStreamEvent.delta.text
						}
					}
					if (messageStreamEvent.delta.type === 'thinking_delta') {
						const prefix = !startReasoning ? ((startReasoning = true), CALLOUT_BLOCK_START) : ''
						yield prefix + messageStreamEvent.delta.thinking.replace(/\n/g, '\n> ') // Each line of the callout needs to have '>' at the beginning
					}
				} else if (messageStreamEvent.type === 'message_delta') {
					// Handle message-level incremental updates
					// DebugLogger.debug('Message delta received', messageStreamEvent.delta)
					// Check stop reason and notify user
					if (messageStreamEvent.delta.stop_reason) {
						const stopReason = messageStreamEvent.delta.stop_reason
						if (stopReason !== 'end_turn') {
							throw new Error(`🔴 Unexpected stop reason: ${stopReason}`)
						}
					}
				}
			}
		} catch (error) {
			throw normalizeProviderError(error, 'Claude request failed')
		}
	}

export const CLAUDE_MODELS = [
	'claude-sonnet-4-0',
	'claude-opus-4-0',
	'claude-3-7-sonnet-latest',
	'claude-3-5-sonnet-latest',
	'claude-3-opus-latest',
	'claude-3-5-haiku-latest'
]

export const claudeVendor: Vendor = {
	name: 'Claude',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://api.anthropic.com',
		model: CLAUDE_MODELS[0],
		max_tokens: 8192,
		enableWebSearch: false,
		enableThinking: false,
		budget_tokens: 1600,
		parameters: {}
	} as ClaudeOptions,
	sendRequestFunc,
	models: CLAUDE_MODELS,
	websiteToObtainKey: 'https://console.anthropic.com',
	capabilities: ['Text Generation', 'Web Search', 'Reasoning', 'Image Vision', 'PDF Vision']
}

