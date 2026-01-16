import { App, Component, MarkdownRenderer } from 'obsidian';

// 推理块标记
const REASONING_START_MARKER = '{{FF_REASONING_START}}'
const REASONING_END_MARKER = '{{FF_REASONING_END}}'

// 解析内容，分离推理块和普通内容
export interface ReasoningBlock {
	type: 'reasoning'
	startMs: number
	content: string
	durationMs?: number // 如果有结束标记则存在
}

export interface TextBlock {
	type: 'text'
	content: string
}

export type ContentBlock = ReasoningBlock | TextBlock

// 解析消息内容，提取推理块
export const parseContentBlocks = (content: string): ContentBlock[] => {
	const blocks: ContentBlock[] = []
	
	// 匹配推理块：{{FF_REASONING_START}}:timestamp:...内容...:{{FF_REASONING_END}}:duration
	// 或者未结束的推理块：{{FF_REASONING_START}}:timestamp:...内容...
	const startPattern = new RegExp(`${REASONING_START_MARKER.replace(/[{}]/g, '\\$&')}:(\\d+):`, 'g')
	const endPattern = new RegExp(`:${REASONING_END_MARKER.replace(/[{}]/g, '\\$&')}:(\\d+):?`)
	
	let lastIndex = 0
	let match: RegExpExecArray | null
	
	while ((match = startPattern.exec(content)) !== null) {
		// 添加推理块之前的普通文本
		if (match.index > lastIndex) {
			const textBefore = content.slice(lastIndex, match.index)
			if (textBefore.trim()) {
				blocks.push({ type: 'text', content: textBefore })
			}
		}
		
		const startMs = parseInt(match[1], 10)
		const reasoningStartIndex = match.index + match[0].length
		
		// 查找对应的结束标记
		const remainingContent = content.slice(reasoningStartIndex)
		const endMatch = endPattern.exec(remainingContent)
		
		if (endMatch) {
			// 找到结束标记
			const reasoningContent = remainingContent.slice(0, endMatch.index)
			const durationMs = parseInt(endMatch[1], 10)
			blocks.push({
				type: 'reasoning',
				startMs,
				content: reasoningContent,
				durationMs
			})
			lastIndex = reasoningStartIndex + endMatch.index + endMatch[0].length
		} else {
			// 没有结束标记（推理进行中）
			const reasoningContent = remainingContent
			blocks.push({
				type: 'reasoning',
				startMs,
				content: reasoningContent
			})
			lastIndex = content.length
		}
	}
	
	// 添加剩余的普通文本
	if (lastIndex < content.length) {
		const textAfter = content.slice(lastIndex)
		if (textAfter.trim()) {
			blocks.push({ type: 'text', content: textAfter })
		}
	}
	
	// 如果没有找到任何推理块，整个内容作为普通文本
	if (blocks.length === 0 && content.trim()) {
		blocks.push({ type: 'text', content })
	}
	
	return blocks
}

// 检查内容是否包含推理块
export const hasReasoningBlock = (content: string): boolean => {
	return content.includes(REASONING_START_MARKER)
}

// 渲染普通 Markdown 内容
export const renderMarkdownContent = async (
	app: App,
	markdown: string,
	container: HTMLElement,
	component: Component
) => {
	container.empty();
	await MarkdownRenderer.render(app, markdown, container, '', component);
};

