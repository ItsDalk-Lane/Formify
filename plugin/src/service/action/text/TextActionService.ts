import { App, normalizePath, Notice, TFile, TFolder, Modal, Setting, arrayBufferToBase64 } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import {
    ClearFormatConfig,
    DeleteContentConfig,
    DeleteFileConfig,
    TextCleanupConfig,
    TextFormAction,
    TextOperationConfig,
} from "src/model/action/TextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { TextCleanupType } from "src/model/enums/TextCleanupType";
import { TargetMode } from "src/model/enums/TargetMode";
import { DeleteType } from "src/model/enums/DeleteType";
import { FolderDeleteOption } from "src/model/enums/FolderDeleteOption";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { ContentDeleteRange } from "src/model/enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "src/model/enums/HeadingContentDeleteRange";
import { TextOperationType } from "src/model/enums/TextOperationType";
import { Strings } from "src/utils/Strings";
import { DebugLogger } from "src/utils/DebugLogger";
import { focusLatestEditor } from "src/utils/focusLatestEditor";
import { FormTemplateProcessEngine } from "../../engine/FormTemplateProcessEngine";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { localInstance } from "src/i18n/locals";
import { TextConverter } from "src/utils/TextConverter";
import * as fs from "fs/promises";
import { FileOperationService, FolderDeleteMode } from "src/service/FileOperationService";

type CleanupResult = {
    processed: string[];
    skipped: string[];
};

export class TextActionService implements IActionService {

    accept(action: IFormAction): boolean {
        return action.type === FormActionType.TEXT;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<void> {
        const formAction = action as TextFormAction;

        try {
            if (formAction.mode === "cleanup") {
                const cleanup = this.ensureCleanupConfig(formAction.textCleanupConfig);
                const executed = await this.executeCleanup(cleanup, context);
                if (executed) {
                    new Notice(localInstance.submit_success);
                }
            } else if (formAction.mode === "operation") {
                // 执行文本操作
                const operation = this.ensureOperationConfig(formAction.textOperationConfig);
                await this.executeOperation(operation, context);
            }
            await chain.next(context);
        } catch (error) {
            DebugLogger.error("[TextActionService] 执行文本动作失败", error);
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`${localInstance.submit_failed}: ${message}`);
            throw error;
        }
    }

    private ensureOperationConfig(config?: TextOperationConfig): TextOperationConfig {
        return {
            type: config?.type ?? TextOperationType.COPY_RICH_TEXT,
            targetMode: config?.targetMode ?? TargetMode.CURRENT,
            targetFiles: config?.targetFiles ?? [],
            exportPath: config?.exportPath ?? "",
            openAfterExport: config?.openAfterExport ?? false,
        };
    }

    private async executeOperation(config: TextOperationConfig, context: ActionContext): Promise<void> {
        switch (config.type) {
            case TextOperationType.COPY_RICH_TEXT:
                await this.copyRichText(config, context);
                break;
            case TextOperationType.COPY_MARKDOWN:
                await this.copyMarkdown(config, context);
                break;
            case TextOperationType.EXPORT_HTML:
                await this.exportHtml(config, context);
                break;
            case TextOperationType.COPY_PLAIN_TEXT:
                await this.copyPlainText(config, context);
                break;
            case TextOperationType.ADD_SPACES_BETWEEN_CJK_AND_ENGLISH:
                await this.addSpacesBetweenCJKAndEnglish(config, context);
                break;
            default:
                throw new Error(`Unsupported operation type: ${config.type}`);
        }
    }

    /**
     * 复制富文本（包含格式和base64图片）
     */
    private async copyRichText(config: TextOperationConfig, context: ActionContext): Promise<void> {
        const app = context.app;
        focusLatestEditor(app);

        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error(localInstance.no_active_md_file);
        }

        const editor = app.workspace.activeEditor?.editor;
        let content: string;

        // 自动检测：如果有选中文本则处理选中部分，否则处理整个文档
        if (editor) {
            const selection = editor.getSelection();
            content = selection || editor.getValue();
        } else {
            content = await app.vault.read(activeFile);
        }

