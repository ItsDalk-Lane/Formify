#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const parseArgs = () => {
	const matched = process.argv.find((arg) => arg.startsWith('--pr='))
	if (!matched) return 1
	const parsed = Number.parseInt(matched.slice('--pr='.length), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

const loadTsModule = (filePath, mocks = {}) => {
	const source = fs.readFileSync(filePath, 'utf-8')
	const compiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2018,
			esModuleInterop: true
		}
	}).outputText
	const module = { exports: {} }
	const context = vm.createContext({
		module,
		exports: module.exports,
		require: (id) => {
			if (Object.prototype.hasOwnProperty.call(mocks, id)) {
				return mocks[id]
			}
			throw new Error(`Unsupported require in regression script: ${id}`)
		},
		console,
		setTimeout,
		clearTimeout,
		AbortController,
		URL,
		Buffer
	})
	new vm.Script(compiled, { filename: filePath }).runInContext(context)
	return module.exports
}

const assert = (condition, message) => {
	if (!condition) {
		throw new Error(message)
	}
}

const MCP_HANDLER_MOCK = {
	withOpenAIMcpToolCallSupport: (factory) => factory,
	toOpenAITools: (tools) => tools,
	executeMcpToolCalls: async () => []
}

const runPR1 = () => {
	const ssePath = path.resolve(ROOT, 'src/features/tars/providers/sse.ts')
	const { feedChunk } = loadTsModule(ssePath)

	{
		let rest = ''
		const allEvents = []
		for (const chunk of ['data: {"choices":[{"delta":{"content":"hel', 'lo"}}]}\n', '\n']) {
			const parsed = feedChunk(rest, chunk)
			rest = parsed.rest
			allEvents.push(...parsed.events)
		}
		assert(allEvents.length === 1, 'PR1-1: fragmented JSON should produce exactly one event')
		const payload = allEvents[0].json
		assert(payload?.choices?.[0]?.delta?.content === 'hello', 'PR1-1: fragmented JSON payload mismatch')
	}

	{
		const input = ': keepalive\n\n\n' + 'data: {"ok":true}\n\n'
		const parsed = feedChunk('', input)
		assert(parsed.events.length === 1, 'PR1-2: comments/empty lines should not emit extra events')
		assert(parsed.events[0].json?.ok === true, 'PR1-2: valid event after comments should still parse')
	}

	{
		const input = 'data: {"step":1}\n\n' + 'data: [DONE]\n\n' + 'data: {"step":2}\n\n'
		const parsed = feedChunk('', input)
		assert(parsed.done === true, 'PR1-3: parser should mark done when [DONE] appears')
		assert(parsed.events.length === 2, 'PR1-3: parser should stop emitting events after [DONE]')
		assert(parsed.events[1].isDone === true, 'PR1-3: second emitted event should be done marker')
	}

	{
		const input = 'data: {"bad":\n\n' + 'data: {"ok":2}\n\n'
		const parsed = feedChunk('', input)
		assert(parsed.events.length === 2, 'PR1-4: parser should keep later events when one JSON is invalid')
		assert(Boolean(parsed.events[0].parseError), 'PR1-4: invalid JSON event should carry parseError')
		assert(parsed.events[1].json?.ok === 2, 'PR1-4: parser should recover and parse subsequent JSON event')
	}
}

const runPR2 = () => {
	const ssePath = path.resolve(ROOT, 'src/features/tars/providers/sse.ts')
	const { feedChunk } = loadTsModule(ssePath)
	const qianFanPath = path.resolve(ROOT, 'src/features/tars/providers/qianFan.ts')
	const qianFanModule = loadTsModule(qianFanPath, {
		openai: class MockOpenAI {},
		axios: {
			post: async () => {
				throw new Error('not implemented in regression test')
			},
			isAxiosError: () => false
		},
		obsidian: {
			Notice: class {},
			Platform: { isDesktopApp: false },
			requestUrl: async () => ({ status: 200, json: {}, text: '' })
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./messageFormat': {
			withToolMessageContext: (_msg, payload) => payload
		},
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } },
		'./sse': { feedChunk }
	})

	const { qianFanComputeTokenExp, qianFanBuildApiError } = qianFanModule
	assert(
		qianFanComputeTokenExp(3600, 1_000_000) === 4_600_000,
		'PR2-1: token expiration must convert expires_in from seconds to milliseconds'
	)

	{
		const expectedTokens = Array.from({ length: 20 }, (_, index) => `token-${index}-v`)
		const sseText =
			expectedTokens.map((token) => `data: ${JSON.stringify({ result: token })}\n\n`).join('') + 'data: [DONE]\n\n'

		let seed = 7
		const nextRandom = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648
			return seed / 2147483648
		}

		const chunks = []
		let cursor = 0
		while (cursor < sseText.length) {
			const size = Math.max(1, Math.floor(nextRandom() * 13))
			chunks.push(sseText.slice(cursor, cursor + size))
			cursor += size
		}

		let rest = ''
		const outputs = []
		let stopped = false
		for (const chunk of chunks) {
			const parsed = feedChunk(rest, chunk)
			rest = parsed.rest
			for (const event of parsed.events) {
				if (event.isDone) {
					stopped = true
					break
				}
				const content = event.json?.result
				if (content) outputs.push(content)
			}
			if (stopped) break
		}

		const flushed = feedChunk(rest, '\n\n')
		for (const event of flushed.events) {
			if (event.isDone) break
			const content = event.json?.result
			if (content) outputs.push(content)
		}

		assert(
			JSON.stringify(outputs) === JSON.stringify(expectedTokens),
			'PR2-2: random fragmented SSE should not lose or duplicate QianFan stream content'
		)
	}

	{
		const authError = qianFanBuildApiError(401, 'bad key')
		assert(authError.retryable === false, 'PR2-3: 401 errors must not be retryable')
		const rateLimitError = qianFanBuildApiError(429, 'limit')
		assert(rateLimitError.retryable === true, 'PR2-3: 429 errors must be retryable')
		const serverError = qianFanBuildApiError(503, 'down')
		assert(serverError.retryable === true, 'PR2-3: 5xx errors must be retryable')
	}
}

