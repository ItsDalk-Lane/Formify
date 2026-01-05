import { EditorState } from '@codemirror/state'

/**
 * 上下文信息接口
 */
export interface EditorContext {
    /** 光标前的文本 */
    textBefore: string
    /** 光标后的文本 */
    textAfter: string
    /** 当前行文本 */
    currentLine: string
    /** 光标在当前行的位置（光标前的文本） */
    textBeforeCursorOnLine: string
    /** 光标后当前行的文本 */
    textAfterCursorOnLine: string
    /** 当前行号（从 0 开始） */
    lineNumber: number
    /** 光标在当前行的位置 */
    columnNumber: number
    /** 光标绝对位置 */
    cursorPos: number
    /** 上下文类型（用于格式调整） */
    contextType: ContextType
    /** 是否需要在建议前添加换行 */
    needsLeadingNewline: boolean
    /** 笔记是否使用 Markdown 格式 */
    isMarkdownFormatted: boolean
    /** 当前列表项的格式信息（如果在列表中） */
    listItemFormat: ListItemFormat | null
}

/**
 * 上下文类型枚举
 */
export enum ContextType {
    /** 普通段落 */
    Paragraph = 'paragraph',
    /** 列表项 */
    ListItem = 'list_item',
    /** 代码块 */
    CodeBlock = 'code_block',
    /** 表格 */
    Table = 'table',
    /** 引用块 */
    Blockquote = 'blockquote',
    /** 标题 */
    Heading = 'heading',
    /** Frontmatter (YAML) */
    Frontmatter = 'frontmatter',
    /** 空文档 */
    Empty = 'empty'
}

/**
 * 列表项格式信息
 */
export interface ListItemFormat {
    /** 缩进字符串 */
    indent: string
    /** 列表符号（-、*、+ 或数字） */
    marker: string
    /** 是否是有序列表 */
    isOrdered: boolean
    /** 下一个列表项的完整前缀 */
    nextItemPrefix: string
}

/**
 * 上下文构建器配置
 */
export interface ContextBuilderOptions {
    /** 获取光标前的最大字符数 */
    maxCharsBefore: number
    /** 获取光标后的最大字符数 */
    maxCharsAfter: number
}

const DEFAULT_OPTIONS: ContextBuilderOptions = {
    maxCharsBefore: 1000,
    maxCharsAfter: 500
}

/**
 * 从 EditorState 构建上下文信息
 */
export function buildEditorContext(
    state: EditorState,
    options: Partial<ContextBuilderOptions> = {}
): EditorContext {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const cursorPos = state.selection.main.head
    const doc = state.doc
    const fullText = doc.toString()

    // 获取光标前后的文本
    const startBefore = Math.max(0, cursorPos - opts.maxCharsBefore)
    const endAfter = Math.min(doc.length, cursorPos + opts.maxCharsAfter)
    
    const textBefore = doc.sliceString(startBefore, cursorPos)
    const textAfter = doc.sliceString(cursorPos, endAfter)

    // 获取当前行信息
    const currentLineObj = doc.lineAt(cursorPos)
    const currentLine = currentLineObj.text
    const lineNumber = currentLineObj.number - 1 // 转换为 0-based
    const columnNumber = cursorPos - currentLineObj.from

    // 光标在当前行的位置文本
    const textBeforeCursorOnLine = currentLine.substring(0, columnNumber)
    const textAfterCursorOnLine = currentLine.substring(columnNumber)

    // 分析上下文类型
    const contextType = analyzeContextType(fullText, cursorPos, currentLine, lineNumber)

    // 提取列表项格式信息
    const listItemFormat = extractListItemFormat(currentLine)

    // 分析是否需要在建议前添加换行
    const needsLeadingNewline = analyzeNeedsLeadingNewline(
        contextType,
        textBeforeCursorOnLine,
        textAfterCursorOnLine,
        listItemFormat
    )

    // 检测笔记是否使用 Markdown 格式
    const isMarkdownFormatted = detectMarkdownFormat(fullText)

    return {
        textBefore,
        textAfter,
        currentLine,
        textBeforeCursorOnLine,
        textAfterCursorOnLine,
        lineNumber,
        columnNumber,
        cursorPos,
        contextType,
        needsLeadingNewline,
        isMarkdownFormatted,
        listItemFormat
    }
}

