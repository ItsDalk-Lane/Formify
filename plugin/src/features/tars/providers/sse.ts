export interface ParsedSSEEvent {
	event?: string
	id?: string
	retry?: number
	data: string
	raw: string
	isDone: boolean
	json?: unknown
	parseError?: string
}

export interface FeedChunkResult {
	events: ParsedSSEEvent[]
	rest: string
	done: boolean
}

const normalizeNewlines = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const parseEventFrame = (frame: string): ParsedSSEEvent | null => {
	if (!frame.trim()) return null

	const lines = frame.split('\n')
	let eventName: string | undefined
	let id: string | undefined
	let retry: number | undefined
	const dataLines: string[] = []

	for (const line of lines) {
		if (!line) continue
		if (line.startsWith(':')) continue

		const colonIndex = line.indexOf(':')
		const field = colonIndex === -1 ? line : line.slice(0, colonIndex)
		let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1)
		if (value.startsWith(' ')) value = value.slice(1)

		if (field === 'event') {
			eventName = value
			continue
		}
		if (field === 'id') {
			id = value
			continue
		}
		if (field === 'retry') {
			const parsed = Number.parseInt(value, 10)
			if (Number.isFinite(parsed)) {
				retry = parsed
			}
			continue
		}
		if (field === 'data') {
			dataLines.push(value)
		}
	}

	const data = dataLines.join('\n')
	const trimmedData = data.trim()
	if (!eventName && !id && retry === undefined && dataLines.length === 0) {
		return null
	}
	const isDone = trimmedData === '[DONE]'
	const result: ParsedSSEEvent = {
		event: eventName,
		id,
		retry,
		data,
		raw: frame,
		isDone
	}

	if (!isDone && trimmedData && /^[\[{]/.test(trimmedData)) {
		try {
			result.json = JSON.parse(trimmedData)
		} catch (error) {
			result.parseError = error instanceof Error ? error.message : String(error)
		}
	}

	return result
}

export const feedChunk = (buffer: string, chunk: string): FeedChunkResult => {
	const normalized = normalizeNewlines((buffer || '') + (chunk || ''))
	if (!normalized) {
		return {
			events: [],
			rest: '',
			done: false
		}
	}

	const frames = normalized.split('\n\n')
	const hasFrameTerminator = normalized.endsWith('\n\n')
	const completeFrames = hasFrameTerminator ? frames : frames.slice(0, -1)
	const rest = hasFrameTerminator ? '' : frames[frames.length - 1] || ''

	const events: ParsedSSEEvent[] = []
	let done = false
	for (const frame of completeFrames) {
		const parsed = parseEventFrame(frame)
		if (!parsed) continue
		events.push(parsed)
		if (parsed.isDone) {
			done = true
			break
		}
	}

	return {
		events,
		rest,
		done
	}
}