const runPR3 = async () => {
	const geminiPath = path.resolve(ROOT, 'src/features/tars/providers/gemini.ts')
	const geminiModule = loadTsModule(geminiPath, {
		openai: class MockOpenAI {},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			arrayBufferToBase64: () => 'ZmFrZQ==',
			getMimeTypeFromFilename: () => 'image/png'
		}
	})

	const {
		geminiNormalizeOpenAIBaseURL,
		geminiBuildConfig,
		geminiIsAuthError,
		geminiBuildContents
	} = geminiModule

	assert(
		geminiNormalizeOpenAIBaseURL('https://generativelanguage.googleapis.com') ===
			'https://generativelanguage.googleapis.com/v1beta/openai',
		'PR3-1: baseURL should normalize to Gemini OpenAI-compatible endpoint'
	)
	assert(
		geminiNormalizeOpenAIBaseURL('https://generativelanguage.googleapis.com/v1beta/openai') ===
			'https://generativelanguage.googleapis.com/v1beta/openai',
		'PR3-1: existing OpenAI-compatible endpoint should remain unchanged'
	)

	const mappedConfig = geminiBuildConfig({ max_tokens: 2048, temperature: 0.4 })
	assert(mappedConfig.maxOutputTokens === 2048, 'PR3-2: max_tokens should map to maxOutputTokens')
	assert(mappedConfig.max_tokens === undefined, 'PR3-2: max_tokens should be removed after mapping')

	assert(geminiIsAuthError({ status: 401 }) === true, 'PR3-3: 401 should be recognized as auth error')
	assert(geminiIsAuthError({ message: 'invalid api key' }) === true, 'PR3-3: api key error text should be recognized')
	assert(geminiIsAuthError({ message: 'timeout' }) === false, 'PR3-3: non-auth error should not be misclassified')

	const result = await geminiBuildContents(
		[
			{ role: 'system', content: 'you are system' },
			{ role: 'user', content: 'first question' },
			{ role: 'assistant', content: 'first answer' },
			{ role: 'user', content: 'second question', embeds: [{ link: 'a.png' }] }
		],
		async () => new ArrayBuffer(8)
	)

	assert(result.systemInstruction === 'you are system', 'PR3-4: system message should map to systemInstruction')
	assert(result.contents.length === 3, 'PR3-4: non-system history should remain in order')
	assert(result.contents[0].role === 'user', 'PR3-4: first history message role mismatch')
	assert(result.contents[1].role === 'model', 'PR3-4: assistant role should map to model')
	assert(
		Boolean(result.contents[2].parts.find((part) => Boolean(part.inlineData))),
		'PR3-4: image embeds should be preserved as inlineData parts'
	)
}

const runPR4 = () => {
	const openAIPath = path.resolve(ROOT, 'src/features/tars/providers/openAI.ts')
	const openAIModule = loadTsModule(openAIPath, {
		openai: class MockOpenAI {},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			buildToolCallsBlock: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./messageFormat': {
			withToolMessageContext: (_msg, payload) => payload
		},
		'./errors': {
			normalizeProviderError: (error) => error
		},
		'./retry': {
			withRetry: async (operation) => operation()
		}
	})
	assert(
		openAIModule.openAIUseResponsesAPI({ enableReasoning: true }) === true,
		'PR4-1: OpenAI should route to responses when reasoning is enabled'
	)
	assert(
		openAIModule.openAIUseResponsesAPI({ enableReasoning: false }) === false,
		'PR4-1: OpenAI should keep chat path when reasoning is disabled'
	)
	const openAIParams = openAIModule.openAIMapResponsesParams({ max_tokens: 256, temperature: 0.2 })
	assert(openAIParams.max_output_tokens === 256, 'PR4-2: OpenAI max_tokens should map to max_output_tokens')
	assert(openAIParams.max_tokens === undefined, 'PR4-2: OpenAI mapped params should drop max_tokens')

	const azurePath = path.resolve(ROOT, 'src/features/tars/providers/azure.ts')
	const azureModule = loadTsModule(azurePath, {
		openai: { AzureOpenAI: class MockAzureOpenAI {} },
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => ''
		},
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } }
	})
	assert(
		azureModule.azureUseResponsesAPI({ enableReasoning: true }) === true,
		'PR4-3: Azure should route to responses when reasoning is enabled'
	)
	const azureParams = azureModule.azureMapResponsesParams({ max_tokens: 1024 })
	assert(azureParams.max_output_tokens === 1024, 'PR4-3: Azure max_tokens should map to max_output_tokens')

	const grokPath = path.resolve(ROOT, 'src/features/tars/providers/grok.ts')
	const grokModule = loadTsModule(grokPath, {
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./sse': { feedChunk: () => ({ events: [], rest: '', done: false }) }
	})
	assert(grokModule.grokUseResponsesAPI({ enableReasoning: true }) === true, 'PR4-4: Grok should use responses with reasoning')
	assert(
		grokModule.grokResolveEndpoint('https://api.x.ai/v1/chat/completions', true) ===
			'https://api.x.ai/v1/responses',
		'PR4-4: Grok endpoint should switch from chat/completions to responses'
	)
	assert(
		grokModule.grokResolveEndpoint('https://api.x.ai/v1/chat/completions', false) ===
			'https://api.x.ai/v1/chat/completions',
		'PR4-4: Grok endpoint should keep chat/completions when reasoning is disabled'
	)
}

const runPR5 = () => {
	const messageFormatPath = path.resolve(ROOT, 'src/features/tars/providers/messageFormat.ts')
	const { withToolMessageContext } = loadTsModule(messageFormatPath, {
		'.': {}
	})

	const toolCalls = [
		{
			id: 'call_weather',
			type: 'function',
			function: { name: 'weather', arguments: '{"city":"beijing"}' }
		},
		{
			id: 'call_time',
			type: 'function',
			function: { name: 'time', arguments: '{"timezone":"UTC"}' }
		}
	]

	const assistantPayload = withToolMessageContext(
		{
			role: 'assistant',
			content: '',
			tool_calls: toolCalls,
			reasoning_content: 'need tools'
		},
		{
			role: 'assistant',
			content: ''
		}
	)
	assert(Array.isArray(assistantPayload.tool_calls), 'PR5-1: assistant tool_calls should be preserved')
	assert(assistantPayload.tool_calls.length === 2, 'PR5-1: parallel tool_calls should remain isolated')
	assert(
		assistantPayload.tool_calls[0].function.arguments === '{"city":"beijing"}',
		'PR5-1: first tool call arguments should remain unchanged'
	)
	assert(
		assistantPayload.tool_calls[1].function.arguments === '{"timezone":"UTC"}',
		'PR5-1: second tool call arguments should remain unchanged'
	)
	assert(assistantPayload.reasoning_content === 'need tools', 'PR5-1: assistant reasoning_content should be preserved')

	const toolPayload = withToolMessageContext(
		{
			role: 'tool',
			content: '{"temp": 23}',
			tool_call_id: 'call_weather'
		},
		{
			role: 'tool',
			content: '{"temp": 23}'
		}
	)
	assert(toolPayload.tool_call_id === 'call_weather', 'PR5-2: tool message should carry tool_call_id')

	const openAIFile = fs.readFileSync(path.resolve(ROOT, 'src/features/tars/providers/openAI.ts'), 'utf-8')
	const openRouterFile = fs.readFileSync(path.resolve(ROOT, 'src/features/tars/providers/openRouter.ts'), 'utf-8')
	const siliconFlowFile = fs.readFileSync(path.resolve(ROOT, 'src/features/tars/providers/siliconflow.ts'), 'utf-8')
	assert(openAIFile.includes('withToolMessageContext'), 'PR5-3: OpenAI should use withToolMessageContext')
	assert(openRouterFile.includes('withToolMessageContext'), 'PR5-3: OpenRouter should use withToolMessageContext')
	assert(siliconFlowFile.includes('withToolMessageContext'), 'PR5-3: SiliconFlow should use withToolMessageContext')
}

