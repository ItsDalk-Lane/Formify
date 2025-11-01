import { Notice, requestUrl } from 'obsidian'
import { t } from 'tars/lang/helper'
import { BaseOptions, Message, ResolveEmbedAsBinary, SaveAttachment, SendRequest, Vendor } from '.'

const models = ['doubao-image-1']

export const DEFAULT_DOUBAO_IMAGE_OPTIONS = {
	n: 1,
	displayWidth: 400,
	size: '1024x1024'
}

export interface DoubaoImageOptions extends BaseOptions {
	displayWidth: number
	n: number
	size: '1024x1024' | '1536x1024' | '1024x1536'
}

const sendRequestFunc = (settings: DoubaoImageOptions): SendRequest =>
	async function* (
		messages: Message[],
		_controller: AbortController,
		_resolveEmbedAsBinary: ResolveEmbedAsBinary,
		saveAttachment?: SaveAttachment
	) {
		const { parameters, ...optionsExcludingParams } = settings
		const options = { ...optionsExcludingParams, ...parameters }
		const { apiKey, baseURL, model, displayWidth, n, size } = options
		
		if (!apiKey) throw new Error(t('API key is required'))
		if (!saveAttachment) throw new Error('saveAttachment is required')

		console.debug('messages:', messages)
		console.debug('options:', options)
		
		if (messages.length > 1) {
			new Notice(t('Only the last user message is used for image generation. Other messages are ignored.'))
		}
		
		const lastMsg = messages.last()
		if (!lastMsg) {
			throw new Error('No user message found in the conversation')
		}
		const prompt = lastMsg.content

		const data = {
			model,
			prompt,
			n,
			size
		}

		const response = await requestUrl({
			url: baseURL,
			method: 'POST',
			body: JSON.stringify(data),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})

		if (!response.json.data || response.json.data.length === 0) {
			throw new Error(t('Failed to generate image. no data received from API'))
		}

		yield ' \n'
		const now = new Date()
		const formatTime =
			`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
			`_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

		for (let i = 0; i < response.json.data.length; i++) {
			const imageData = response.json.data[i]
			const imageBase64 = imageData.b64_json || imageData.url
			
			if (!imageBase64) {
				console.error(`No image data returned for image ${i + 1}`)
				continue
			}

			let imageBuffer: ArrayBuffer
			if (imageData.b64_json) {
				const buffer = Buffer.from(imageBase64, 'base64')
				imageBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
			} else {
				// 如果是 URL，需要下载图片
				const imgResponse = await requestUrl({ url: imageBase64, method: 'GET' })
				imageBuffer = imgResponse.arrayBuffer
			}

			const indexFlag = n > 1 ? `-${i + 1}` : ''
			const filename = `doubaoImage-${formatTime}${indexFlag}.png`
			console.debug(`Saving image as ${filename}`)
			await saveAttachment(filename, imageBuffer)

			yield `![[${filename}|${displayWidth}]]\n\n`
		}
	}

export const doubaoImageVendor: Vendor = {
	name: 'DoubaoImage',
	defaultOptions: {
		apiKey: '',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
		model: models[0],
		n: DEFAULT_DOUBAO_IMAGE_OPTIONS.n,
		displayWidth: DEFAULT_DOUBAO_IMAGE_OPTIONS.displayWidth,
		size: DEFAULT_DOUBAO_IMAGE_OPTIONS.size,
		parameters: {}
	} as DoubaoImageOptions,
	sendRequestFunc,
	models,
	websiteToObtainKey: 'https://www.volcengine.com',
	capabilities: ['Image Generation']
}
