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
		AbortController
	})
	new vm.Script(compiled, { filename: filePath }).runInContext(context)
	return module.exports
}

const assert = (condition, message) => {
	if (!condition) {
		throw new Error(message)
	}
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
	for (const vendorName of ['claudeVendor.name', 'qwenVendor.name', 'zhipuVendor.name', 'deepSeekVendor.name', 'qianFanVendor.name', 'doubaoImageVendor.name']) {
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
		settingTabText.includes('/v2/models'),
		'PR6-2: QianFan model fetching should try OpenAI-compatible /v2/models endpoint first'
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

	console.log(`provider-regression: PR-${pr} checks passed`)
}

try {
	await main()
} catch (error) {
	console.error('provider-regression failed:', error instanceof Error ? error.message : String(error))
	process.exit(1)
}