const runPR6 = () => {
	const settingTabText = fs.readFileSync(path.resolve(ROOT, 'src/features/tars/settingTab.ts'), 'utf-8')
	for (const vendorName of ['claudeVendor.name', 'qwenVendor.name', 'zhipuVendor.name', 'deepSeekVendor.name', 'qianFanVendor.name']) {
		assert(
			settingTabText.includes(`[${vendorName}]`),
			`PR6-1: MODEL_FETCH_CONFIGS should include ${vendorName}`
		)
	}
	assert(
		settingTabText.includes('fallbackModels'),
		'PR6-1: model fetch configs should define fallbackModels for remote fetch failures'
	)
	assert(
		settingTabText.includes('resolveQianFanModelListURL') &&
			settingTabText.includes('qianFanNormalizeBaseURL(baseURL)'),
		'PR6-2: QianFan model fetching should derive OpenAI-compatible /v2/models from normalized baseURL'
	)
	assert(
		settingTabText.includes('/api/v3/models'),
		'PR6-2: DoubaoImage model fetching should try Ark /api/v3/models endpoint first'
	)

	const qwenPath = path.resolve(ROOT, 'src/features/tars/providers/qwen.ts')
	const qwenModule = loadTsModule(qwenPath, {
		openai: class MockOpenAI {},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		}
	})
	assert(
		qwenModule.qwenVendor.defaultOptions.model === 'qwen-plus-latest',
		'PR6-3: Qwen default model should be updated to a newer compatible default'
	)

	const zhipuPath = path.resolve(ROOT, 'src/features/tars/providers/zhipu.ts')
	const zhipuModule = loadTsModule(zhipuPath, {
		openai: class MockOpenAI {},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } },
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => ''
		}
	})
	assert(
		zhipuModule.zhipuVendor.defaultOptions.model === 'glm-4.6',
		'PR6-3: Zhipu default model should be updated to a newer compatible default'
	)
}

const runPR7 = async () => {
	const errorsPath = path.resolve(ROOT, 'src/features/tars/providers/errors.ts')
	const errorsModule = loadTsModule(errorsPath)
	const retryPath = path.resolve(ROOT, 'src/features/tars/providers/retry.ts')
	const retryModule = loadTsModule(retryPath, {
		'./errors': errorsModule
	})

	const authError = errorsModule.normalizeProviderError({ status: 401, message: 'bad key' })
	assert(authError.type === 'auth', 'PR7-1: 401 should classify as auth error')
	assert(authError.retryable === false, 'PR7-1: auth errors must not be retryable')

	let attempts = 0
	const retryResult = await retryModule.withRetry(
		async () => {
			attempts += 1
			if (attempts < 2) {
				const error = new Error('rate limited')
				error.status = 429
				throw error
			}
			return 'ok'
		},
		{ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 }
	)
	assert(retryResult === 'ok', 'PR7-2: retry should eventually return success for retryable 429 errors')
	assert(attempts === 2, 'PR7-2: retry should perform one retry for initial 429 failure')

	const abortController = new AbortController()
	abortController.abort()
	let abortAttempts = 0
	let abortThrown = false
	try {
		await retryModule.withRetry(
			async () => {
				abortAttempts += 1
				const error = new Error('network timeout')
				error.name = 'TypeError'
				throw error
			},
			{ signal: abortController.signal, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 }
		)
	} catch (error) {
		abortThrown = true
		const normalized = errorsModule.normalizeProviderError(error)
		assert(normalized.isAbort === true, 'PR7-3: aborted requests should be marked as user cancellation')
	}
	assert(abortThrown, 'PR7-3: aborted requests should throw immediately')
	assert(abortAttempts === 0, 'PR7-3: aborted requests should not retry user-cancelled operations')

	for (const file of [
		'src/features/tars/providers/openAI.ts',
		'src/features/tars/providers/openRouter.ts',
		'src/features/tars/providers/claude.ts',
		'src/features/tars/providers/doubao.ts'
	]) {
		const source = fs.readFileSync(path.resolve(ROOT, file), 'utf-8')
		assert(source.includes('withRetry'), `PR7-4: ${file} should integrate shared retry helper`)
		assert(source.includes('normalizeProviderError'), `PR7-4: ${file} should integrate shared error normalization`)
	}
}

const runPR8 = () => {
	const openRouterPath = path.resolve(ROOT, 'src/features/tars/providers/openRouter.ts')
	const openRouterSource = fs.readFileSync(openRouterPath, 'utf-8')
	assert(
		openRouterSource.includes('data.response_format = imageResponseFormat'),
		'PR8-1: OpenRouter imageResponseFormat must be written into request body response_format'
	)

	const settingTabPath = path.resolve(ROOT, 'src/features/tars/settingTab.ts')
	const settingTabSource = fs.readFileSync(settingTabPath, 'utf-8')
	assert(
		settingTabSource.includes('response_format 字段'),
		'PR8-2: settings should explain that imageResponseFormat maps to request body response_format'
	)
	assert(
		settingTabSource.includes('参数生效范围'),
		'PR8-2: settings should include effective-scope hints for model-specific parameters'
	)

	const compatibilityDocPath = path.resolve(ROOT, '../docs/provider-compatibility.md')
	assert(fs.existsSync(compatibilityDocPath), 'PR8-3: docs/provider-compatibility.md must exist')
	const compatibilityDoc = fs.readFileSync(compatibilityDocPath, 'utf-8')
	assert(
		compatibilityDoc.includes('chat.completions') && compatibilityDoc.includes('responses'),
		'PR8-3: compatibility document should include chat/responses routing notes'
	)

	const readmePath = path.resolve(ROOT, '../README.md')
	const readmeText = fs.readFileSync(readmePath, 'utf-8')
	assert(
		readmeText.includes('docs/provider-compatibility.md'),
		'PR8-4: README should link to provider compatibility document'
	)
	assert(
		readmeText.includes('chat.completions -> responses'),
		'PR8-4: README should include migration notes for chat to responses routing'
	)
}

