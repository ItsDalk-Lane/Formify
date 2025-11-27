import { App, MarkdownView, TFile } from "obsidian";

export function getEditorSelection(app: App) {
    const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) {
        return "";
    }

    // @ts-ignore
    if (editor.getTableSelection) {
        // @ts-ignore
        const tableSelections = editor.getTableSelection() as TableSelection[];
        if (tableSelections.length > 0) {
            const rows: string[] = []
            for (const tableSelection of tableSelections) {
                const row = tableSelection.row;
                const text = tableSelection.text || ""
                if (rows[row]) {
                    rows[row] = rows[row] + "|" + text
                } else {
                    rows[row] = text
                }
            }
            const result = rows.filter(row => row !== undefined).map((row, index) => {
                return "|" + row + "|"
            }).join("\n")
            return result;
        }
    }
    const selection = editor.getSelection();
    if (selection) {
        return selection;
    }
    return "";
}

/**
 * 获取当前活动Markdown文件的内容
 * @param app Obsidian应用实例
 * @param options 配置选项
 * @returns 文件内容字符串，如果没有活动文件或不是Markdown文件则返回空字符串
 */
export async function getCurrentFileContent(
    app: App, 
    options: {
        includeMetadata?: boolean; // 是否包含元数据
        plainText?: boolean; // 是否清除格式，返回纯文本
    } = {}
): Promise<string> {
    const { includeMetadata = false, plainText = false } = options;
    
    // 获取当前活动的Markdown视图
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
        return "";
    }
    
    // 获取当前文件
    const file = activeView.file;
    if (!file || file.extension !== "md") {
        return "";
    }
    
    // 读取文件内容
    try {
        let content: string;
        
        // 优先使用缓存内容，如果没有则异步读取
        if (app.vault.cachedRead) {
            content = await app.vault.cachedRead(file);
        } else {
            content = await app.vault.read(file);
        }
        
        let processedContent = content;
        
        // 如果不包含元数据，移除frontmatter
        if (!includeMetadata) {
            // 匹配YAML frontmatter (以---开始和结束的块)
            processedContent = processedContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
        }
        
        // 如果需要纯文本，移除Markdown格式
        if (plainText) {
            // 移除Markdown链接格式 [text](url)
            processedContent = processedContent.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            // 移除Markdown图片格式 ![alt](url)
            processedContent = processedContent.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
            // 移除Markdown粗体和斜体格式
            processedContent = processedContent.replace(/\*\*([^*]+)\*\*/g, '$1');
            processedContent = processedContent.replace(/\*([^*]+)\*/g, '$1');
            processedContent = processedContent.replace(/__([^_]+)__/g, '$1');
            processedContent = processedContent.replace(/_([^_]+)_/g, '$1');
            // 移除Markdown标题格式
            processedContent = processedContent.replace(/^#{1,6}\s+/gm, '');
            // 移除Markdown代码块
            processedContent = processedContent.replace(/```[\s\S]*?```/g, '');
            // 移除行内代码
            processedContent = processedContent.replace(/`([^`]+)`/g, '$1');
            // 移除Markdown列表标记
            processedContent = processedContent.replace(/^[\s]*[-*+]\s+/gm, '');
            processedContent = processedContent.replace(/^[\s]*\d+\.\s+/gm, '');
            // 移除Markdown引用标记
            processedContent = processedContent.replace(/^>\s+/gm, '');
            // 移除多余的空行
            processedContent = processedContent.replace(/\n\s*\n\s*\n/g, '\n\n');
        }
        
        return processedContent;
    } catch (err) {
        console.error("Error reading file content:", err);
        return "";
    }
}

type TableSelection = {
    row: number; // start with 0
    col: number; // start with 0
    text: string;
}