import { FileConflictResolution } from "../enums/FileConflictResolution";
import { FormActionType } from "../enums/FormActionType";
import { OpenPageInType } from "../enums/OpenPageInType";
import { CreateFileMode } from "../enums/CreateFileMode";
import { FileBaseFormAction } from "./FileBaseFormAction";

export class CreateFileFormAction extends FileBaseFormAction {
    type: FormActionType.CREATE_FILE;
    openPageIn: OpenPageInType;
    contentTemplateSource: ContentTemplateSource;
    content: string;
    templateFile: string;
    conflictResolution?: FileConflictResolution;
    createFileMode: CreateFileMode;
    batchFilePaths?: string[];
    folderPath?: string;
    batchFolderPaths?: string[];

    constructor(partial?: Partial<CreateFileFormAction>) {
        super(partial);
        this.type = FormActionType.CREATE_FILE;
        this.openPageIn = OpenPageInType.current;
        this.contentTemplateSource = ContentTemplateSource.TEXT;
        this.content = "";
        this.templateFile = "";
        this.conflictResolution = FileConflictResolution.SKIP;
        this.createFileMode = CreateFileMode.SINGLE_FILE;
        this.batchFilePaths = [];
        this.folderPath = "";
        this.batchFolderPaths = [];
        Object.assign(this, partial);
    }
}

export enum ContentTemplateSource {
    FILE = "file",
    TEXT = "text",
}