const runPR9 = () => {
	const qianFanPath = path.resolve(ROOT, 'src/features/tars/providers/qianFan.ts')
	const qianFanModule = loadTsModule(qianFanPath, {
		openai: class MockOpenAI {},
		obsidian: {
			Notice: class {},
			requestUrl: async () => ({ status: 200, json: {}, text: '', arrayBuffer: new ArrayBuffer(0) })
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./messageFormat': {
			withToolMessageContext: (_msg, payload) => payload
		},
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } }
	})

	assert(
		qianFanModule.qianFanVendor.defaultOptions.baseURL === 'https://qianfan.baidubce.com/v2',
		'PR9-1: QianFan default baseURL should use official /v2 endpoint'
	)
	assert(
		qianFanModule.qianFanNormalizeBaseURLForTest('https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat') ===
			'https://qianfan.baidubce.com/v2',
		'PR9-1: legacy Wenxin RPC baseURL should migrate to official /v2 endpoint'
	)
	assert(
		qianFanModule.qianFanNormalizeBaseURLForTest('https://qianfan.bj.baidubce.com/v2/chat/completions') ===
			'https://qianfan.bj.baidubce.com/v2',
		'PR9-1: regional QianFan baseURL should normalize to /v2 root'
	)
	assert(
		!Object.prototype.hasOwnProperty.call(qianFanModule.qianFanVendor.defaultOptions, 'apiSecret'),
		'PR9-1: QianFan default options should no longer require API secret'
	)
	assert(
		qianFanModule.qianFanIsImageGenerationModel('qwen-image') === true,
		'PR9-2: qwen-image should be recognized as QianFan image generation model'
	)
	assert(
		qianFanModule.qianFanIsImageGenerationModel('deepseek-vl2') === false,
		'PR9-2: deepseek-vl2 should stay on chat/vision path instead of image generation endpoint'
	)
	assert(
		qianFanModule.qianFanVendor.capabilities.includes('Image Vision') &&
			qianFanModule.qianFanVendor.capabilities.includes('Reasoning') &&
			qianFanModule.qianFanVendor.capabilities.includes('Image Generation'),
		'PR9-3: QianFan capabilities should include vision, reasoning, and image generation'
	)

	const settingTabPath = path.resolve(ROOT, 'src/features/tars/settingTab.ts')
	const settingTabSource = fs.readFileSync(settingTabPath, 'utf-8')
	assert(
		settingTabSource.includes('resolveQianFanModelListURL'),
		'PR9-4: QianFan model list fetching should resolve official /v2/models URL'
	)
	assert(
		settingTabSource.includes('qianFanNormalizeBaseURL(baseURL)'),
		'PR9-4: QianFan model list URL should reuse provider baseURL normalization'
	)
}

const runPR10 = () => {
	const poePath = path.resolve(ROOT, 'src/features/tars/providers/poe.ts')
	const poeModule = loadTsModule(poePath, {
		openai: class MockOpenAI {},
		obsidian: {
			Platform: { isDesktopApp: false },
			requestUrl: async () => ({ status: 200, json: {}, text: '' })
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'./errors': {
			normalizeProviderError: (error, prefix = 'error') =>
				error instanceof Error ? new Error(`${prefix}: ${error.message}`) : new Error(String(error))
		},
		'./retry': {
			withRetry: async (operation) => operation()
		},
		'./sse': { feedChunk: () => ({ events: [], rest: '', done: false }) },
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		}
	})

	const mapped = poeModule.poeMapResponsesParams({ max_tokens: 2048, temperature: 0.3 })
	assert(mapped.max_output_tokens === 2048, 'PR10-1: Poe max_tokens should map to max_output_tokens')
	assert(mapped.max_tokens === undefined, 'PR10-1: Poe mapped params should drop max_tokens')
	assert(
		poeModule.poeResolveResponsesURL('https://api.poe.com/v1/chat/completions') ===
			'https://api.poe.com/v1/responses',
		'PR10-2: Poe responses URL should convert from chat/completions'
	)
	assert(
		poeModule.poeResolveChatCompletionsURL('https://api.poe.com/v1/responses') ===
			'https://api.poe.com/v1/chat/completions',
		'PR10-2: Poe chat URL should convert from responses'
	)
	assert(
		poeModule.poeVendor.defaultOptions.enableReasoning === false,
		'PR10-3: Poe default options should disable reasoning by default'
	)
	assert(
		poeModule.poeVendor.defaultOptions.enableWebSearch === false,
		'PR10-3: Poe default options should disable web search by default'
	)
	assert(
		poeModule.poeVendor.capabilities.includes('Web Search') &&
			poeModule.poeVendor.capabilities.includes('Reasoning'),
		'PR10-3: Poe capabilities should include Web Search and Reasoning'
	)
	const poeSource = fs.readFileSync(poePath, 'utf-8')
	assert(
		poeSource.includes('shouldRetryFunctionOutputTurn400'),
		'PR10-3: Poe should include 400 compatibility retry for function_call_output turns'
	)
	assert(
		poeSource.includes('toToolResultContinuationInput'),
		'PR10-3: Poe should convert function_call_output turns to message input when provider requires protocol messages'
	)
	assert(
		poeSource.includes("message.includes('protocol_messages')"),
		'PR10-3: Poe should detect protocol_messages compatibility errors for function_call_output retry'
	)
	assert(
		poeSource.includes('throw: false'),
		'PR10-3: Poe requestUrl path should keep non-2xx response body for diagnostics'
	)
	assert(
		poeSource.includes('error.status = response.status'),
		'PR10-3: Poe requestUrl errors should expose status for retry classification'
	)
	assert(
		poeSource.includes('parsePoeJsonResponseText'),
		'PR10-3: Poe requestUrl path should parse response text safely without relying on response.json'
	)
	assert(
		poeSource.includes('if (hasMcpToolRuntime)') &&
			poeSource.includes('runResponsesWithDesktopRequestUrl()'),
		'PR10-3: Poe should route MCP runtime through requestUrl responses loop for stable continuation handling'
	)
	assert(
		poeSource.includes('POE_RETRY_OPTIONS') &&
			poeSource.includes('baseDelayMs: 250') &&
			poeSource.includes('withRetry('),
		'PR10-3: Poe should apply exponential retry for transient 429/5xx errors'
	)

	const settingTabPath = path.resolve(ROOT, 'src/features/tars/settingTab.ts')
	const settingTabSource = fs.readFileSync(settingTabPath, 'utf-8')
	assert(
		settingTabSource.includes('[poeVendor.name]'),
		'PR10-4: MODEL_FETCH_CONFIGS should include Poe'
	)
	assert(
		settingTabSource.includes('resolvePoeModelListURL'),
		'PR10-4: settingTab should define resolvePoeModelListURL helper'
	)
	assert(
		settingTabSource.includes('https://api.poe.com/v1/models'),
		'PR10-4: Poe model list should fall back to official /v1/models endpoint'
	)
}

