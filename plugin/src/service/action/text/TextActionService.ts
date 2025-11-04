import { App, normalizePath, Notice, TFile, TFolder, Modal, Setting } from "obsidian";
import { IFormAction } from "src/model/action/IFormAction";
import {
    ClearFormatConfig,
    DeleteContentConfig,
    DeleteFileConfig,
    TextCleanupConfig,
    TextFormAction,
} from "src/model/action/TextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { TextCleanupType } from "src/model/enums/TextCleanupType";
import { TargetMode } from "src/model/enums/TargetMode";
import { DeleteType } from "src/model/enums/DeleteType";
import { FolderDeleteOption } from "src/model/enums/FolderDeleteOption";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { ContentDeleteRange } from "src/model/enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "src/model/enums/HeadingContentDeleteRange";
import { Strings } from "src/utils/Strings";
import { DebugLogger } from "src/utils/DebugLogger";
import { focusLatestEditor } from "src/utils/focusLatestEditor";
import { FormTemplateProcessEngine } from "../../engine/FormTemplateProcessEngine";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { localInstance } from "src/i18n/locals";

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
            } else {
                DebugLogger.info("[TextActionService] 文本操作模式暂未实现");
                new Notice(localInstance.text_action_operation_description);
            }
            await chain.next(context);
        } catch (error) {
            DebugLogger.error("[TextActionService] 执行文本动作失败", error);
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`${localInstance.submit_failed}: ${message}`);
            throw error;
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

        for (const path of paths) {
            const abstractFile = context.app.vault.getAbstractFileByPath(path);
            if (!abstractFile) {
                throw new Error(`${localInstance.file_not_found}: ${path}`);
            }

            // 当前文件模式下,仅删除文件本身
            if (config.targetMode === TargetMode.CURRENT) {
                if (!(abstractFile instanceof TFile)) {
                    throw new Error(`${path} ${localInstance.file_not_found}`);
                }
                await context.app.vault.delete(abstractFile);
            } else {
                // 指定文件模式下,根据 deleteType 决定删除行为
                if (config.deleteType === DeleteType.FILE) {
                    if (!(abstractFile instanceof TFile)) {
                        throw new Error(`${path} ${localInstance.file_not_found}`);
                    }
                    await context.app.vault.delete(abstractFile);
                } else {
                    if (!(abstractFile instanceof TFolder)) {
                        throw new Error(`${path} ${localInstance.folder_path_required}`);
                    }
                    await this.deleteFolder(abstractFile, config.folderDeleteOption ?? FolderDeleteOption.RECURSIVE, context);
                }
            }
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

    private async deleteFolder(folder: TFolder, option: FolderDeleteOption, context: ActionContext): Promise<void> {
        const vault = context.app.vault;
        if (option === FolderDeleteOption.RECURSIVE) {
            await vault.delete(folder, true);
            return;
        }

        if (option === FolderDeleteOption.FILES_ONLY) {
            const promises: Promise<void>[] = [];
            folder.children.forEach((child) => {
                if (child instanceof TFile) {
                    promises.push(vault.delete(child));
                }
            });
            await Promise.all(promises);
            return;
        }

        if (option === FolderDeleteOption.FOLDERS_ONLY) {
            const folders = folder.children.filter((child): child is TFolder => child instanceof TFolder);
            for (const childFolder of folders) {
                await vault.delete(childFolder, true);
            }
        }
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

