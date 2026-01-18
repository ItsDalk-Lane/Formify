import { App, normalizePath, TFile, TFolder } from "obsidian";
import { FormTemplateProcessEngine } from "./engine/FormTemplateProcessEngine";
import { FormState } from "./FormState";
import { createFileByText, CreateFileOptions } from "src/utils/createFileByText";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { validateAndConvertToString, TypeConversionError, FormFieldValidationError } from "src/utils/typeSafety";
import { Strings } from "src/utils/Strings";
import { openFilePathDirectly } from "src/utils/openFilePathDirectly";
import { OpenPageInType } from "src/model/enums/OpenPageInType";
import { localInstance } from "src/i18n/locals";

export type FileConflictStrategy =
    | "error"
    | "overwrite"
    | "rename"
    | "skip"
    | FileConflictResolution;

export type FolderDeleteMode = "recursive" | "files-only" | "folder-only";

export type OpenFileMode =
    | "none"
    | "modal"
    | "new-tab"
    | "current"
    | "split"
    | "new-window"
    | "tab"
    | "window";

export interface WriteFileOptions {
    path: string;
    content?: string;
    template?: string;
    variables?: Record<string, any>;
    state?: FormState;
    createFolders?: boolean;
    conflictStrategy?: FileConflictStrategy;
    confirmOverwrite?: boolean;
    silent?: boolean;
    createFileOptions?: CreateFileOptions;
}

export interface WriteFileResult {
    success: boolean;
    action: "create" | "overwrite" | "skipped";
    path: string;
    bytesWritten?: number;
    error?: string;
    actualPath?: string;
}

export interface DeleteFileOptions {
    paths: string | string[];
    folderMode?: FolderDeleteMode;
    deleteType?: "file" | "folder";
    silent?: boolean;
    state?: FormState;
    variables?: Record<string, any>;
}

export interface DeleteFileResult {
    success: boolean;
    deletedFiles: string[];
    deletedFolders: string[];
    skippedFiles: string[];
    errors: Array<{ path: string; error: string }>;
}

export interface OpenFileOptions {
    path: string;
    mode?: OpenFileMode | OpenPageInType;
    state?: FormState;
    variables?: Record<string, any>;
    silent?: boolean;
}

export interface OpenFileResult {
    success: boolean;
    path: string;
    mode: string;
    error?: string;
}

export class FileOperationService {
    constructor(private readonly app: App) {}