const runPR11 = async () => {
	const mcpPath = path.resolve(ROOT, 'src/features/tars/mcp/mcpToolCallHandler.ts')
	const streamQueue = []
	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async () => {
						const parts = streamQueue.shift()
						if (!parts) {
							throw new Error('PR11 mock stream queue is empty')
						}
						return (async function* () {
							for (const part of parts) {
								yield part
							}
						})()
					}
				}
			}
		}
	}

	const mcpModule = loadTsModule(mcpPath, {
		openai: MockOpenAI,
		'src/utils/DebugLogger': {
			DebugLogger: {
				debug: () => {},
				warn: () => {},
				error: () => {}
			}
		},
		'./toolHints': {
			getBuiltinToolHint: () => undefined
		},
		'../providers': {},
		'../providers/utils': {
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			REASONING_BLOCK_START_MARKER: '{{FF_REASONING_START}}',
			REASONING_BLOCK_END_MARKER: '{{FF_REASONING_END}}',
			formatReasoningDuration: () => '0.00s'
		}
	})

	const { withOpenAIMcpToolCallSupport } = mcpModule

	const wrappedFactory = withOpenAIMcpToolCallSupport(() =>
		async function* () {
			yield 'fallback'
		}
	)

	const sendRequest = wrappedFactory({
		apiKey: 'test-key',
		baseURL: 'https://openrouter.ai/api/v1/chat/completions',
		model: 'openrouter/test-model',
		parameters: {},
		enableReasoning: true,
		mcpTools: [{
			name: 'mock_tool',
			description: 'mock tool',
			inputSchema: { type: 'object', properties: {} },
			serverId: 'mock-server'
		}],
		mcpCallTool: async () => 'ok'
	})

	const collectOutput = async (parts) => {
		streamQueue.push(parts)
		let output = ''
		for await (const chunk of sendRequest(
			[{ role: 'user', content: 'test question' }],
			new AbortController(),
			async () => new ArrayBuffer(0)
		)) {
			output += chunk
		}
		return output
	}

	{
		const output = await collectOutput([
			{ choices: [{ delta: { reasoning: '先分析问题' } }] },
			{ choices: [{ delta: { content: '最终答案A' } }] }
		])
		assert(
			output.includes('{{FF_REASONING_START}}') && output.includes(':{{FF_REASONING_END}}:'),
			'PR11-1: delta.reasoning should render reasoning block markers'
		)
		assert(output.includes('先分析问题'), 'PR11-1: delta.reasoning text should be streamed')
		assert(output.includes('最终答案A'), 'PR11-1: final answer should still be streamed')
	}

	{
		const output = await collectOutput([
			{
				choices: [{
					delta: {
						reasoning_details: [
							{ type: 'reasoning_text', text: '细节推理内容' },
							{ type: 'summary', summary_text: '摘要片段' }
						]
					}
				}]
			},
			{ choices: [{ delta: { content: '最终答案B' } }] }
		])
		assert(
			output.includes('{{FF_REASONING_START}}') && output.includes(':{{FF_REASONING_END}}:'),
			'PR11-2: delta.reasoning_details should render reasoning block markers'
		)
		assert(
			output.includes('细节推理内容') || output.includes('摘要片段'),
			'PR11-2: delta.reasoning_details should be converted to visible reasoning text'
		)
		assert(output.includes('最终答案B'), 'PR11-2: final answer should still be streamed')
	}
}

const runPR12 = () => {
	const capabilityPath = path.resolve(ROOT, 'src/features/tars/providers/modelCapability.ts')
	const capabilityModule = loadTsModule(capabilityPath)
	const record = capabilityModule.resolveReasoningCapability({
		vendorName: 'Doubao',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
		model: 'doubao-seed-2-0-pro-260215',
		cache: {}
	})
	assert(
		record.state === 'unknown',
		'PR12-1: Doubao model without explicit metadata/cached signal should default to unknown (optimistic allow)'
	)
	assert(
		record.source === 'default',
		'PR12-1: Doubao unknown capability should come from default source'
	)
}

const runPR13 = async () => {
	const zhipuPath = path.resolve(ROOT, 'src/features/tars/providers/zhipu.ts')
	let capturedRequest = null

	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async (request) => {
						capturedRequest = request
						return (async function* () {
							yield { choices: [{ delta: { content: 'ok' } }] }
						})()
					}
				}
			}
		}
	}

	const zhipuModule = loadTsModule(zhipuPath, {
		openai: MockOpenAI,
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': MCP_HANDLER_MOCK,
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } },
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => ''
		}
	})

	const sendRequest = zhipuModule.zhipuVendor.sendRequestFunc({
		apiKey: 'test-key',
		baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
		model: 'glm-4.5-custom-new',
		enableWebSearch: false,
		enableReasoning: true,
		thinkingType: 'enabled',
		parameters: {}
	})

	for await (const _chunk of sendRequest(
		[{ role: 'user', content: 'test' }],
		new AbortController(),
		async () => new ArrayBuffer(0)
	)) {
		break
	}

	assert(capturedRequest !== null, 'PR13-1: Zhipu request should be sent')
	assert(
		capturedRequest?.thinking?.type === 'enabled',
		'PR13-1: Zhipu non-whitelist model should still send thinking when reasoning is enabled'
	)
}

const runPR14 = () => {
	const capabilityPath = path.resolve(ROOT, 'src/features/tars/providers/modelCapability.ts')
	const capabilityModule = loadTsModule(capabilityPath)
	const supported = capabilityModule.inferReasoningCapabilityFromMetadata('OpenRouter', {
		id: 'openrouter/reasoning-model',
		supported_parameters: ['tools', 'reasoning', 'web_search']
	})
	assert(
		supported?.state === 'supported',
		'PR14-1: OpenRouter metadata with supported_parameters.reasoning should be marked as supported'
	)

	const unsupported = capabilityModule.inferReasoningCapabilityFromMetadata('OpenRouter', {
		id: 'openrouter/non-reasoning-model',
		supported_parameters: ['tools', 'web_search']
	})
	assert(
		unsupported?.state === 'unsupported',
		'PR14-1: OpenRouter metadata without reasoning in supported_parameters should be marked as unsupported'
	)
}

const runPR15 = () => {
	const capabilityPath = path.resolve(ROOT, 'src/features/tars/providers/modelCapability.ts')
	const capabilityModule = loadTsModule(capabilityPath)
	const key = capabilityModule.buildReasoningCapabilityCacheKey(
		'OpenRouter',
		'https://openrouter.ai/api/v1/chat/completions',
		'openai/gpt-5'
	)

	const written = capabilityModule.writeReasoningCapabilityCache(
		{},
		key,
		{
			state: 'supported',
			source: 'probe',
			confidence: 0.8,
			checkedAt: 0
		},
		1000,
		100
	)
	const hit = capabilityModule.readReasoningCapabilityCache(written, key, 1050)
	assert(Boolean(hit), 'PR15-1: capability cache should hit before TTL expires')

	const miss = capabilityModule.readReasoningCapabilityCache(written, key, 1201)
	assert(miss === undefined, 'PR15-1: capability cache should miss after TTL expires')

	const pruned = capabilityModule.pruneExpiredReasoningCapabilityCache(written, 1201)
	assert(
		Object.keys(pruned).length === 0,
		'PR15-1: pruneExpiredReasoningCapabilityCache should remove expired entries'
	)
}

