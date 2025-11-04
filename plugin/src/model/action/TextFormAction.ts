import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";
import { TargetMode } from "../enums/TargetMode";
import { TextCleanupType } from "../enums/TextCleanupType";
import { DeleteType } from "../enums/DeleteType";
import { FolderDeleteOption } from "../enums/FolderDeleteOption";
import { ContentDeleteType } from "../enums/ContentDeleteType";
import { ContentDeleteRange } from "../enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "../enums/HeadingContentDeleteRange";

export type TextActionMode = "operation" | "cleanup";

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

    textOperationConfig?: Record<string, unknown>;

    textCleanupConfig?: TextCleanupConfig;

    constructor(partial?: Partial<TextFormAction>) {
        super(partial);
        this.type = FormActionType.TEXT;
        this.mode = "cleanup";
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