/**
 * 分析上下文类型
 */
function analyzeContextType(
    fullText: string,
    cursorPos: number,
    currentLine: string,
    lineNumber: number
): ContextType {
    const trimmedLine = currentLine.trim()

    // 空文档
    if (fullText.trim().length === 0) {
        return ContextType.Empty
    }

    // 检查是否在 Frontmatter 中
    if (isInFrontmatter(fullText, cursorPos)) {
        return ContextType.Frontmatter
    }

    // 检查是否在代码块中
    if (isInCodeBlock(fullText, cursorPos)) {
        return ContextType.CodeBlock
    }

    // 检查当前行是否是列表项
    if (/^(\s*)[-*+]\s/.test(currentLine) || /^(\s*)\d+\.\s/.test(currentLine)) {
        return ContextType.ListItem
    }

    // 检查当前行是否是表格行
    if (/^\|.*\|/.test(trimmedLine)) {
        return ContextType.Table
    }

    // 检查当前行是否是引用
    if (/^>\s*/.test(currentLine)) {
        return ContextType.Blockquote
    }

    // 检查当前行是否是标题
    if (/^#{1,6}\s/.test(currentLine)) {
        return ContextType.Heading
    }

    return ContextType.Paragraph
}

/**
 * 检查光标是否在 Frontmatter 中
 */
function isInFrontmatter(text: string, cursorPos: number): boolean {
    // Frontmatter 必须在文档开头
    if (!text.startsWith('---')) {
        return false
    }

    // 查找第二个 ---
    const secondDashIndex = text.indexOf('---', 3)
    if (secondDashIndex === -1) {
        // 没有闭合，可能正在编辑 frontmatter
        return cursorPos < text.length && cursorPos < 1000 // 假设 frontmatter 不超过 1000 字符
    }

    // 检查光标是否在两个 --- 之间
    return cursorPos > 3 && cursorPos < secondDashIndex + 3
}

/**
 * 检查光标是否在代码块中
 */