const runPR16 = () => {
	const doubaoPath = path.resolve(ROOT, 'src/features/tars/providers/doubao.ts')
	let capturedTransformApiParams = null

	const doubaoModule = loadTsModule(doubaoPath, {
		obsidian: {
			requestUrl: async () => ({ status: 200, json: {}, text: '' })
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			getMimeTypeFromFilename: () => 'image/png'
		},
		'./errors': {
			normalizeProviderError: (error) => error
		},
		'./retry': {
			withRetry: async (operation) => operation()
		},
		'../mcp/mcpToolCallHandler': {
			withOpenAIMcpToolCallSupport: (factory, options) => {
				capturedTransformApiParams = options?.transformApiParams
				return factory
			}
		},
		'./doubaoImage': {
			DEFAULT_DOUBAO_IMAGE_OPTIONS: {
				displayWidth: 400,
				size: '1024x1024',
				response_format: 'b64_json',
				watermark: false,
				sequential_image_generation: false,
				stream: false,
				optimize_prompt_mode: 'auto'
			},
			doubaoImageVendor: {
				sendRequestFunc: () =>
					async function* () {
						yield ''
					}
			},
			DOUBAO_IMAGE_MODELS: [],
			isDoubaoImageGenerationModel: () => false
		}
	})

	assert(
		doubaoModule.doubaoUseResponsesAPI({ enableReasoning: true, enableWebSearch: false }) === false,
		'PR16-1: Doubao reasoning-only mode should stay on chat.completions (MCP-compatible path)'
	)
	assert(
		doubaoModule.doubaoUseResponsesAPI({ enableReasoning: false, enableWebSearch: true }) === true,
		'PR16-1: Doubao web-search mode should use responses API'
	)
	assert(
		typeof capturedTransformApiParams === 'function',
		'PR16-2: Doubao MCP wrapper should provide transformApiParams'
	)

	const transformedEnabled = capturedTransformApiParams(
		{ temperature: 0.2, thinkingType: 'enabled' },
		{ enableReasoning: true, thinkingType: 'auto' }
	)
	assert(
		transformedEnabled.thinking?.type === 'auto',
		'PR16-2: Doubao MCP transform should map thinkingType to thinking.type when reasoning is enabled'
	)
	assert(
		transformedEnabled.thinkingType === undefined,
		'PR16-2: Doubao MCP transform should strip thinkingType from direct API params'
	)

	const transformedDisabled = capturedTransformApiParams(
		{ temperature: 0.2, thinkingType: 'enabled' },
		{ enableReasoning: false, thinkingType: 'enabled' }
	)
	assert(
		transformedDisabled.thinking === undefined,
		'PR16-2: Doubao MCP transform should not inject thinking when reasoning is disabled'
	)
}

const runPR17 = async () => {
	const mcpPath = path.resolve(ROOT, 'src/features/tars/mcp/mcpToolCallHandler.ts')
	const streamQueue = []

	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async () => {
						const parts = streamQueue.shift()
						if (!parts) {
							throw new Error('PR17 mock stream queue is empty')
						}
						return (async function* () {
							for (const part of parts) {
								yield part
							}
						})()
					}
				}
			}
		}
	}

	const mcpModule = loadTsModule(mcpPath, {
		openai: MockOpenAI,
		'src/utils/DebugLogger': {
			DebugLogger: {
				debug: () => {},
				warn: () => {},
				error: () => {}
			}
		},
		'./toolHints': {
			getBuiltinToolHint: () => undefined
		},
		'../providers': {},
		'../providers/utils': {
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			REASONING_BLOCK_START_MARKER: '{{FF_REASONING_START}}',
			REASONING_BLOCK_END_MARKER: '{{FF_REASONING_END}}',
			formatReasoningDuration: () => '0.00s'
		}
	})

	const { withOpenAIMcpToolCallSupport } = mcpModule

	const wrappedFactory = withOpenAIMcpToolCallSupport(() =>
		async function* () {
			yield 'fallback'
		}
	)

	const sendRequest = wrappedFactory({
		apiKey: 'test-key',
		baseURL: 'https://qianfan.baidubce.com/v2/chat/completions',
		model: 'qwen3-235b-a22b',
		parameters: {},
		enableThinking: true,
		mcpTools: [{
			name: 'mock_tool',
			description: 'mock tool',
			inputSchema: { type: 'object', properties: {} },
			serverId: 'mock-server'
		}],
		mcpCallTool: async () => 'ok'
	})

	streamQueue.push([
		{ choices: [{ delta: { reasoning_content: '先思考' } }] },
		{ choices: [{ delta: { content: '最终答案' } }] }
	])

	let output = ''
	for await (const chunk of sendRequest(
		[{ role: 'user', content: 'test question' }],
		new AbortController(),
		async () => new ArrayBuffer(0)
	)) {
		output += chunk
	}

	assert(
		output.includes('{{FF_REASONING_START}}') && output.includes(':{{FF_REASONING_END}}:'),
		'PR17-1: MCP reasoning display should honor enableThinking for QianFan-like providers'
	)
	assert(output.includes('先思考'), 'PR17-1: reasoning_content should be streamed when enableThinking is true')
	assert(output.includes('最终答案'), 'PR17-1: normal content should still be streamed')
}

const runPR18 = () => {
	const qianFanPath = path.resolve(ROOT, 'src/features/tars/providers/qianFan.ts')
	let capturedTransformApiParams = null
	loadTsModule(qianFanPath, {
		openai: class MockOpenAI {},
		obsidian: {
			Notice: class {},
			requestUrl: async () => ({ status: 200, json: {}, text: '', arrayBuffer: new ArrayBuffer(0) })
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': {
			withOpenAIMcpToolCallSupport: (factory, options) => {
				capturedTransformApiParams = options?.transformApiParams
				return factory
			}
		},
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./messageFormat': {
			withToolMessageContext: (_msg, payload) => payload
		},
		'../../../utils/DebugLogger': { DebugLogger: { debug: () => {} } }
	})

	assert(
		typeof capturedTransformApiParams === 'function',
		'PR18-1: QianFan MCP wrapper should provide transformApiParams'
	)

	const transformed = capturedTransformApiParams(
		{ temperature: 0.2, enableThinking: true },
		{ enableThinking: true }
	)
	assert(
		transformed.enable_thinking === true,
		'PR18-1: QianFan MCP transform should map enableThinking to enable_thinking'
	)
	assert(
		transformed.enableThinking === undefined,
		'PR18-1: QianFan MCP transform should strip enableThinking from direct API params'
	)

	const settingTabPath = path.resolve(ROOT, 'src/features/tars/settingTab.ts')
	const settingTabSource = fs.readFileSync(settingTabPath, 'utf-8')
	assert(
		/\[kimiVendor\.name\][\s\S]*Authorization:\s*`Bearer \$\{options\.apiKey\}`/.test(settingTabSource),
		'PR18-2: Kimi model fetch request should include Authorization header'
	)
}

const runPR19 = async () => {
	const mcpPath = path.resolve(ROOT, 'src/features/tars/mcp/mcpToolCallHandler.ts')

	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async () => {
						throw new Error('Connection error.')
					}
				}
			}
		}
	}

	const mcpModule = loadTsModule(mcpPath, {
		openai: MockOpenAI,
		'src/utils/DebugLogger': {
			DebugLogger: {
				debug: () => {},
				warn: () => {},
				error: () => {}
			}
		},
		'./toolHints': {
			getBuiltinToolHint: () => undefined
		},
		'../providers': {},
		'../providers/utils': {
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			REASONING_BLOCK_START_MARKER: '{{FF_REASONING_START}}',
			REASONING_BLOCK_END_MARKER: '{{FF_REASONING_END}}',
			formatReasoningDuration: () => '0.00s'
		}
	})

	const { withOpenAIMcpToolCallSupport } = mcpModule
	const wrappedFactory = withOpenAIMcpToolCallSupport(() =>
		async function* () {
			yield 'fallback-success'
		}
	)

	const sendRequest = wrappedFactory({
		apiKey: 'test-key',
		baseURL: 'https://api.moonshot.cn/v1/chat/completions',
		model: 'kimi-k2',
		parameters: {},
		mcpTools: [{
			name: 'mock_tool',
			description: 'mock tool',
			inputSchema: { type: 'object', properties: {} },
			serverId: 'mock-server'
		}],
		mcpCallTool: async () => 'ok'
	})

	let output = ''
	for await (const chunk of sendRequest(
		[{ role: 'user', content: 'test question' }],
		new AbortController(),
		async () => new ArrayBuffer(0)
	)) {
		output += chunk
	}

	assert(
		output.includes('fallback-success'),
		'PR19-1: Kimi MCP connection error should fallback to plain request path'
	)
}

