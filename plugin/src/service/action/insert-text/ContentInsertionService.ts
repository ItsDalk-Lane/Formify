import { App, MarkdownView } from "obsidian";
import { localInstance } from "src/i18n/locals";
import { focusLatestEditor } from "src/utils/focusLatestEditor";

export default class {

    async insertToCurrentCursor(app: App, content: string) {
        focusLatestEditor(app);
        const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;

        if (editor) {
            const cursor = editor.getCursor("from");
            const end = editor.getCursor("to");
            const origin = editor.getSelection();
            editor.replaceRange(content, cursor, end, origin);
            // update cursor to the end of the inserted content
            const newCursor = {
                line: cursor.line,
                ch: cursor.ch + content.length
            };
            editor.setCursor(newCursor);
        } else {
            throw new Error(localInstance.please_open_and_focus_on_markdown_file);
        }
    }

    /**
      * 将内容写入到笔记底部
      * @param app Obsidian App 实例
      * @param filePath 文件路径
      * @param content 要插入的内容
      */
    async insertToBottomOfNote(app: App, filePath: string, content: string): Promise<void> {
        try {
            const file = app.vault.getAbstractFileByPath(filePath);
            if (!file) {
                throw new Error(localInstance.file_not_found + ": " + filePath);
            }
            
            await app.vault.process(file as any, (rawContent) => {
                // 确保在内容之间有一个换行符
                return rawContent.endsWith('\n')
                    ? rawContent + content
                    : rawContent + '\n' + content;
            });
        } catch (error) {
            throw new Error(localInstance.submit_failed + ":" + error);
        }
    }

    /**
     * 将内容写入到笔记顶部
     * @param app Obsidian App 实例
     * @param filePath 文件路径
     * @param content 要插入的内容
     */
    async insertToTopOfNote(app: App, filePath: string, content: string): Promise<void> {
        try {
            const file = app.vault.getAbstractFileByPath(filePath);
            if (!file) {
                throw new Error(localInstance.file_not_found + ": " + filePath);
            }
            
            const metaCache = app.metadataCache.getCache(filePath);
            if (!metaCache) {
                // 🔄 备用方案：当元数据缓存不可用时，手动解析 frontmatter
                await this.insertWhenNoCacheUsingVaultAPI(app, filePath, content);
                return;
            }
            
            const frontmatterPosition = metaCache.frontmatterPosition;
            
            await app.vault.process(file as any, (rawContent) => {
                const rawContentLines = rawContent.split('\n');
                if (frontmatterPosition) {
                    const endLine = frontmatterPosition.end.line;
                    const frontmatterContent = rawContentLines.slice(0, endLine + 1).join('\n');
                    const restContent = rawContentLines.slice(endLine + 1).join('\n');
                    return frontmatterContent + '\n' + content + (restContent.startsWith('\n') ? '' : '\n') + restContent;
                } else {
                    // 没有 frontmatter，直接在开头插入
                    return content + (rawContent.startsWith('\n') ? '' : '\n') + rawContent;
                }
            });
        } catch (error) {
            // 🔄 错误处理：如果主要逻辑失败，尝试备用方案
            console.warn('Primary insertToTopOfNote method failed, trying fallback:', error);
            await this.insertWhenNoCacheUsingVaultAPI(app, filePath, content);
        }
    }

    /**
     * 备用方案：当元数据缓存不可用时手动解析 frontmatter 并插入内容（使用 Vault API）
     * @param app Obsidian App 实例
     * @param filePath 文件路径
     * @param content 要插入的内容
     */
    private async insertWhenNoCacheUsingVaultAPI(app: App, filePath: string, content: string): Promise<void> {
        try {
            const file = app.vault.getAbstractFileByPath(filePath);
            if (!file) {
                throw new Error(localInstance.file_not_found + ": " + filePath);
            }
            
            await app.vault.process(file as any, (rawContent) => {
                const lines = rawContent.split('\n');
                
                let frontmatterEndLine = -1;
                
                // 🔍 手动解析 frontmatter
                if (lines.length > 0 && lines[0].trim() === '---') {
                    // 查找 frontmatter 结束位置
                    for (let i = 1; i < lines.length; i++) {
                        if (lines[i].trim() === '---') {
                            frontmatterEndLine = i;
                            break;
                        }
                    }
                }
                
                if (frontmatterEndLine > 0) {
                    // 找到了有效的 frontmatter
                    const frontmatterContent = lines.slice(0, frontmatterEndLine + 1).join('\n');
                    const restContent = lines.slice(frontmatterEndLine + 1).join('\n');
                    
                    // 在 frontmatter 后面插入内容
                    let newContent = frontmatterContent + '\n' + content;
                    
                    // 如果剩余内容不为空且不是以换行符开始，添加换行符
                    if (restContent.trim() !== '') {
                        newContent += (restContent.startsWith('\n') ? '' : '\n') + restContent;
                    }
                    
                    return newContent;
                } else {
                    // 没有找到 frontmatter，直接在文件开头插入内容
                    return content + (rawContent.startsWith('\n') ? '' : '\n') + rawContent;
                }
            });
        } catch (error) {
            // 🚨 如果备用方案也失败了，抛出详细的错误信息
            console.error('Fallback insert method also failed:', error);
            throw new Error(`${localInstance.submit_failed}: ${error.message}`);
        }
    }

    /**
     * 在指定标题下方的顶部插入内容
     * @param app Obsidian App 实例
     * @param filePath 文件路径
     * @param heading 标题文本（含 # 符号）
     * @param content 要插入的内容
     */
    async insertToTopBelowTitle(app: App, filePath: string, heading: string, content: string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) {
            throw new Error(localInstance.file_not_found + ": " + filePath);
        }
        
        await app.vault.process(file as any, (rawContent) => {
            const task = `${content}`;
            const rawContentLines = rawContent.split('\n');
            let added = false;
            const newContentLines = rawContentLines.flatMap((line, index) => {
                if (added) {
                    return [line];
                }
                if (line === heading) {
                    added = true;
                    return [line, task];
                }
                return [line];
            });

            if (added) {
                return newContentLines.join('\n');
            } else {
                return rawContent + '\n' + heading + '\n' + task;
            }
        });
    }

    /**
     * 在指定标题区域的底部插入内容
     * @param app Obsidian App 实例
     * @param filePath 文件路径
     * @param heading 标题文本（含 # 符号）
     * @param content 要插入的内容
     */
    async insertToBottomBelowTitle(app: App, filePath: string, heading: string, content: string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) {
            throw new Error(localInstance.file_not_found + ": " + filePath);
        }
        
        await app.vault.process(file as any, (rawContent) => {
            const insertingText = `${content}`;
            const rawContentLines = rawContent.split('\n');
            let headingFound = false;
            let added = false;
            const newContentLines = rawContentLines.flatMap((line, index) => {
                if (added) {
                    return [line];
                }
                if (line === heading && !headingFound) {
                    headingFound = true;
                    return [line];
                }

                if (headingFound) {
                    const isHeadingLine = line.match(/^#+ /);
                    if (isHeadingLine) {
                        added = true;
                        return [insertingText, line];
                    }
                }
                return [line];
            });

            if (added) {
                return newContentLines.join('\n');
            } else {
                if (headingFound) {
                    const isEndsWithNewLine = rawContent.endsWith('\n');
                    return isEndsWithNewLine ? rawContent + insertingText : rawContent + '\n' + insertingText;
                } else {
                    return rawContent + '\n' + heading + '\n' + insertingText;
                }
            }
        });
    }
}