        const htmlContent = await this.convertToHtml(content, activeFile, app);

        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([htmlContent], { type: 'text/html' }),
                'text/plain': new Blob([content], { type: 'text/plain' })
            })
        ]);

        new Notice(localInstance.text_operation_copy_success);
    }

    /**
     * 复制Markdown格式（标准Markdown链接）
     */
    private async copyMarkdown(config: TextOperationConfig, context: ActionContext): Promise<void> {
        const app = context.app;
        focusLatestEditor(app);

        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error(localInstance.no_active_md_file);
        }

        const editor = app.workspace.activeEditor?.editor;
        let content: string;

        // 自动检测：如果有选中文本则处理选中部分，否则处理整个文档
        if (editor) {
            const selection = editor.getSelection();
            content = selection || editor.getValue();
        } else {
            content = await app.vault.read(activeFile);
        }

        // 将Obsidian图片链接转换为标准Markdown链接
        content = await this.replaceImageLinks(content, activeFile, app);

        await navigator.clipboard.writeText(content);
        new Notice(localInstance.text_operation_copy_markdown_success);
    }

    /**
     * 导出为HTML文件
     */
    private async exportHtml(config: TextOperationConfig, context: ActionContext): Promise<void> {
        const app = context.app;
        focusLatestEditor(app);

        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error(localInstance.no_active_md_file);
        }

        const editor = app.workspace.activeEditor?.editor;
        let content: string;

        // 自动检测：如果有选中文本则处理选中部分，否则处理整个文档
        if (editor) {
            const selection = editor.getSelection();
            content = selection || editor.getValue();
        } else {
            content = await app.vault.read(activeFile);
        }

        const htmlContent = await this.convertToHtml(content, activeFile, app);
        const fileName = activeFile.basename + '.html';

        // 使用Electron的dialog选择保存目录
        const { dialog } = require('@electron/remote');
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: localInstance.text_operation_select_export_dir,
            defaultPath: activeFile.parent?.path || ''
        });

        if (result.canceled || result.filePaths.length === 0) {
            new Notice(localInstance.text_operation_export_canceled);
            return;
        }

        let exportFolderPath = result.filePaths[0];
        if (exportFolderPath && !exportFolderPath.endsWith('/') && exportFolderPath !== '/') {
            exportFolderPath += '/';
        }

        const nodeFsPath = exportFolderPath.replace(/\//g, '\\') + fileName;
        await fs.mkdir(exportFolderPath, { recursive: true });
        await fs.writeFile(nodeFsPath, htmlContent);

        new Notice(localInstance.text_operation_export_success + nodeFsPath);

        // 如果配置了导出后打开，则打开文件
        if (config.openAfterExport) {
            require('@electron/remote').shell.openPath(nodeFsPath);
        }
    }

    /**
     * 复制纯文本（移除所有Markdown格式）
     */
    private async copyPlainText(config: TextOperationConfig, context: ActionContext): Promise<void> {
        const app = context.app;
        focusLatestEditor(app);

        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error(localInstance.no_active_md_file);
        }

        const editor = app.workspace.activeEditor?.editor;
        let content: string;

        // 自动检测：如果有选中文本则处理选中部分，否则处理整个文档
        if (editor) {
            const selection = editor.getSelection();
            content = selection || editor.getValue();
        } else {
            content = await app.vault.read(activeFile);
        }

        // 使用TextConverter移除所有Markdown格式
        const plainText = TextConverter.removeAllMarkdownFormats(content);

        // 复制到剪贴板
        await navigator.clipboard.writeText(plainText);
        new Notice(localInstance.text_operation_copy_plain_text_success);
    }

    /**
     * 在中英文之间添加空格
     */
    private async addSpacesBetweenCJKAndEnglish(config: TextOperationConfig, context: ActionContext): Promise<void> {
        const app = context.app;
        focusLatestEditor(app);

        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            throw new Error(localInstance.no_active_md_file);
        }

        const editor = app.workspace.activeEditor?.editor;
        
        if (editor) {
            // 自动检测：如果有选中文本则处理选中部分，否则处理整个文档
            const selection = editor.getSelection();
            if (selection) {
                const processed = TextConverter.addSpacesBetweenCJKAndEnglish(selection);
                editor.replaceSelection(processed);
                new Notice(localInstance.text_operation_add_spaces_success);
            } else {
                // 如果没有选中文本，处理整个文档
                const content = editor.getValue();
                const processed = TextConverter.addSpacesBetweenCJKAndEnglish(content);
                editor.setValue(processed);
                new Notice(localInstance.text_operation_add_spaces_success);
            }
        } else {
            // 处理整个文档
            const content = await app.vault.read(activeFile);
            const processed = TextConverter.addSpacesBetweenCJKAndEnglish(content);
            await app.vault.modify(activeFile, processed);
            new Notice(localInstance.text_operation_add_spaces_success);
        }
    }

    private ensureCleanupConfig(config?: TextCleanupConfig): TextCleanupConfig {
        return {
            type: config?.type ?? TextCleanupType.CLEAR_FORMAT,
            clearFormatConfig: {
                targetMode: config?.clearFormatConfig?.targetMode ?? TargetMode.CURRENT,
                targetFiles: config?.clearFormatConfig?.targetFiles ?? [],
                clearAll: config?.clearFormatConfig?.clearAll ?? true,
                basicFormats: config?.clearFormatConfig?.basicFormats ?? [],
                linkMediaFormats: config?.clearFormatConfig?.linkMediaFormats ?? [],
                structureFormats: config?.clearFormatConfig?.structureFormats ?? [],
                advancedFormats: config?.clearFormatConfig?.advancedFormats ?? [],
                needConfirm: config?.clearFormatConfig?.needConfirm ?? false,
                confirmMessage: config?.clearFormatConfig?.confirmMessage,
            },
            deleteFileConfig: {
                targetMode: config?.deleteFileConfig?.targetMode ?? TargetMode.CURRENT,
                targetPaths: config?.deleteFileConfig?.targetPaths ?? [],
                deleteType: config?.deleteFileConfig?.deleteType ?? DeleteType.FILE,
                folderDeleteOption: config?.deleteFileConfig?.folderDeleteOption ?? FolderDeleteOption.RECURSIVE,
                needConfirm: config?.deleteFileConfig?.needConfirm ?? true,
                confirmMessage: config?.deleteFileConfig?.confirmMessage,
            },
            deleteContentConfig: {
                targetMode: config?.deleteContentConfig?.targetMode ?? TargetMode.CURRENT,
                targetFiles: config?.deleteContentConfig?.targetFiles ?? [],
                contentDeleteType: config?.deleteContentConfig?.contentDeleteType ?? ContentDeleteType.ENTIRE_CONTENT,
                contentDeleteRange: config?.deleteContentConfig?.contentDeleteRange ?? ContentDeleteRange.ALL,
                headingTitle: config?.deleteContentConfig?.headingTitle ?? "",
                headingContentDeleteRange: config?.deleteContentConfig?.headingContentDeleteRange ?? HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
                needConfirm: config?.deleteContentConfig?.needConfirm ?? true,
                confirmMessage: config?.deleteContentConfig?.confirmMessage,
            },
        };
    }

    private async executeCleanup(config: TextCleanupConfig, context: ActionContext): Promise<boolean> {
        switch (config.type) {
            case TextCleanupType.CLEAR_FORMAT:
                return await this.handleClearFormat(config.clearFormatConfig!, context);
            case TextCleanupType.DELETE_FILE:
                return await this.handleDeleteFile(config.deleteFileConfig!, context);
            case TextCleanupType.DELETE_CONTENT:
                return await this.handleDeleteContent(config.deleteContentConfig!, context);
            default:
                throw new Error(`Unsupported cleanup type: ${config.type}`);
        }
    }

    private async handleClearFormat(config: ClearFormatConfig, context: ActionContext): Promise<boolean> {
        const files = await this.resolveMarkdownTargets(config.targetMode, config.targetFiles ?? [], context);
        if (files.length === 0) {
            throw new Error(localInstance.file_not_found);
        }

        const needsConfirm = config.needConfirm === true;
        if (needsConfirm) {
            const confirmed = await this.showConfirm(context, config.confirmMessage ?? localInstance.text_clear_format_confirm_placeholder);
            if (!confirmed) {
                DebugLogger.info("[TextActionService] 用户取消清除格式操作");
                return false;
            }
        }

        const processed: CleanupResult = { processed: [], skipped: [] };
        for (const file of files) {
            try {
                const original = await context.app.vault.read(file);
                const transformed = this.removeFormats(original, config);
                if (transformed !== original) {
                    await context.app.vault.modify(file, transformed);
                }
                processed.processed.push(file.path);
            } catch (error) {
                DebugLogger.error(`[TextActionService] 清除格式失败: ${file.path}`, error);
                processed.skipped.push(file.path);
            }
        }

        if (processed.skipped.length > 0) {
            throw new Error(`处理失败的文件: ${processed.skipped.join(", ")}`);
        }
        return true;
    }

    private removeFormats(content: string, config: ClearFormatConfig): string {
        let result = content;
        const selectedBasic = new Set(config.clearAll ? ["bold", "italic", "strike", "highlight", "inlineCode"] : config.basicFormats);
        const selectedLinkMedia = new Set(config.clearAll ? ["link", "image"] : config.linkMediaFormats);
        const selectedStructure = new Set(config.clearAll ? ["heading", "quote", "list", "table"] : config.structureFormats);
        const selectedAdvanced = new Set(config.clearAll ? ["comment", "footnote", "math", "frontmatter"] : config.advancedFormats);

        if (config.clearAll || selectedBasic.size > 0) {
            if (selectedBasic.has("bold")) {
                result = result.replace(/\*\*(.+?)\*\*/gs, "$1").replace(/__(.+?)__/gs, "$1");
            }
            if (selectedBasic.has("italic")) {
                result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, "$1");
                result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs, "$1");
            }
            if (selectedBasic.has("strike")) {
                result = result.replace(/~~(.+?)~~/gs, "$1");
            }
            if (selectedBasic.has("highlight")) {
                result = result.replace(/==(.+?)==/gs, "$1");
            }
            if (selectedBasic.has("inlineCode")) {
                result = result.replace(/`([^`]+?)`/g, "$1");
            }
        }

        if (config.clearAll || selectedLinkMedia.size > 0) {
            if (selectedLinkMedia.has("link")) {
                result = result.replace(/\[([^\]]*?)\]\([^)]*?\)/g, "$1");
            }
            if (selectedLinkMedia.has("image")) {
                result = result.replace(/!\[([^\]]*?)\]\([^)]*?\)/g, "$1");
                // 清除 Obsidian 嵌入格式 ![[笔记名称]]
                result = result.replace(/!\[\[([^\]]*?)\]\]/g, "$1");
            }
        }

        if (config.clearAll || selectedStructure.size > 0) {
            if (selectedStructure.has("heading")) {
                result = result.replace(/^#{1,6}\s*(.+)$/gm, "$1");
            }
            if (selectedStructure.has("quote")) {
                result = result.replace(/^>+\s?(.*)$/gm, "$1");
            }
            if (selectedStructure.has("list")) {
                result = result.replace(/^\s*([-+*]|\d+[.)])\s+/gm, "");
            }
            if (selectedStructure.has("table")) {
                result = result.replace(/^\|(.+?)\|$/gm, (_, group1) => group1.replace(/\s*\|\s*/g, " "));
                result = result.replace(/^\s*[:|-]+\s*$/gm, "");
            }
        }

        if (config.clearAll || selectedAdvanced.size > 0) {
            if (selectedAdvanced.has("comment")) {
                result = result.replace(/%%([^%]*?)%%/g, "$1");
                result = result.replace(/<!--([\s\S]*?)-->/g, "$1");
            }
            if (selectedAdvanced.has("footnote")) {
                result = result.replace(/\[\^[^\]]+?\]/g, "");
                result = result.replace(/^\[\^[^\]]+?\]:.*$/gm, "");
            }
            if (selectedAdvanced.has("math")) {
                result = result.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
                result = result.replace(/\$(.+?)\$/g, "$1");
            }
            if (selectedAdvanced.has("frontmatter")) {
                result = result.replace(/^---[\s\S]*?^---\s*$/m, "");
            }
        }

        // 清理重复空行
        result = result.replace(/\n{3,}/g, "\n\n");
        return result.trimEnd();
    }

    private async handleDeleteFile(config: DeleteFileConfig, context: ActionContext): Promise<boolean> {
        const paths = await this.resolveDeleteTargets(config, context);
        if (paths.length === 0) {
            throw new Error(localInstance.file_not_found);
        }

        if (config.needConfirm !== false) {
            const confirmed = await this.showConfirm(context, config.confirmMessage ?? localInstance.text_delete_file_confirm_placeholder);
            if (!confirmed) {
                DebugLogger.info("[TextActionService] 用户取消删除文件操作");
                return false;
            }
        }

        const fileService = new FileOperationService(context.app);
        const folderMode = this.mapFolderDeleteOption(config.folderDeleteOption);
        const deleteType =
            config.targetMode === TargetMode.CURRENT
                ? "file"
                : (config.deleteType === DeleteType.FILE ? "file" : "folder");

        const result = await fileService.deleteFile({
            paths,
            deleteType,
            folderMode,
            state: context.state,
        });

        if (!result.success) {
            const firstError = result.errors[0];
            if (firstError) {
                throw new Error(`${firstError.path} ${firstError.error}`);
            }
            throw new Error(localInstance.unknown_error);
        }
        return true;
    }

    private async handleDeleteContent(config: DeleteContentConfig, context: ActionContext): Promise<boolean> {
        const files = await this.resolveVaultTargets(config.targetMode, config.targetFiles ?? [], context, true);
        if (files.length === 0) {
            throw new Error(localInstance.file_not_found);
        }

        if (config.needConfirm !== false) {
            const confirmed = await this.showConfirm(context, config.confirmMessage ?? localInstance.text_delete_content_confirm_placeholder);
            if (!confirmed) {
                DebugLogger.info("[TextActionService] 用户取消删除内容操作");
                return false;
            }
        }

        for (const path of files) {
            const target = context.app.vault.getAbstractFileByPath(path);
            if (!(target instanceof TFile)) {
                throw new Error(`${path} ${localInstance.file_not_found}`);
            }

            const original = await context.app.vault.read(target);
            let updated = original;

            if (config.contentDeleteType === ContentDeleteType.ENTIRE_CONTENT) {
                updated = this.deleteEntireContent(original, config.contentDeleteRange ?? ContentDeleteRange.ALL);
            } else {
                updated = this.deleteHeadingContent(original, config.headingTitle ?? "", config.headingContentDeleteRange ?? HeadingContentDeleteRange.TO_SAME_OR_HIGHER);
            }

            if (updated !== original) {
                await context.app.vault.modify(target, updated);
            }
        }
        return true;
    }

    private deleteEntireContent(content: string, range: ContentDeleteRange): string {
        if (range === ContentDeleteRange.ALL) {
            return "";
        }

        // 保留 frontmatter
        const match = content.match(/^---[\s\S]*?^---\s*$/m);
        if (match) {
            const frontmatter = match[0];
            return `${frontmatter}\n`;
        }
        return "";
    }

    private deleteHeadingContent(content: string, headingTitle: string, range: HeadingContentDeleteRange): string {
        if (Strings.isBlank(headingTitle)) {
            throw new Error(localInstance.text_heading_title_description);
        }

        const lines = content.split("\n");
        const headingIndex = lines.findIndex((line) => {
            const match = line.match(/^(#{1,6})\s+(.*)$/);
            if (!match) return false;
            const title = match[2].trim();
            return title === headingTitle.trim();
        });

        if (headingIndex === -1) {
            throw new Error(`未找到标题: ${headingTitle}`);
        }

        const levelMatch = lines[headingIndex].match(/^(#{1,6})\s+/);
        const targetLevel = levelMatch ? levelMatch[1].length : 1;

        switch (range) {
            case HeadingContentDeleteRange.TO_SAME_OR_HIGHER:
                // 删除标题下的内容,直到遇到同级或更高级标题,保留目标标题本身
                const nextSameOrHigherIndex = this.findNextHeadingIndex(lines, headingIndex + 1, targetLevel);
                if (nextSameOrHigherIndex > headingIndex + 1) {
                    lines.splice(headingIndex + 1, nextSameOrHigherIndex - (headingIndex + 1));
                }
                break;
            case HeadingContentDeleteRange.ALL_CHILDREN:
                // 删除标题下的所有内容,直到文件末尾,不管有什么级别的标题都删除
                if (lines.length > headingIndex + 1) {
                    lines.splice(headingIndex + 1, lines.length - (headingIndex + 1));
                }
                break;
            case HeadingContentDeleteRange.BODY_ONLY:
                // 仅删除标题下的正文内容,不包括子标题及其内容
                const firstChildHeadingIndex = this.findNextHeadingLine(lines, headingIndex + 1);
                const endIndex = firstChildHeadingIndex === -1 
                    ? this.findNextHeadingIndex(lines, headingIndex + 1, targetLevel)
                    : firstChildHeadingIndex;
                if (endIndex > headingIndex + 1) {
                    lines.splice(headingIndex + 1, endIndex - (headingIndex + 1));
                }
                break;
        }

        return lines.join("\n").replace(/\n{3,}/g, "\n\n");
    }

    private findNextHeadingIndex(lines: string[], start: number, targetLevel: number): number {
        for (let i = start; i < lines.length; i++) {
            const match = lines[i].match(/^(#{1,6})\s+/);
            if (!match) continue;
            const level = match[1].length;
            if (level <= targetLevel) {
                return i;
            }
        }
        return lines.length;
    }

    private findNextHeadingLine(lines: string[], start: number): number {
        for (let i = start; i < lines.length; i++) {
            if (/^#{1,6}\s+/.test(lines[i])) {
                return i;
            }
        }
        return -1;
    }

    private async resolveMarkdownTargets(targetMode: TargetMode, specified: string[], context: ActionContext): Promise<TFile[]> {
        const paths = await this.resolveVaultTargets(targetMode, specified, context, true);
        const files: TFile[] = [];
        for (const path of paths) {
            const file = context.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                if (file.extension !== "md") {
                    throw new Error(`${path} 不是 Markdown 文件`);
                }
                files.push(file);
            } else {
                throw new Error(`${path} ${localInstance.file_not_found}`);
            }
        }
        return files;
    }

    private async resolveVaultTargets(targetMode: TargetMode, specified: string[], context: ActionContext, expectFile = false): Promise<string[]> {
        const app = context.app;
        const engine = new FormTemplateProcessEngine();
        if (targetMode === TargetMode.CURRENT) {
            focusLatestEditor(app);
            const activeFile = app.workspace.getActiveFile();
            if (!activeFile) {
                throw new Error(localInstance.no_active_md_file);
            }
            return [activeFile.path];
        }

        const resolved: string[] = [];
        for (const raw of specified) {
            if (Strings.isBlank(raw)) continue;
            const processed = await engine.process(raw, context.state, app);
            if (Strings.isBlank(processed)) continue;
            resolved.push(normalizePath(processed));
        }
        return Array.from(new Set(resolved));
    }

    private mapFolderDeleteOption(option?: FolderDeleteOption): FolderDeleteMode {
        if (option === FolderDeleteOption.FILES_ONLY) {
            return "files-only";
        }
        if (option === FolderDeleteOption.FOLDERS_ONLY) {
            return "folder-only";
        }
        return "recursive";
    }

    private async showConfirm(context: ActionContext, message: string): Promise<boolean> {
        const renderedMessage = await this.renderTemplate(message, context);
        const display = Strings.isBlank(renderedMessage) ? message : renderedMessage;
        return new Promise((resolve) => {
            const modal = new TextActionConfirmModal(context.app, display, resolve);
            modal.open();
        });
    }
    private async resolveDeleteTargets(config: DeleteFileConfig, context: ActionContext): Promise<string[]> {
        const app = context.app;
        if (config.targetMode === TargetMode.CURRENT) {
            focusLatestEditor(app);
            const activeFile = app.workspace.getActiveFile();
            if (!activeFile) {
                throw new Error(localInstance.no_active_md_file);
            }
            // 当前文件模式下,始终返回当前文件路径,不考虑 deleteType
            return [activeFile.path];
        }

        const engine = new FormTemplateProcessEngine();
        const resolved: string[] = [];
        for (const raw of config.targetPaths ?? []) {
            if (Strings.isBlank(raw)) continue;
            const processed = await engine.process(raw, context.state, app);
            if (Strings.isBlank(processed)) continue;
            resolved.push(normalizePath(processed));
        }
        return Array.from(new Set(resolved));
    }

    private async renderTemplate(template: string, context: ActionContext): Promise<string> {
        if (Strings.isBlank(template)) {
            return template;
        }
        const engine = new FormTemplateProcessEngine();
        return await engine.process(template, context.state, context.app);
    }

    // ========== 文本操作相关方法 ==========

    /**
     * 将Obsidian内部图片链接(![[...]])替换为base64内联图片
     */
    private async replaceImageWithBase64(imagePath: string, file: TFile, app: App): Promise<{ original: string; replacement: string }> {
        try {
            const fileName = imagePath.split('/').pop() || imagePath;
            const imageFile = app.vault.getFiles().find(f =>
                f.name.toLowerCase().includes(fileName.toLowerCase())
            );

            if (!imageFile) {
                return { original: `![[${imagePath}]]`, replacement: `[${localInstance.text_operation_image_not_found}: ${imagePath}]` };
            }

            const stat = await app.vault.adapter.stat(imageFile.path);
            if (stat && stat.size > 10 * 1024 * 1024) {
                return { original: `![[${imagePath}]]`, replacement: `[${localInstance.text_operation_image_too_large}: ${imagePath}]` };
            }

            const imageArrayBuffer = await app.vault.readBinary(imageFile);
            const base64 = arrayBufferToBase64(imageArrayBuffer);
            const mimeType = this.getMimeType(imagePath);

            return {
                original: `![[${imagePath}]]`,
                replacement: `<img src="data:${mimeType};base64,${base64}" alt="${imagePath}" style="max-width: 100%;">`
            };
        } catch (error) {
            DebugLogger.error("[TextActionService] 处理图片失败", error);
            return { original: `![[${imagePath}]]`, replacement: `[${localInstance.text_operation_image_process_error}: ${imagePath}]` };
        }
    }

    /**
     * 将外部图片链接(file:///)替换为base64内联图片
     */
    private async replaceExternalImageWithBase64(imagePath: string): Promise<{ original: string; replacement: string }> {
        try {
            let filePath = imagePath.replace(/^file:\/\/\//, '');

            if (process.platform === 'win32') {
                filePath = filePath.replace(/\//g, '\\');
            }

            const imageBuffer = await fs.readFile(filePath);
            const base64 = imageBuffer.toString('base64');
            const mimeType = this.getMimeType(filePath);

            return {
                original: `![](${imagePath})`,
                replacement: `<img src="data:${mimeType};base64,${base64}" alt="${imagePath}" style="max-width: 100%;">`
            };
        } catch (error) {
            DebugLogger.error("[TextActionService] 处理外部图片失败", error);
            return { original: `![](${imagePath})`, replacement: `[${localInstance.text_operation_external_image_error}: ${imagePath}]` };
        }
    }

    /**
     * 将Obsidian内部图片链接转换为标准Markdown格式（file:///路径）
     */
    private async replaceImageLinks(content: string, file: TFile, app: App): Promise<string> {
        const imageRegex = /!\[\[(.*?)\]\]/g;
        let result = content;

        for (const match of content.matchAll(imageRegex)) {
            const imagePath = match[1];
            const imageFile = app.vault.getFiles().find(f =>
                f.name.toLowerCase().includes(imagePath.split('/').pop()?.toLowerCase() || '')
            );

            if (imageFile) {
                let absolutePath = app.vault.getResourcePath(imageFile)
                    .replace(/^app:\/\/.*?\//, '')
                    .replace(/\?.*$/, '')
                    .replace(/\\/g, '/');

                absolutePath = decodeURI(absolutePath);

                const fileUrl = 'file:///' + absolutePath;

                result = result.replace(
                    `![[${imagePath}]]`,
                    `![${imagePath}](${fileUrl})`
                );
            }
        }

        return result;
    }

    /**
     * 获取文件的MIME类型
     */
    private getMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'webp':
                return 'image/webp';
            case 'svg':
                return 'image/svg+xml';
            default:
                return 'image/png';
        }
    }

    /**
     * 将Markdown转换为HTML格式
     */
    private async convertToHtml(content: string, file: TFile, app: App): Promise<string> {
        const imageRegex = /!\[\[(.*?)\]\]/g;
        const externalImageRegex = /!\[.*?\]\((file:\/\/\/.+?)\)/g;

        // 处理内部图片
        const internalImageReplacements = await Promise.all(
            Array.from(content.matchAll(imageRegex)).map(
                match => this.replaceImageWithBase64(match[1], file, app)
            )
        );

        let htmlContent = content;
        // 预处理：将连续的空行减少为单个空行
        htmlContent = htmlContent.replace(/\n\s*\n/g, '\n\n');

        internalImageReplacements.forEach(({ original, replacement }) => {
            htmlContent = htmlContent.replace(original, replacement);
        });

        // 处理外部图片
        const externalImageReplacements = await Promise.all(
            Array.from(htmlContent.matchAll(externalImageRegex)).map(
                match => this.replaceExternalImageWithBase64(match[1])
            )
        );

        externalImageReplacements.forEach(({ original, replacement }) => {
            htmlContent = htmlContent.replace(original, replacement);
        });

        // 处理代码块
        const codeBlockPlaceholders = new Map<string, string>();
        let placeholderIndex = 0;

        htmlContent = htmlContent.replace(/(^|\n)```(\w+)?\n([\s\S]*?)\n(?<!\S)```($|\n)/g, (match, p1, lang, code) => {
            const placeholder = `___CODE_BLOCK_PLACEHOLDER_${placeholderIndex}___`;
            const language = this.getLanguageFromCodeBlock(match);
            const lines = code.split('\n');

            let codeHtml = '';
            for (let i = 0; i < lines.length; i++) {
                const highlightedLine = this.highlightCodeLine(lines[i]);
                codeHtml += `<code><span leaf="">${highlightedLine}</span></code>\n`;
            }

            const lineNumbersHtml = Array.from({ length: lines.length }, (_, i) => `<li></li>`).join('\n');

            const codeBlockHtml = `