const runPR20 = async () => {
	const mcpPath = path.resolve(ROOT, 'src/features/tars/mcp/mcpToolCallHandler.ts')
	const streamQueue = []

	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async () => {
						const parts = streamQueue.shift()
						if (!parts) {
							throw new Error('PR20 mock stream queue is empty')
						}
						return (async function* () {
							for (const part of parts) {
								yield part
							}
						})()
					}
				}
			}
		}
	}

	const mcpModule = loadTsModule(mcpPath, {
		openai: MockOpenAI,
		'src/utils/DebugLogger': {
			DebugLogger: {
				debug: () => {},
				warn: () => {},
				error: () => {}
			}
		},
		'./toolHints': {
			getBuiltinToolHint: () => undefined
		},
		'../providers': {},
		'../providers/utils': {
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			REASONING_BLOCK_START_MARKER: '{{FF_REASONING_START}}',
			REASONING_BLOCK_END_MARKER: '{{FF_REASONING_END}}',
			formatReasoningDuration: () => '0.00s'
		}
	})

	const { withOpenAIMcpToolCallSupport } = mcpModule
	const wrappedFactory = withOpenAIMcpToolCallSupport(() =>
		async function* () {
			yield 'fallback'
		}
	)

	const sendRequest = wrappedFactory({
		apiKey: 'test-key',
		baseURL: 'https://api.moonshot.cn/v1/chat/completions',
		model: 'kimi-k2',
		parameters: {},
		mcpTools: [{
			name: 'list_directory',
			description: 'list files',
			inputSchema: {
				type: 'object',
				required: ['directory_path'],
				properties: {
					directory_path: { type: 'string' }
				}
			},
			serverId: 'mock-server'
		}],
		mcpCallTool: async () => 'tool-result'
	})

	// 第一轮：Provider 仅返回 legacy function_call 增量字段
	streamQueue.push([
		{ choices: [{ delta: { function_call: { name: 'list_directory' } } }] },
		{ choices: [{ delta: { function_call: { arguments: '{"directory_path":"Inbox"}' } } }] }
	])
	// 第二轮：拿到工具结果后返回正常文本
	streamQueue.push([
		{ choices: [{ delta: { content: '最终总结' } }] }
	])

	let output = ''
	for await (const chunk of sendRequest(
		[{ role: 'user', content: 'summarize inbox' }],
		new AbortController(),
		async () => new ArrayBuffer(0)
	)) {
		output += chunk
	}

	assert(
		output.includes('{{FF_MCP_TOOL_START}}:list_directory:tool-result{{FF_MCP_TOOL_END}}:'),
		'PR20-1: legacy function_call should still execute MCP tools'
	)
	assert(
		output.includes('最终总结'),
		'PR20-2: response should continue after legacy function_call tool execution'
	)
}

const runPR21 = () => {
	const kimiPath = path.resolve(ROOT, 'src/features/tars/providers/kimi.ts')
	let capturedMcpOptions = null

	loadTsModule(kimiPath, {
		axios: {
			post: async () => {
				throw new Error('not implemented in regression test')
			}
		},
		openai: class MockOpenAI {
			constructor(opts) { this._opts = opts }
		},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': {
			withOpenAIMcpToolCallSupport: (factory, options) => {
				capturedMcpOptions = options
				return factory
			}
		},
		'./utils': {
			buildReasoningBlockEnd: () => '',
			buildReasoningBlockStart: () => '',
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } })
		},
		'./sse': {
			feedChunk: () => ({ events: [], rest: '', done: false })
		}
	})

	assert(
		Boolean(capturedMcpOptions),
		'PR21-1: Kimi MCP wrapper options should be captured'
	)
	assert(
		capturedMcpOptions.preferNonStreamingToolLoop !== true,
		'PR21-1: Kimi MCP wrapper should use streaming tool loop (Moonshot recommends stream=true for thinking models)'
	)
	assert(
		typeof capturedMcpOptions.createClient === 'function',
		'PR21-1: Kimi MCP wrapper should provide a custom createClient to strip non-standard SDK headers'
	)

	const transformed = capturedMcpOptions.transformApiParams(
		{ temperature: 0.7, enableThinking: false, enableWebSearch: false },
		{ enableReasoning: true, mcpTools: [{ name: 'list_directory' }] }
	)
	assert(
		transformed.tool_choice === 'auto',
		'PR21-1: Kimi MCP params should include tool_choice=auto by default'
	)
	assert(
		typeof transformed.max_tokens === 'number' && transformed.max_tokens >= 16000,
		'PR21-1: Kimi MCP reasoning requests should enforce max_tokens >= 16000'
	)
	assert(
		transformed.temperature === 1.0,
		'PR21-1: Kimi MCP reasoning requests should enforce temperature=1.0 per Moonshot docs'
	)
	assert(
		transformed.enableThinking === undefined && transformed.enableWebSearch === undefined,
		'PR21-1: Kimi MCP params should strip non-standard fields (enableThinking, enableWebSearch)'
	)

	const chatServicePath = path.resolve(ROOT, 'src/features/chat/services/ChatService.ts')
	const chatServiceSource = fs.readFileSync(chatServicePath, 'utf-8')
	assert(
		/session\.messages\s*=\s*session\.messages\.slice\(0,\s*index\)/.test(chatServiceSource),
		'PR21-2: regenerateFromMessage should truncate the target assistant message and all following messages'
	)
}

