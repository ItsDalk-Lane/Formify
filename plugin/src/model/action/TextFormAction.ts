import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";
import { TargetMode } from "../enums/TargetMode";
import { TextCleanupType } from "../enums/TextCleanupType";
import { DeleteType } from "../enums/DeleteType";
import { FolderDeleteOption } from "../enums/FolderDeleteOption";
import { ContentDeleteType } from "../enums/ContentDeleteType";
import { ContentDeleteRange } from "../enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "../enums/HeadingContentDeleteRange";
import { TextOperationType } from "../enums/TextOperationType";

export type TextActionMode = "operation" | "cleanup";

/**
 * 文本操作配置
 * 用于配置复制图文、导出HTML等文本操作功能
 */
export interface TextOperationConfig {
    /**
     * 操作类型
     */
    type: TextOperationType;

    /**
     * 目标模式：当前文件或选中的文件
     */
    targetMode: TargetMode;

    /**
     * 指定的目标文件路径列表（当targetMode为SPECIFIED时使用）
     */
    targetFiles?: string[];

    /**
     * 导出HTML时的保存路径（仅EXPORT_HTML类型使用）
     * 支持模板变量，如 {{date:YYYY-MM-DD}}
     */
    exportPath?: string;

    /**
     * 是否在导出HTML后打开文件
     */
    openAfterExport?: boolean;
}

export interface ClearFormatConfig {
    targetMode: TargetMode;
    targetFiles?: string[];
    clearAll: boolean;
    basicFormats?: string[];
    linkMediaFormats?: string[];
    structureFormats?: string[];
    advancedFormats?: string[];
    needConfirm: boolean;
    confirmMessage?: string;
}

export interface DeleteFileConfig {
    targetMode: TargetMode;
    targetPaths?: string[];
    deleteType: DeleteType;
    folderDeleteOption?: FolderDeleteOption;
    needConfirm: boolean;
    confirmMessage?: string;
}

export interface DeleteContentConfig {
    targetMode: TargetMode;
    targetFiles?: string[];
    contentDeleteType: ContentDeleteType;
    contentDeleteRange?: ContentDeleteRange;
    headingTitle?: string;
    headingContentDeleteRange?: HeadingContentDeleteRange;
    needConfirm: boolean;
    confirmMessage?: string;
}

export interface TextCleanupConfig {
    type: TextCleanupType;
    clearFormatConfig?: ClearFormatConfig;
    deleteFileConfig?: DeleteFileConfig;
    deleteContentConfig?: DeleteContentConfig;
}

export class TextFormAction extends BaseFormAction {

    type: FormActionType.TEXT;

    mode: TextActionMode;

    textOperationConfig?: TextOperationConfig;

    textCleanupConfig?: TextCleanupConfig;

    constructor(partial?: Partial<TextFormAction>) {
        super(partial);
        this.type = FormActionType.TEXT;
        this.mode = "cleanup";
        this.textOperationConfig = {
            type: TextOperationType.COPY_RICH_TEXT,
            targetMode: TargetMode.CURRENT,
            targetFiles: [],
            exportPath: "",
            openAfterExport: false,
        };
        this.textCleanupConfig = {
            type: TextCleanupType.CLEAR_FORMAT,
            clearFormatConfig: {
                targetMode: TargetMode.CURRENT,
                targetFiles: [],
                clearAll: true,
                basicFormats: [],
                linkMediaFormats: [],
                structureFormats: [],
                advancedFormats: [],
                needConfirm: false,
            },
            deleteFileConfig: {
                targetMode: TargetMode.CURRENT,
                targetPaths: [],
                deleteType: DeleteType.FILE,
                folderDeleteOption: FolderDeleteOption.RECURSIVE,
                needConfirm: true,
            },
            deleteContentConfig: {
                targetMode: TargetMode.CURRENT,
                targetFiles: [],
                contentDeleteType: ContentDeleteType.ENTIRE_CONTENT,
                contentDeleteRange: ContentDeleteRange.ALL,
                headingContentDeleteRange: HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
                needConfirm: true,
            },
        };

        Object.assign(this, partial);
    }
}