<section class="code-snippet__js code-snippet__fix code-snippet__${language}">
  <ul class="code-snippet__line-index code-snippet__${language}">
    ${lineNumbersHtml}
  </ul>
  <pre class="code-snippet__js code-snippet code-snippet_nowrap" data-lang="${language}">
    ${codeHtml.trim()}
  </pre>
</section>`;

            codeBlockPlaceholders.set(placeholder, codeBlockHtml);
            placeholderIndex++;
            return placeholder;
        });

        // 转换分隔线
        htmlContent = htmlContent.replace(/^---$/gm, '<hr style="border: 0; border-top: 1px solid #ddd; margin: 20px 0;">');

        // 转换标题
        htmlContent = htmlContent.replace(/^(#+)\s+(.*?)$/gm, (match, hashes, title) => {
            const level = hashes.length;
            const fontSize = 28 - (level * 2);
            return `<h${level} style="font-size: ${fontSize}px; font-weight: bold; margin: 10px 0;">${title}</h${level}>`;
        });

        // 先转换内联格式（避免被换行打断）
        // 使用[^\n]而不是.来避免跨行匹配
        htmlContent = htmlContent
            .replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>')
            .replace(/`([^\n`]+?)`/g, '<code style="background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px;">$1</code>');

        // 转换高亮
        htmlContent = htmlContent.replace(/==([^=\n]+?)==/g, (match, p1) => {
            return `<span style="background-color: yellow;">${p1}</span>`;
        });

        // 转换链接（避免跨行）
        htmlContent = htmlContent
            .replace(/(?<!\!)\[([^\n\]]+?)\]\(([^\n)]+?)\)/g, '<a href="$2" style="color: #576b95; text-decoration: none;">$1</a>');

        // 最后转换换行
        htmlContent = htmlContent.replace(/\n/g, '<br>');

        // 恢复代码块
        codeBlockPlaceholders.forEach((value, key) => {
            htmlContent = htmlContent.replace(key, value);
        });

        htmlContent = this.cleanAndFormatHtml(htmlContent);
        return `<div style="max-width: 800px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; line-height: 1.6;">${htmlContent}</div>`;
    }

    private cleanAndFormatHtml(html: string): string {
        // 移除标签之间的多余空白，但保留标签内的内容
        // 注意：不要移除所有空白，某些空白在Word中是有意义的
        html = html.replace(/>\s+</g, '><');

        // 移除连续的换行符，只保留一个
        html = html.replace(/\n\n+/g, '\n');

        // 移除开头和结尾的换行符
        html = html.trim();

        return html;
    }

    private getLanguageFromCodeBlock(codeBlockHeader: string): string {
        const match = codeBlockHeader.match(/```(\w+)?/);
        return match && match[1] ? match[1] : 'js';
    }

    private highlightCodeLine(line: string): string {
        // 替换开头的空格为 &nbsp;
        let processedLine = line.replace(/^( +)/g, (match) => {
            return match.replace(/ /g, '&nbsp;');
        });

        // 替换行内连续的两个或更多空格为 &nbsp;
        processedLine = processedLine.replace(/ {2,}/g, (match) => {
            return match.replace(/ /g, '&nbsp;');
        });

        // 简化语法高亮：只处理字符串
        processedLine = processedLine.replace(/(["'`])(.*?)\1/g, (match, quote, content) => {
            const escapedContent = this.escapeHtml(content);
            return `${quote}<span class="code-snippet__string">${escapedContent}</span>${quote}`;
        });

        // 恢复之前转义的引号
        processedLine = processedLine.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&grave;/g, '`');

        return processedLine;
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/#/g, "&#35;");
    }
}


class TextActionConfirmModal extends Modal {
    constructor(app: App, private message: string, private onResult: (result: boolean) => void) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: localInstance.confirm_to_operation });
        contentEl.createEl("p", { text: this.message });

        const buttonWrapper = new Setting(contentEl);
        buttonWrapper.addButton((btn) =>
            btn
                .setButtonText(localInstance.cancel)
                .onClick(() => {
                    this.onResult(false);
                    this.close();
                })
        );
        buttonWrapper.addButton((btn) =>
            btn
                .setButtonText(localInstance.confirm)
                .setCta()
                .onClick(() => {
                    this.onResult(true);
                    this.close();
                })
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

