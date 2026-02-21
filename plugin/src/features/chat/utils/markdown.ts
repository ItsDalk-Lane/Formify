import { App, Component, MarkdownRenderer } from 'obsidian';

// 推理块标记
const REASONING_START_MARKER = '{{FF_REASONING_START}}'
const REASONING_END_MARKER = '{{FF_REASONING_END}}'

// MCP 工具调用块标记
const MCP_TOOL_START_MARKER = '{{FF_MCP_TOOL_START}}'
const MCP_TOOL_END_MARKER = '{{FF_MCP_TOOL_END}}'

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

export interface McpToolBlock {
	type: 'mcpTool'
	toolName: string
	content: string
}

export type ContentBlock = ReasoningBlock | TextBlock | McpToolBlock

// 各标记的转义正则（用于 RegExp 构造）
const ESCAPED_REASONING_START = REASONING_START_MARKER.replace(/[{}]/g, '\\$&')
const ESCAPED_REASONING_END = REASONING_END_MARKER.replace(/[{}]/g, '\\$&')
const ESCAPED_MCP_TOOL_START = MCP_TOOL_START_MARKER.replace(/[{}]/g, '\\$&')
const ESCAPED_MCP_TOOL_END = MCP_TOOL_END_MARKER.replace(/[{}]/g, '\\$&')

/**
 * 解析消息内容，提取推理块和 MCP 工具调用块
 *
 * 支持的标记格式：
 * - 推理块：{{FF_REASONING_START}}:timestamp:content:{{FF_REASONING_END}}:durationMs:
 * - MCP 工具块：{{FF_MCP_TOOL_START}}:toolName:content{{FF_MCP_TOOL_END}}:
 */
export const parseContentBlocks = (content: string): ContentBlock[] => {
	const blocks: ContentBlock[] = []

	// 查找所有起始标记的位置（推理块和 MCP 工具块），统一排序后按序处理
	type MarkerEntry = {
		index: number
		type: 'reasoning' | 'mcpTool'
		match: RegExpExecArray
	}

	const markers: MarkerEntry[] = []

	// 收集推理块起始标记：{{FF_REASONING_START}}:timestamp:
	const reasoningStartPattern = new RegExp(`${ESCAPED_REASONING_START}:(\\d+):`, 'g')
	let match: RegExpExecArray | null
	while ((match = reasoningStartPattern.exec(content)) !== null) {
		markers.push({ index: match.index, type: 'reasoning', match })
	}

	// 收集 MCP 工具块起始标记：{{FF_MCP_TOOL_START}}:toolName:
	// 工具名使用 [^:]+ 匹配（MCP 工具名不含冒号）
	const mcpStartPattern = new RegExp(`${ESCAPED_MCP_TOOL_START}:([^:]+):`, 'g')
	while ((match = mcpStartPattern.exec(content)) !== null) {
		markers.push({ index: match.index, type: 'mcpTool', match })
	}

	// 按位置升序排列
	markers.sort((a, b) => a.index - b.index)

	// 结束标记的正则（仅在剩余内容中搜索，不需要 g 标志）
	const reasoningEndPattern = new RegExp(`:${ESCAPED_REASONING_END}:(\\d+):?`)
	const mcpEndPattern = new RegExp(`${ESCAPED_MCP_TOOL_END}:`)

	let lastIndex = 0

	for (const marker of markers) {
		// 跳过已处理区域内的标记
		if (marker.index < lastIndex) continue

		// 将标记前的普通文本作为 TextBlock
		if (marker.index > lastIndex) {
			const textBefore = content.slice(lastIndex, marker.index)
			if (textBefore.trim()) {
				blocks.push({ type: 'text', content: textBefore })
			}
		}

		const blockContentStart = marker.index + marker.match[0].length
		const remainingContent = content.slice(blockContentStart)

		if (marker.type === 'reasoning') {
			const startMs = parseInt(marker.match[1], 10)
			const endMatch = reasoningEndPattern.exec(remainingContent)

			if (endMatch) {
				const reasoningContent = remainingContent.slice(0, endMatch.index)
				const durationMs = parseInt(endMatch[1], 10)
				blocks.push({ type: 'reasoning', startMs, content: reasoningContent, durationMs })
				lastIndex = blockContentStart + endMatch.index + endMatch[0].length
			} else {
				// 推理进行中（无结束标记）
				blocks.push({ type: 'reasoning', startMs, content: remainingContent })
				lastIndex = content.length
			}
		} else {
			// mcpTool
			const toolName = marker.match[1]
			const endMatch = mcpEndPattern.exec(remainingContent)

			if (endMatch) {
				const toolContent = remainingContent.slice(0, endMatch.index)
				blocks.push({ type: 'mcpTool', toolName, content: toolContent })
				lastIndex = blockContentStart + endMatch.index + endMatch[0].length
			} else {
				// 工具调用进行中（无结束标记）
				blocks.push({ type: 'mcpTool', toolName, content: remainingContent })
				lastIndex = content.length
			}
		}
	}

	// 添加剩余的普通文本
	if (lastIndex < content.length) {
		const textAfter = content.slice(lastIndex)
		if (textAfter.trim()) {
			blocks.push({ type: 'text', content: textAfter })
		}
	}

	// 没有找到任何特殊块时，整个内容作为普通文本
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