const runPR22 = async () => {
	const mcpPath = path.resolve(ROOT, 'src/features/tars/mcp/mcpToolCallHandler.ts')
	let capturedRequest = null

	class MockOpenAI {
		constructor() {
			this.chat = {
				completions: {
					create: async (request) => {
						capturedRequest = request
						return (async function* () {
							yield { choices: [{ delta: { content: 'ok' } }] }
						})()
					}
				}
			}
		}
	}

	const mcpModule = loadTsModule(mcpPath, {
		openai: MockOpenAI,
		'src/utils/DebugLogger': {
			DebugLogger: {
				debug: () => {},
				warn: () => {},
				error: () => {}
			}
		},
		'./toolHints': {
			getBuiltinToolHint: () => undefined
		},
		'../providers': {},
		'../providers/utils': {
			convertEmbedToImageUrl: async () => ({ type: 'image_url', image_url: { url: '' } }),
			REASONING_BLOCK_START_MARKER: '{{FF_REASONING_START}}',
			REASONING_BLOCK_END_MARKER: '{{FF_REASONING_END}}',
			formatReasoningDuration: () => '0.00s'
		}
	})

	const { withOpenAIMcpToolCallSupport } = mcpModule
	const wrappedFactory = withOpenAIMcpToolCallSupport(() =>
		async function* () {
			yield 'fallback'
		}
	)
	const sendRequest = wrappedFactory({
		apiKey: 'test-key',
		baseURL: 'https://api.moonshot.cn/v1/chat/completions',
		model: 'kimi-k2-thinking',
		parameters: {
			tools: [],
			stream: false,
			model: 'malicious-override'
		},
		mcpTools: [{
			name: 'list_directory',
			description: 'list files',
			inputSchema: {
				type: 'object',
				required: ['directory_path'],
				properties: {
					directory_path: { type: 'string' }
				}
			},
			serverId: 'mock-server'
		}],
		mcpCallTool: async () => 'ok'
	})

	for await (const _chunk of sendRequest(
		[{ role: 'user', content: 'test question' }],
		new AbortController(),
		async () => new ArrayBuffer(0)
	)) {
		break
	}

	assert(Boolean(capturedRequest), 'PR22-1: MCP request payload should be captured')
	assert(
		Array.isArray(capturedRequest.tools) && capturedRequest.tools.length === 1,
		'PR22-1: injected MCP tools should not be overridden by parameters.tools'
	)
	assert(
		capturedRequest.model === 'kimi-k2-thinking',
		'PR22-1: request model should not be overridden by parameters.model'
	)
	assert(
		capturedRequest.stream === true,
		'PR22-1: stream mode should not be overridden by parameters.stream'
	)
}

const runPR23 = () => {
	const ollamaPath = path.resolve(ROOT, 'src/features/tars/providers/ollama.ts')
	let capturedHost = null
	const capturedRequests = []
	const streamQueue = []

	class MockOllama {
		constructor(options = {}) {
			capturedHost = options.host ?? null
		}

		async chat(request) {
			capturedRequests.push(JSON.parse(JSON.stringify(request)))
			return streamQueue.shift() ?? (async function* () {})()
		}

		abort() {}
	}

	const ollamaModuleMocks = {
		'ollama/browser': {
			Ollama: MockOllama
		},
		obsidian: {},
		'tars/lang/helper': { t: (text) => text },
		'.': {},
		'../mcp/mcpToolCallHandler': {
			resolveCurrentMcpTools: async (tools) => tools,
			toOpenAITools: (tools) => tools,
			executeMcpToolCalls: async (toolCalls, mcpTools, mcpCallTool) => {
				const toolCall = toolCalls[0]
				const parsedArgs = JSON.parse(toolCall.function.arguments)
				const result = await mcpCallTool(mcpTools[0].serverId, toolCall.function.name, parsedArgs)
				return [{
					role: 'tool',
					tool_call_id: toolCall.id,
					name: toolCall.function.name,
					content: result
				}]
			}
		},
		'./errors': {
			normalizeProviderError: (error) => error
		},
		'./utils': {
			arrayBufferToBase64: () => 'ZmFrZQ==',
			getMimeTypeFromFilename: () => 'image/png',
			buildReasoningBlockStart: () => '',
			buildReasoningBlockEnd: () => ''
		}
	}

	const { ollamaVendor } = loadTsModule(ollamaPath, ollamaModuleMocks)

	const makeStream = (parts) => (async function* () {
		for (const part of parts) {
			yield part
		}
	})()

	streamQueue.push(makeStream([
		{ message: { content: '先查一下' } },
		{
			message: {
				content: '',
				tool_calls: [{
					function: {
						name: 'list_directory',
						arguments: { directory_path: 'Inbox' }
					}
				}]
			}
		}
	]))
	streamQueue.push(makeStream([
		{ message: { content: '最终总结' } }
	]))

	const sendRequest = ollamaVendor.sendRequestFunc({
		apiKey: '',
		baseURL: 'http://127.0.0.1:11434',
		model: 'llama3.1',
		parameters: {},
		enableReasoning: false,
		mcpTools: [{
			name: 'list_directory',
			description: 'list files',
			inputSchema: {
				type: 'object',
				required: ['directory_path'],
				properties: {
					directory_path: { type: 'string' }
				}
			},
			serverId: 'mock-server'
		}],
		mcpCallTool: async (_serverId, _toolName, args) =>
			args.directory_path === 'Inbox' ? 'tool-result' : 'unexpected'
	})

	return (async () => {
		let output = ''
		for await (const chunk of sendRequest(
			[{ role: 'user', content: 'summarize inbox' }],
			new AbortController(),
			async () => new ArrayBuffer(0)
		)) {
			output += chunk
		}

		assert(
			capturedHost === 'http://127.0.0.1:11434',
			'PR23-1: Ollama MCP path should keep the native host and not rewrite to /v1'
		)
		assert(
			Array.isArray(capturedRequests[0]?.tools) && capturedRequests[0].tools.length === 1,
			'PR23-2: first native Ollama MCP request should include tools'
		)
		assert(
			output.includes('先查一下'),
			'PR23-3: native Ollama MCP path should stream assistant text before tool execution'
		)
		assert(
		output.includes('{{FF_MCP_TOOL_START}}:list_directory:tool-result{{FF_MCP_TOOL_END}}:'),
			'PR23-4: native Ollama MCP path should execute tools and emit MCP tool markers'
		)
		assert(
			output.includes('最终总结'),
			'PR23-5: native Ollama MCP path should continue with the second round response after tool execution'
		)
		const secondRoundMessages = capturedRequests[1]?.messages ?? []
		const toolMessage = secondRoundMessages.find((message) => message.role === 'tool')
		assert(
			toolMessage?.tool_name === 'list_directory' && toolMessage?.content === 'tool-result',
			'PR23-6: second native Ollama request should feed tool results back with role=tool and tool_name'
		)
	})()
}

const main = async () => {
	const pr = parseArgs()
	if (pr >= 1) {
		runPR1()
	}
	if (pr >= 2) {
		runPR2()
	}
	if (pr >= 3) {
		await runPR3()
	}
	if (pr >= 4) {
		runPR4()
	}
	if (pr >= 5) {
		runPR5()
	}
	if (pr >= 6) {
		runPR6()
	}
	if (pr >= 7) {
		await runPR7()
	}
	if (pr >= 8) {
		runPR8()
	}
	if (pr >= 9) {
		runPR9()
	}
	if (pr >= 10) {
		runPR10()
	}
	if (pr >= 11) {
		await runPR11()
	}
	if (pr >= 12) {
		runPR12()
	}
	if (pr >= 13) {
		await runPR13()
	}
	if (pr >= 14) {
		runPR14()
	}
	if (pr >= 15) {
		runPR15()
	}
	if (pr >= 16) {
		runPR16()
	}
	if (pr >= 17) {
		await runPR17()
	}
	if (pr >= 18) {
		runPR18()
	}
	if (pr >= 19) {
		await runPR19()
	}
	if (pr >= 20) {
		await runPR20()
	}
	if (pr >= 21) {
		runPR21()
	}
	if (pr >= 22) {
		await runPR22()
	}
	if (pr >= 23) {
		await runPR23()
	}

	console.log(`provider-regression: PR-${pr} checks passed`)
}

try {
	await main()
} catch (error) {
	console.error('provider-regression failed:', error instanceof Error ? error.message : String(error))
	process.exit(1)
}
