import { App, TFile, TFolder } from 'obsidian';
import { FormConfig } from '../model/FormConfig';
import {
    FormImportOptions,
    FormImportResult,
    ImportSummary,
    ImportableFormInfo,
    ImportProgress,
    ImportConflict,
    ImportConflictType,
    ConflictResolution,
    FormImportFilter
} from '../model/FormImport';
import { IFormField } from '../model/field/IFormField';
import { IFormAction } from '../model/action/IFormAction';
import { v4 as uuidv4 } from 'uuid';

export class FormImportService {
    private app: App;
    private progressCallback?: (progress: ImportProgress) => void;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 设置进度回调函数
     */
    setProgressCallback(callback: (progress: ImportProgress) => void): void {
        this.progressCallback = callback;
    }

    /**
     * 更新导入进度
     */
    private updateProgress(step: string, percentage: number, details?: string): void {
        if (this.progressCallback) {
            this.progressCallback({
                step,
                percentage,
                details,
                processing: percentage < 100
            });
        }
    }

    /**
     * 获取可导入的表单列表
     */
    async getImportableForms(filter?: FormImportFilter): Promise<ImportableFormInfo[]> {
        this.updateProgress('扫描表单文件...', 0);

        const formFiles = await this.scanFormFiles();
        this.updateProgress('解析表单信息...', 50);

        const formInfos: ImportableFormInfo[] = [];

        for (let i = 0; i < formFiles.length; i++) {
            const file = formFiles[i];
            try {
                const content = await this.app.vault.read(file);
                const config = JSON.parse(content) as FormConfig;

                if (this.isValidFormConfig(config)) {
                    const formInfo = this.createFormInfo(file, config);

                    // 应用过滤器
                    if (this.matchesFilter(formInfo, filter)) {
                        formInfos.push(formInfo);
                    }
                }
            } catch (error) {
                console.warn(`无法解析表单文件 ${file.path}:`, error);
            }

            this.updateProgress('解析表单信息...', 50 + (i / formFiles.length) * 50);
        }

        this.updateProgress('完成', 100);
        return formInfos.sort((a, b) => (b.modifiedAt?.getTime() || 0) - (a.modifiedAt?.getTime() || 0));
    }

    /**
     * 导入表单数据
     */
    async importForm(
        sourceFilePath: string,
        importOptions: FormImportOptions,
        targetConfig?: FormConfig
    ): Promise<FormImportResult> {
        try {
            this.updateProgress('准备导入...', 0);

            // 1. 读取源表单配置
            const sourceConfig = await this.loadFormConfig(sourceFilePath);
            if (!sourceConfig) {
                return {
                    success: false,
                    error: '无法加载源表单配置'
                };
            }

            // 2. 验证导入权限和数据完整性
            const validation = await this.validateImport(sourceConfig, importOptions);
            if (!validation.valid) {
                return {
                    success: false,
                    error: validation.error || '导入验证失败',
                    warnings: validation.warnings
                };
            }

            this.updateProgress('检测冲突...', 10);

            // 3. 检测和处理冲突
            const conflicts = await this.detectConflicts(sourceConfig, targetConfig);
            if (conflicts.length > 0) {
                const resolution = await this.resolveConflicts(conflicts);
                if (resolution === ConflictResolution.CANCEL) {
                    return {
                        success: false,
                        error: '用户取消了导入操作'
                    };
                }
            }

            this.updateProgress('处理导入数据...', 30);

            // 4. 执行导入操作
            const importedConfig = await this.performImport(sourceConfig, importOptions, targetConfig);

            // 5. 生成导入摘要
            const summary = this.generateImportSummary(sourceConfig, importedConfig, importOptions);

            this.updateProgress('导入完成', 100);

            return {
                success: true,
                summary,
                importedConfig,
                warnings: validation.warnings
            };

        } catch (error) {
            this.updateProgress('导入失败', 0);
            return {
                success: false,
                error: `导入过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`
            };
        }
    }