function isInCodeBlock(text: string, cursorPos: number): boolean {
    const textBefore = text.substring(0, cursorPos)
    
    // 计算光标前有多少个 ``` 标记
    const codeBlockMarkers = textBefore.match(/```/g)
    if (!codeBlockMarkers) {
        return false
    }

    // 如果有奇数个 ```，说明在代码块内
    return codeBlockMarkers.length % 2 === 1
}

/**
 * 分析是否需要在建议内容前添加换行符
 */
function analyzeNeedsLeadingNewline(
    contextType: ContextType,
    textBeforeCursorOnLine: string,
    textAfterCursorOnLine: string,
    listItemFormat: ListItemFormat | null
): boolean {
    // 如果光标后面当前行还有内容，不需要换行（在行中间插入）
    if (textAfterCursorOnLine.trim().length > 0) {
        return false
    }

    // 如果光标前在当前行没有内容（空行或行首），不需要换行
    if (textBeforeCursorOnLine.trim().length === 0) {
        return false
    }

    // 列表项：如果光标在列表项末尾，生成新的列表项需要换行
    if (contextType === ContextType.ListItem && listItemFormat) {
        return true
    }

    // 代码块：如果光标在代码行末尾，新行需要换行
    if (contextType === ContextType.CodeBlock) {
        return true
    }

    // 引用块：如果光标在引用行末尾，新行需要换行
    if (contextType === ContextType.Blockquote) {
        return true
    }

    // 表格：如果光标在表格行末尾，新行需要换行
    if (contextType === ContextType.Table) {
        return true
    }

    // 普通段落：光标在句末（以标点结尾），可能需要换行开始新段落
    // 但这个需要根据 AI 输出来判断，先不强制换行
    return false
}

/**
 * 检测笔记是否使用 Markdown 格式
 */
function detectMarkdownFormat(fullText: string): boolean {
    // 检测常见的 Markdown 语法
    const markdownPatterns = [
        /^#{1,6}\s/m,           // 标题
        /\*\*.+\*\*/,           // 粗体
        /\*.+\*/,               // 斜体
        /^\s*[-*+]\s/m,         // 无序列表
        /^\s*\d+\.\s/m,         // 有序列表
        /^\s*>/m,               // 引用
        /```/,                  // 代码块
        /`[^`]+`/,              // 行内代码
        /\[.+\]\(.+\)/,         // 链接
        /!\[.+\]\(.+\)/,        // 图片
        /^\|.+\|$/m,            // 表格
    ]

    let matchCount = 0
    for (const pattern of markdownPatterns) {
        if (pattern.test(fullText)) {
            matchCount++
        }
    }

    // 如果匹配到 2 个以上的 Markdown 语法，认为是 Markdown 格式
    return matchCount >= 2
}

/**
 * 提取当前列表项的格式信息
 */
export function extractListItemFormat(currentLine: string): ListItemFormat | null {
    // 匹配无序列表：- item, * item, + item
    const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s/)
    if (unorderedMatch) {
        const indent = unorderedMatch[1]
        const marker = unorderedMatch[2]
        return {
            indent,
            marker,
            isOrdered: false,
            nextItemPrefix: `${indent}${marker} `
        }
    }

    // 匹配有序列表：1. item, 2. item
    const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s/)
    if (orderedMatch) {
        const indent = orderedMatch[1]
        const currentNumber = parseInt(orderedMatch[2])
        const nextNumber = currentNumber + 1
        return {
            indent,
            marker: `${currentNumber}.`,
            isOrdered: true,
            nextItemPrefix: `${indent}${nextNumber}. `
        }
    }

    return null
}

/**
 * 生成用于 AI 的提示词前缀
 * 根据上下文类型调整续写格式要求
 */
export function generateContextPrompt(context: EditorContext): string {
    let formatHint = ''
    const formatType = context.isMarkdownFormatted ? 'Markdown' : '纯文本'

    switch (context.contextType) {
        case ContextType.ListItem:
            if (context.listItemFormat) {
                const marker = context.listItemFormat.isOrdered ? '数字.' : context.listItemFormat.marker
                formatHint = `续写列表内容，使用"${marker}"作为列表符号。`
            } else {
                formatHint = '续写列表内容。'
            }
            break
        case ContextType.CodeBlock:
            formatHint = '续写代码，保持语法正确。'
            break
        case ContextType.Table:
            formatHint = '续写表格行。'
            break
        case ContextType.Blockquote:
            formatHint = '续写引用内容。'
            break
        case ContextType.Frontmatter:
            formatHint = '续写 YAML 字段。'
            break
        case ContextType.Heading:
            formatHint = '在标题后续写正文。'
            break
        default:
            formatHint = '自然续写内容。'
    }

    return `${formatHint} 输出格式：${formatType}。`
}

/**
 * 后处理 AI 输出的建议内容
 * 根据上下文智能处理换行、格式等
 */
export function postProcessSuggestion(
    suggestion: string,
    context: EditorContext
): string {
    if (!suggestion || suggestion.trim().length === 0) {
        return ''
    }

    let processed = suggestion

    // 1. 移除 AI 可能添加的代码块包裹
    processed = removeCodeBlockWrapper(processed)

    // 2. 智能处理开头的换行
    processed = processLeadingNewline(processed, context)

    // 3. 处理列表格式
    if (context.contextType === ContextType.ListItem && context.listItemFormat) {
        processed = processListFormat(processed, context)
    }

    // 4. 处理引用块格式
    if (context.contextType === ContextType.Blockquote) {
        processed = processBlockquoteFormat(processed)
    }

    return processed
}