    async writeFile(options: WriteFileOptions): Promise<WriteFileResult> {
        try {
            const state = this.resolveState(options.state, options.variables);
            const engine = new FormTemplateProcessEngine();
            const rawPath = await engine.process(options.path ?? "", state, this.app);
            const filePath = this.normalizeAndValidatePath(rawPath);
            if (!filePath) {
                return {
                    success: false,
                    action: "skipped",
                    path: "",
                    error: "文件路径不能为空",
                };
            }

            const content = await this.resolveContent(options, engine, state);
            const normalized = normalizePath(filePath);
            const existing = this.app.vault.getAbstractFileByPath(normalized);
            const conflictStrategy = options.conflictStrategy ?? FileConflictResolution.OVERWRITE;

            if (this.isConflictStrategy(conflictStrategy, FileConflictResolution.SKIP) && existing) {
                return {
                    success: true,
                    action: "skipped",
                    path: normalized,
                };
            }

            if (this.isConflictStrategy(conflictStrategy, "error") && existing) {
                return {
                    success: false,
                    action: "skipped",
                    path: normalized,
                    error: "目标文件已存在",
                };
            }

            const createFileOptions = options.createFileOptions ?? {
                enableAutoTypeConversion: true,
                strictTypeChecking: false,
                logTypeConversions: process.env.NODE_ENV === "development",
            };

            const resolution = this.mapConflictStrategy(conflictStrategy);
            const file = await createFileByText(this.app, normalized, content, resolution, createFileOptions);
            const finalPath = file.path;
            const writeAction = existing ? "overwrite" : "create";
            const action = resolution === FileConflictResolution.SKIP && existing ? "skipped" : writeAction;

            return {
                success: true,
                action,
                path: normalized,
                actualPath: finalPath !== normalized ? finalPath : undefined,
                bytesWritten: content.length,
            };
        } catch (error) {
            return {
                success: false,
                action: "skipped",
                path: options.path ?? "",
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async deleteFile(options: DeleteFileOptions): Promise<DeleteFileResult> {
        const result: DeleteFileResult = {
            success: true,
            deletedFiles: [],
            deletedFolders: [],
            skippedFiles: [],
            errors: [],
        };

        const state = this.resolveState(options.state, options.variables);
        const engine = new FormTemplateProcessEngine();
        const rawPaths = Array.isArray(options.paths) ? options.paths : [options.paths];
        const resolvedPaths: string[] = [];

        for (const raw of rawPaths) {
            if (Strings.isBlank(raw)) continue;
            const processed = await engine.process(String(raw), state, this.app);
            if (Strings.isBlank(processed)) continue;
            resolvedPaths.push(normalizePath(processed));
        }

        const uniquePaths = Array.from(new Set(resolvedPaths));
        if (uniquePaths.length === 0) {
            result.success = false;
            result.errors.push({ path: "", error: "未提供有效的删除路径" });
            return result;
        }

        const folderMode = options.folderMode ?? "recursive";
        for (const targetPath of uniquePaths) {
            const existing = this.app.vault.getAbstractFileByPath(targetPath);
            if (!existing) {
                result.success = false;
                result.errors.push({ path: targetPath, error: "文件或文件夹不存在" });
                continue;
            }

            if (options.deleteType === "file" && !(existing instanceof TFile)) {
                result.success = false;
                result.errors.push({ path: targetPath, error: "目标不是文件" });
                continue;
            }

            if (options.deleteType === "folder" && !(existing instanceof TFolder)) {
                result.success = false;
                result.errors.push({ path: targetPath, error: "目标不是文件夹" });
                continue;
            }

            try {
                if (existing instanceof TFile) {
                    await this.app.vault.delete(existing);
                    result.deletedFiles.push(existing.path);
                    continue;
                }

                if (folderMode === "recursive") {
                    await this.app.vault.delete(existing, true);
                    result.deletedFolders.push(existing.path);
                    continue;
                }

                if (folderMode === "files-only") {
                    const files = existing.children.filter((child): child is TFile => child instanceof TFile);
                    await Promise.all(files.map((file) => this.app.vault.delete(file)));
                    result.deletedFiles.push(...files.map((file) => file.path));
                    continue;
                }

                if (folderMode === "folder-only") {
                    const folders = existing.children.filter((child): child is TFolder => child instanceof TFolder);
                    for (const folder of folders) {
                        await this.app.vault.delete(folder, true);
                        result.deletedFolders.push(folder.path);
                    }
                }
            } catch (error) {
                result.success = false;
                result.errors.push({
                    path: targetPath,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return result;
    }

    async openFile(options: OpenFileOptions): Promise<OpenFileResult> {
        try {
            const state = this.resolveState(options.state, options.variables);
            const engine = new FormTemplateProcessEngine();
            const rawPath = await engine.process(options.path ?? "", state, this.app);
            const filePath = this.normalizeAndValidatePath(rawPath);
            if (!filePath) {
                return {
                    success: false,
                    path: "",
                    mode: "none",
                    error: "文件路径不能为空",
                };
            }

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile)) {
                return {
                    success: false,
                    path: filePath,
                    mode: String(options.mode ?? "tab"),
                    error: `文件未找到: ${filePath}`,
                };
            }

            const mode = this.normalizeOpenMode(options.mode);
            if (mode === "none") {
                return {
                    success: true,
                    path: filePath,
                    mode,
                };
            }

            openFilePathDirectly(this.app, filePath, mode);
            return {
                success: true,
                path: filePath,
                mode,
            };
        } catch (error) {
            return {
                success: false,
                path: options.path ?? "",
                mode: String(options.mode ?? "tab"),
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private resolveState(state?: FormState, variables?: Record<string, any>): FormState {
        if (state) {
            return state;
        }
        const built = new FormState();
        built.idValues = {};
        built.values = variables ?? {};
        return built;
    }

    private normalizeAndValidatePath(rawPath: string): string {
        const text = String(rawPath ?? "").trim();
        if (!text) {
            return "";
        }
        const invalidChars = /[<>:"|?*]/;
        if (invalidChars.test(text)) {
            throw new Error("文件路径包含非法字符: < > : \" | ? *");
        }
        return normalizePath(text);
    }

    private async resolveContent(
        options: WriteFileOptions,
        engine: FormTemplateProcessEngine,
        state: FormState
    ): Promise<string> {
        if (!Strings.isBlank(options.template ?? "")) {
            const templatePath = await this.validateAndProcessTemplatePath(
                engine,
                options.template ?? "",
                state
            );
            const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
            if (!templateFile || !(templateFile instanceof TFile)) {
                throw new FormFieldValidationError(
                    "templateFile",
                    "file path",
                    `${localInstance.template_file_not_exists}: ${templatePath}`,
                    "请确认模板文件路径是否正确"
                );
            }
            const templateContent = await this.app.vault.cachedRead(templateFile);
            return await this.validateAndProcessContent(engine, templateContent, state, "template content");
        }

        const content = options.content ?? "";
        return await this.validateAndProcessContent(engine, content, state, "direct content");
    }

    private async validateAndProcessTemplatePath(
        engine: FormTemplateProcessEngine,
        templatePath: string,
        state: FormState
    ): Promise<string> {
        try {
            const processedPath = await engine.process(templatePath, state, this.app);
            if (typeof processedPath !== "string") {
                throw new TypeConversionError(
                    processedPath,
                    "string",
                    typeof processedPath,
                    "模板文件路径必须是字符串",
                    {
                        fieldName: "templateFile",
                        actionType: "write_file",
                        usage: "template file path resolution",
                    }
                );
            }

            if (Strings.isBlank(processedPath)) {
                throw new FormFieldValidationError(
                    "templateFile",
                    "file path",
                    "模板文件路径不能为空",
                    "请提供有效的模板文件路径"
                );
            }

            return normalizePath(processedPath);
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                "templateFile",
                "file path",
                `模板文件路径处理失败: ${error instanceof Error ? error.message : String(error)}`,
                "请检查模板文件路径变量是否正确"
            );
        }
    }

    private async validateAndProcessContent(
        engine: FormTemplateProcessEngine,
        content: string,
        state: FormState,
        contentType: string
    ): Promise<string> {
        try {
            const processedContent = await engine.process(content, state, this.app);
            return validateAndConvertToString(processedContent, {
                fieldName: "content",
                actionType: "write_file",
                usage: `${contentType} processing`,
            });
        } catch (error) {
            if (error instanceof TypeConversionError || error instanceof FormFieldValidationError) {
                throw error;
            }
            throw new FormFieldValidationError(
                "content",
                "file content",
                `内容处理失败: ${error instanceof Error ? error.message : String(error)}`,
                "请检查内容模板中的变量是否可转换为字符串"
            );
        }
    }

    private mapConflictStrategy(strategy: FileConflictStrategy): FileConflictResolution {
        if (strategy === FileConflictResolution.SKIP) return FileConflictResolution.SKIP;
        if (strategy === FileConflictResolution.AUTO_RENAME || strategy === "rename") {
            return FileConflictResolution.AUTO_RENAME;
        }
        if (strategy === FileConflictResolution.OVERWRITE || strategy === "overwrite") {
            return FileConflictResolution.OVERWRITE;
        }
        return FileConflictResolution.OVERWRITE;
    }

    private isConflictStrategy(
        strategy: FileConflictStrategy,
        expected: FileConflictStrategy
    ): boolean {
        return String(strategy) === String(expected);
    }

    private normalizeOpenMode(mode?: OpenFileMode | OpenPageInType): OpenFileMode {
        if (!mode) return "tab";
        if (mode === OpenPageInType.tab) return "tab";
        if (mode === OpenPageInType.window) return "window";
        if (mode === OpenPageInType.modal) return "modal";
        if (mode === OpenPageInType.current) return "current";
        if (mode === OpenPageInType.split) return "split";
        if (mode === OpenPageInType.none) return "none";
        if (mode === "new-tab") return "tab";
        if (mode === "new-window") return "window";
        return mode;
    }
}