    /**
     * 扫描所有表单文件
     */
    private async scanFormFiles(): Promise<TFile[]> {
        const formFiles: TFile[] = [];

        // 递归扫描所有文件夹
        const scanFolder = async (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile && child.extension === 'cform') {
                    formFiles.push(child);
                } else if (child instanceof TFolder) {
                    await scanFolder(child);
                }
            }
        };

        // 从根目录开始扫描
        await scanFolder(this.app.vault.getRoot());

        return formFiles;
    }

    /**
     * 验证表单配置是否有效
     */
    private isValidFormConfig(config: any): config is FormConfig {
        return config &&
               typeof config === 'object' &&
               typeof config.id === 'string' &&
               Array.isArray(config.fields) &&
               Array.isArray(config.actions);
    }

    /**
     * 创建表单信息对象
     */
    private createFormInfo(file: TFile, config: FormConfig): ImportableFormInfo {
        const fileName = file.basename;
        const folderPath = file.parent?.path || '';

        return {
            id: config.id,
            filePath: file.path,
            name: fileName,
            fieldsCount: config.fields?.length || 0,
            actionsCount: config.actions?.length || 0,
            createdAt: new Date(file.stat.ctime),
            modifiedAt: new Date(file.stat.mtime),
            category: folderPath,
            tags: this.extractTagsFromConfig(config)
        };
    }

    /**
     * 从配置中提取标签
     */
    private extractTagsFromConfig(config: FormConfig): string[] {
        // 这里可以根据实际需求从表单配置中提取标签
        // 例如从描述、特定字段等提取
        const tags: string[] = [];

        if (config.fields?.length > 0) {
            tags.push('有字段');
        }

        if (config.actions?.length > 0) {
            tags.push('有动作');
        }

        return tags;
    }

    /**
     * 检查表单信息是否匹配过滤器
     */
    private matchesFilter(formInfo: ImportableFormInfo, filter?: FormImportFilter): boolean {
        if (!filter) return true;

        // 搜索关键词匹配
        if (filter.searchKeyword) {
            const keyword = filter.searchKeyword.toLowerCase();
            const searchText = `${formInfo.name} ${formInfo.category}`.toLowerCase();
            if (!searchText.includes(keyword)) {
                return false;
            }
        }

        // 分类筛选
        if (filter.category && formInfo.category !== filter.category) {
            return false;
        }

        // 标签筛选
        if (filter.tags && filter.tags.length > 0) {
            const hasMatchingTag = filter.tags.some(tag =>
                formInfo.tags?.includes(tag)
            );
            if (!hasMatchingTag) {
                return false;
            }
        }

        // 字段数量范围筛选
        if (filter.fieldsCountRange) {
            const { min, max } = filter.fieldsCountRange;
            if (min !== undefined && formInfo.fieldsCount < min) return false;
            if (max !== undefined && formInfo.fieldsCount > max) return false;
        }

        // 动作数量范围筛选
        if (filter.actionsCountRange) {
            const { min, max } = filter.actionsCountRange;
            if (min !== undefined && formInfo.actionsCount < min) return false;
            if (max !== undefined && formInfo.actionsCount > max) return false;
        }

        // 日期范围筛选
        if (filter.dateRange) {
            const { start, end } = filter.dateRange;
            const modifiedTime = formInfo.modifiedAt?.getTime() || 0;
            if (start && modifiedTime < start.getTime()) return false;
            if (end && modifiedTime > end.getTime()) return false;
        }

        return true;
    }

    /**
     * 加载表单配置
     */
    private async loadFormConfig(filePath: string): Promise<FormConfig | null> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const config = JSON.parse(content);
                return this.isValidFormConfig(config) ? config : null;
            }
        } catch (error) {
            console.error(`加载表单配置失败: ${filePath}`, error);
        }
        return null;
    }

    /**
     * 验证导入操作
     */
    private async validateImport(
        sourceConfig: FormConfig,
        importOptions: FormImportOptions
    ): Promise<{ valid: boolean; error?: string; warnings?: string[] }> {
        const warnings: string[] = [];

        // 验证源配置完整性
        if (!sourceConfig.id) {
            return { valid: false, error: '源表单配置无效：缺少ID' };
        }

        // 验证导入选项
        if (importOptions.importType === 'partial' && !importOptions.partialImport) {
            return { valid: false, error: '部分导入需要指定具体导入配置' };
        }

        // 检查数据完整性
        if (sourceConfig.fields && sourceConfig.fields.some(field => !field.id)) {
            warnings.push('源表单中存在无效字段（缺少ID）');
        }

        if (sourceConfig.actions && sourceConfig.actions.some(action => !action.id)) {
            warnings.push('源表单中存在无效动作（缺少ID）');
        }

        return { valid: true, warnings };
    }

    /**
     * 检测导入冲突
     */
    private async detectConflicts(
        sourceConfig: FormConfig,
        targetConfig?: FormConfig
    ): Promise<ImportConflict[]> {
        const conflicts: ImportConflict[] = [];

        if (!targetConfig) return conflicts;

        // 检测ID冲突
        if (sourceConfig.id === targetConfig.id) {
            conflicts.push({
                type: ImportConflictType.ID_CONFLICT,
                description: '表单ID与目标表单相同',
                itemId: sourceConfig.id,
                suggestedResolution: ConflictResolution.RENAME
            });
        }

        // 检测字段名称冲突
        const sourceFieldNames = new Set(sourceConfig.fields?.map(f => f.label) || []);
        const targetFieldNames = new Set(targetConfig.fields?.map(f => f.label) || []);
        const nameConflicts = [...sourceFieldNames].filter(name => targetFieldNames.has(name));

        nameConflicts.forEach(name => {
            conflicts.push({
                type: ImportConflictType.FIELD_NAME_CONFLICT,
                description: `字段名称"${name}"与目标表单中的字段重复`,
                itemName: name,
                suggestedResolution: ConflictResolution.RENAME
            });
        });

        return conflicts;
    }

    /**
     * 解决冲突（这里简化处理，实际应用中可能需要用户交互）
     */
    private async resolveConflicts(conflicts: ImportConflict[]): Promise<ConflictResolution> {
        // 简化处理：自动重命名解决冲突
        // 在实际应用中，这里应该显示冲突解决对话框让用户选择
        return ConflictResolution.RENAME;
    }

    /**
     * 执行实际的导入操作
     */
    private async performImport(
        sourceConfig: FormConfig,
        importOptions: FormImportOptions,
        targetConfig?: FormConfig
    ): Promise<FormConfig> {
        this.updateProgress('准备导入数据...', 40);

        // 创建新的表单配置或基于目标配置
        const resultConfig: FormConfig = targetConfig ?
            { ...targetConfig } :
            new FormConfig(this.generateNewId());

        // 执行深拷贝以确保数据独立性
        const deepCopy = importOptions.deepCopy !== false; // 默认启用深拷贝

        if (importOptions.importType === 'all') {
            this.updateProgress('导入全部数据...', 60);

            // 导入所有字段
            if (sourceConfig.fields && sourceConfig.fields.length > 0) {
                resultConfig.fields = deepCopy ?
                    this.deepCloneFields(sourceConfig.fields) :
                    [...sourceConfig.fields];

                // 重新生成字段ID以避免冲突
                resultConfig.fields = resultConfig.fields.map(field => ({
                    ...field,
                    id: this.generateNewId()
                }));
            }

            // 导入所有动作
            if (sourceConfig.actions && sourceConfig.actions.length > 0) {
                resultConfig.actions = deepCopy ?
                    this.deepCloneActions(sourceConfig.actions) :
                    [...sourceConfig.actions];

                // 重新生成动作ID以避免冲突
                resultConfig.actions = resultConfig.actions.map(action => ({
                    ...action,
                    id: this.generateNewId()
                }));
            }

            // 导入其他设置
            if (sourceConfig.showSubmitSuccessToast !== undefined) {
                resultConfig.showSubmitSuccessToast = sourceConfig.showSubmitSuccessToast;
            }
            if (sourceConfig.enableExecutionTimeout !== undefined) {
                resultConfig.enableExecutionTimeout = sourceConfig.enableExecutionTimeout;
            }
            if (sourceConfig.executionTimeoutThreshold !== undefined) {
                resultConfig.executionTimeoutThreshold = sourceConfig.executionTimeoutThreshold;
            }

        } else if (importOptions.importType === 'partial' && importOptions.partialImport) {
            this.updateProgress('导入部分数据...', 60);
            const partial = importOptions.partialImport;

            // 选择性导入字段
            if (partial.importFields && sourceConfig.fields) {
                let fieldsToImport = sourceConfig.fields;

                if (partial.fieldIds && partial.fieldIds.length > 0) {
                    fieldsToImport = sourceConfig.fields.filter(field =>
                        partial.fieldIds!.includes(field.id)
                    );
                }

                resultConfig.fields = deepCopy ?
                    this.deepCloneFields(fieldsToImport) :
                    [...fieldsToImport];

                // 重新生成字段ID
                resultConfig.fields = resultConfig.fields.map(field => ({
                    ...field,
                    id: this.generateNewId()
                }));
            }

            // 选择性导入动作
            if (partial.importActions && sourceConfig.actions) {
                let actionsToImport = sourceConfig.actions;

                if (partial.actionIds && partial.actionIds.length > 0) {
                    actionsToImport = sourceConfig.actions.filter(action =>
                        partial.actionIds!.includes(action.id)
                    );
                }

                resultConfig.actions = deepCopy ?
                    this.deepCloneActions(actionsToImport) :
                    [...actionsToImport];

                // 重新生成动作ID
                resultConfig.actions = resultConfig.actions.map(action => ({
                    ...action,
                    id: this.generateNewId()
                }));
            }

            // 导入其他设置
            if (partial.importOtherSettings) {
                const settings = partial.otherSettings || {};
                if (settings.showSubmitSuccessToast !== undefined && sourceConfig.showSubmitSuccessToast !== undefined) {
                    resultConfig.showSubmitSuccessToast = sourceConfig.showSubmitSuccessToast;
                }
                if (settings.enableExecutionTimeout !== undefined && sourceConfig.enableExecutionTimeout !== undefined) {
                    resultConfig.enableExecutionTimeout = sourceConfig.enableExecutionTimeout;
                }
                if (settings.executionTimeoutThreshold !== undefined && sourceConfig.executionTimeoutThreshold !== undefined) {
                    resultConfig.executionTimeoutThreshold = sourceConfig.executionTimeoutThreshold;
                }
            }
        }

        this.updateProgress('完成数据处理...', 90);
        return resultConfig;
    }

    /**
     * 深拷贝字段数组
     */
    private deepCloneFields(fields: IFormField[]): IFormField[] {
        return fields.map(field => JSON.parse(JSON.stringify(field)));
    }

    /**
     * 深拷贝动作数组
     */
    private deepCloneActions(actions: IFormAction[]): IFormAction[] {
        return actions.map(action => JSON.parse(JSON.stringify(action)));
    }

    /**
     * 生成新的唯一ID
     */
    private generateNewId(): string {
        return uuidv4();
    }

    /**
     * 生成导入摘要
     */
    private generateImportSummary(
        sourceConfig: FormConfig,
        importedConfig: FormConfig,
        importOptions: FormImportOptions
    ): ImportSummary {
        return {
            importedFieldsCount: importedConfig.fields?.length || 0,
            importedActionsCount: importedConfig.actions?.length || 0,
            importedStylesCount: importOptions.importType === 'all' ? 1 : 0,
            importedValidationRulesCount: this.countValidationRules(importedConfig),
            importedOtherSettingsCount: this.countOtherSettings(importedConfig)
        };
    }

    /**
     * 统计验证规则数量
     */
    private countValidationRules(config: FormConfig): number {
        let count = 0;
        if (config.fields) {
            config.fields.forEach(field => {
                if (field.required) count++;
                // 这里可以添加其他验证规则的统计
            });
        }
        return count;
    }

    /**
     * 统计其他设置数量
     */
    private countOtherSettings(config: FormConfig): number {
        let count = 0;
        if (config.showSubmitSuccessToast !== undefined) count++;
        if (config.enableExecutionTimeout !== undefined) count++;
        if (config.executionTimeoutThreshold !== undefined) count++;
        if (config.commandEnabled !== undefined) count++;
        return count;
    }
}