/**
 * 移除 AI 可能添加的代码块包裹
 */
function removeCodeBlockWrapper(text: string): string {
    // 移除开头的 ```markdown 或 ``` 和结尾的 ```
    const codeBlockMatch = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```$/m)
    if (codeBlockMatch) {
        return codeBlockMatch[1]
    }
    return text
}

/**
 * 智能处理开头的换行
 */
function processLeadingNewline(text: string, context: EditorContext): string {
    // 如果需要在建议前添加换行
    if (context.needsLeadingNewline) {
        // 检查建议是否已经以换行开头
        if (!text.startsWith('\n')) {
            return '\n' + text
        }
    } else {
        // 不需要换行时，移除开头多余的换行
        // 但保留一个空格（如果原文没有以空格结尾）
        if (text.startsWith('\n')) {
            const trimmed = text.replace(/^\n+/, '')
            // 如果光标前没有空格，且建议不以空格开头，添加一个空格
            if (context.textBeforeCursorOnLine.length > 0 &&
                !context.textBeforeCursorOnLine.endsWith(' ') &&
                !trimmed.startsWith(' ')) {
                return ' ' + trimmed
            }
            return trimmed
        }
    }
    return text
}

/**
 * 处理列表格式
 */
function processListFormat(text: string, context: EditorContext): string {
    if (!context.listItemFormat) return text

    const lines = text.split('\n')
    const processedLines: string[] = []
    const { indent, marker, isOrdered, nextItemPrefix } = context.listItemFormat
    let currentNumber = isOrdered ? parseInt(marker) : 0

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        
        // 跳过空行
        if (line.trim().length === 0) {
            processedLines.push(line)
            continue
        }

        // 检查这一行是否已经有列表格式
        const hasListMarker = /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)
        
        if (hasListMarker) {
            // 已经有列表标记，保持原样但调整缩进
            if (isOrdered) {
                // 有序列表：更新数字
                currentNumber++
                line = line.replace(/^\s*\d+\.\s/, `${indent}${currentNumber}. `)
            } else {
                // 无序列表：统一使用相同的标记
                line = line.replace(/^\s*[-*+]\s/, nextItemPrefix)
            }
        } else if (i > 0 || context.needsLeadingNewline) {
            // 没有列表标记但应该是新的列表项
            // 第一行如果不需要换行，则是当前列表项的续写
            if (i > 0) {
                if (isOrdered) {
                    currentNumber++
                    line = `${indent}${currentNumber}. ${line.trim()}`
                } else {
                    line = `${nextItemPrefix}${line.trim()}`
                }
            }
        }

        processedLines.push(line)
    }

    return processedLines.join('\n')
}

/**
 * 处理引用块格式
 */
function processBlockquoteFormat(text: string): string {
    const lines = text.split('\n')
    const processedLines = lines.map((line, index) => {
        // 如果行不为空且不以 > 开头，添加 >
        if (line.trim().length > 0 && !line.startsWith('>')) {
            return '> ' + line
        }
        return line
    })
    return processedLines.join('\n')
}

/**
 * 限制建议内容的长度
 * @param text 原始建议文本
 * @param maxSentences 最大句子数
 * @returns 截断后的文本
 */
export function limitSuggestionLength(text: string, maxSentences: number = 1): string {
    if (maxSentences <= 0) {
        return text
    }

    // 句子结束的标记
    const sentenceEnders = /[。！？.!?]/g
    
    let sentenceCount = 0
    let lastEndIndex = 0
    let match: RegExpExecArray | null

    while ((match = sentenceEnders.exec(text)) !== null) {
        sentenceCount++
        lastEndIndex = match.index + 1

        if (sentenceCount >= maxSentences) {
            // 达到最大句子数，截断
            return text.substring(0, lastEndIndex)
        }
    }

    // 如果没有找到句子结束标记，返回原文
    // 或者句子数没达到限制，也返回原文
    return text
}
