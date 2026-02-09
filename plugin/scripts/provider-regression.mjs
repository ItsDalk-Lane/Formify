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
		console
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

const main = () => {
	const pr = parseArgs()
	if (pr >= 1) {
		runPR1()
	}
	if (pr >= 2) {
		runPR2()
	}

	console.log(`provider-regression: PR-${pr} checks passed`)
}

try {
	main()
} catch (error) {
	console.error('provider-regression failed:', error instanceof Error ? error.message : String(error))
	process.exit(1)
}
