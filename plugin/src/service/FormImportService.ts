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
import { ActionGroup } from '../model/ActionGroup';
import { ActionTrigger } from '../model/ActionTrigger';
import { LoopFormAction } from '../model/action/LoopFormAction';
import { Filter } from '../model/filter/Filter';
import { FormActionType } from '../model/enums/FormActionType';
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
                const config = this.normalizeFormConfig(JSON.parse(content));

                if (config) {
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
            const importExecution = await this.performImport(sourceConfig, importOptions, targetConfig);

            // 5. 生成导入摘要
            const summary = this.generateImportSummary(
                importOptions,
                importExecution.importedFields,
                importExecution.importedActions,
                importExecution.importedOtherSettingsCount
            );

            this.updateProgress('导入完成', 100);

            return {
                success: true,
                summary,
                importedConfig: importExecution.config,
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
               (Array.isArray(config.actions) || config.action);
    }

    private normalizeFormConfig(rawConfig: any): FormConfig | null {
        if (!this.isValidFormConfig(rawConfig)) {
            return null;
        }

        const normalized = JSON.parse(JSON.stringify(rawConfig));
        normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
        normalized.actions = Array.isArray(normalized.actions) ? normalized.actions : [];
        normalized.actionGroups = Array.isArray(normalized.actionGroups) ? normalized.actionGroups : [];
        normalized.actionTriggers = Array.isArray(normalized.actionTriggers)
            ? normalized.actionTriggers
            : [];

        if (normalized.action && normalized.action.id) {
            const hasLegacyAction = normalized.actions.some(
                (action: IFormAction) => action.id === normalized.action.id
            );

            if (!hasLegacyAction) {
                normalized.actions = [normalized.action, ...normalized.actions];
            }
        }

        return FormConfig.fromJSON(normalized);
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
                return this.normalizeFormConfig(JSON.parse(content));
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

        if (
            importOptions.importType === 'partial' &&
            importOptions.partialImport?.importActionTriggers === true &&
            importOptions.partialImport.importActions !== true
        ) {
            return { valid: false, error: '导入动作触发器时，需要同时导入对应动作' };
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
    ): Promise<{
        config: FormConfig;
        importedFields: IFormField[];
        importedActions: IFormAction[];
        importedOtherSettingsCount: number;
    }> {
        this.updateProgress('准备导入数据...', 40);

        const resultConfig = this.cloneFormConfig(targetConfig);
        const importedFields: IFormField[] = [];
        const importedActions: IFormAction[] = [];
        let importedOtherSettingsCount = 0;
        const sourceFields = sourceConfig.fields || [];
        const sourceActionGroups = sourceConfig.actionGroups || [];
        const sourceActionTriggers = sourceConfig.actionTriggers || [];
        const sourceFieldById = new Map(sourceFields.map(field => [field.id, field]));
        const targetFieldIdByLabel = this.buildFieldIdByLabel(resultConfig.fields || []);

        if (importOptions.importType === 'all') {
            this.updateProgress('导入全部数据...', 60);

            // 导入所有字段
            if (sourceConfig.fields && sourceConfig.fields.length > 0) {
                const fieldImportResult = this.cloneFieldsForImport(
                    sourceConfig.fields,
                    sourceFieldById,
                    targetFieldIdByLabel
                );

                resultConfig.fields = [
                    ...(resultConfig.fields || []),
                    ...fieldImportResult.fields
                ];
                importedFields.push(...fieldImportResult.fields);

                const actionImportResult = this.cloneActionGraphForImport(
                    sourceConfig.actions || [],
                    sourceActionGroups,
                    this.createFieldReferenceResolver(
                        fieldImportResult.fieldIdMap,
                        sourceFieldById,
                        targetFieldIdByLabel,
                        true
                    )
                );
                resultConfig.actions = [
                    ...(resultConfig.actions || []),
                    ...actionImportResult.topLevelActions
                ];
                resultConfig.actionGroups = [
                    ...(resultConfig.actionGroups || []),
                    ...actionImportResult.actionGroups
                ];
                resultConfig.actionTriggers = [
                    ...(resultConfig.actionTriggers || []),
                    ...this.cloneActionTriggersForImport(
                        sourceActionTriggers,
                        actionImportResult.topLevelActionIdMap
                    )
                ];
                importedActions.push(...actionImportResult.importedActions);
            }

            if ((!sourceConfig.fields || sourceConfig.fields.length === 0) && sourceConfig.actions && sourceConfig.actions.length > 0) {
                const actionImportResult = this.cloneActionGraphForImport(
                    sourceConfig.actions,
                    sourceActionGroups,
                    this.createFieldReferenceResolver(
                        new Map(),
                        sourceFieldById,
                        targetFieldIdByLabel,
                        true
                    )
                );
                resultConfig.actions = [
                    ...(resultConfig.actions || []),
                    ...actionImportResult.topLevelActions
                ];
                resultConfig.actionGroups = [
                    ...(resultConfig.actionGroups || []),
                    ...actionImportResult.actionGroups
                ];
                resultConfig.actionTriggers = [
                    ...(resultConfig.actionTriggers || []),
                    ...this.cloneActionTriggersForImport(
                        sourceActionTriggers,
                        actionImportResult.topLevelActionIdMap
                    )
                ];
                importedActions.push(...actionImportResult.importedActions);
            }

            // 导入其他设置
            importedOtherSettingsCount += this.applyOtherSettings(resultConfig, sourceConfig);

        } else if (importOptions.importType === 'partial' && importOptions.partialImport) {
            this.updateProgress('导入部分数据...', 60);
            const partial = importOptions.partialImport;
            let fieldIdMap = new Map<string, string>();
            let importedTopLevelActionIdMap = new Map<string, string>();

            // 选择性导入字段
            if (partial.importFields && sourceConfig.fields) {
                let fieldsToImport = sourceConfig.fields;

                if (partial.fieldIds && partial.fieldIds.length > 0) {
                    fieldsToImport = sourceConfig.fields.filter(field =>
                        partial.fieldIds!.includes(field.id)
                    );
                }

                const fieldImportResult = this.cloneFieldsForImport(
                    fieldsToImport,
                    sourceFieldById,
                    targetFieldIdByLabel
                );
                fieldIdMap = fieldImportResult.fieldIdMap;
                resultConfig.fields = [
                    ...(resultConfig.fields || []),
                    ...fieldImportResult.fields
                ];
                importedFields.push(...fieldImportResult.fields);
            }

            // 选择性导入动作
            if (partial.importActions && sourceConfig.actions) {
                let actionsToImport = sourceConfig.actions;

                if (partial.actionIds && partial.actionIds.length > 0) {
                    actionsToImport = sourceConfig.actions.filter(action =>
                        partial.actionIds!.includes(action.id)
                    );
                }

                const actionImportResult = this.cloneActionGraphForImport(
                    actionsToImport,
                    sourceActionGroups,
                    this.createFieldReferenceResolver(
                        fieldIdMap,
                        sourceFieldById,
                        targetFieldIdByLabel,
                        true
                    )
                );
                resultConfig.actions = [
                    ...(resultConfig.actions || []),
                    ...actionImportResult.topLevelActions
                ];
                resultConfig.actionGroups = [
                    ...(resultConfig.actionGroups || []),
                    ...actionImportResult.actionGroups
                ];
                importedTopLevelActionIdMap = actionImportResult.topLevelActionIdMap;
                importedActions.push(...actionImportResult.importedActions);
            }

            if (partial.importActionTriggers) {
                resultConfig.actionTriggers = [
                    ...(resultConfig.actionTriggers || []),
                    ...this.cloneActionTriggersForImport(
                        sourceActionTriggers,
                        importedTopLevelActionIdMap
                    )
                ];
            }

            if (partial.importExecutionConditions && sourceConfig.startupConditions !== undefined) {
                resultConfig.startupConditions = JSON.parse(JSON.stringify(sourceConfig.startupConditions));
                importedOtherSettingsCount++;
            }

            // 导入其他设置
            if (partial.importOtherSettings) {
                importedOtherSettingsCount += this.applyOtherSettings(
                    resultConfig,
                    sourceConfig,
                    {
                        ...partial.otherSettings,
                        startupConditions: false,
                    }
                );
            }
        }

        resultConfig.cleanupTriggerActionRefs();

        this.updateProgress('完成数据处理...', 90);
        return {
            config: resultConfig,
            importedFields,
            importedActions,
            importedOtherSettingsCount
        };
    }

    private cloneFormConfig(targetConfig?: FormConfig): FormConfig {
        if (!targetConfig) {
            return new FormConfig(this.generateNewId());
        }

        const clonedConfig = FormConfig.fromJSON(JSON.parse(JSON.stringify(targetConfig)));
        clonedConfig.fields = clonedConfig.fields || [];
        clonedConfig.actions = clonedConfig.actions || [];
        clonedConfig.actionGroups = clonedConfig.actionGroups || [];
        clonedConfig.actionTriggers = clonedConfig.actionTriggers || [];
        return clonedConfig;
    }

    private buildFieldIdByLabel(fields: IFormField[]): Map<string, string> {
        const fieldIdByLabel = new Map<string, string>();

        fields.forEach(field => {
            if (!fieldIdByLabel.has(field.label)) {
                fieldIdByLabel.set(field.label, field.id);
            }
        });

        return fieldIdByLabel;
    }

    private createFieldReferenceResolver(
        fieldIdMap: Map<string, string>,
        sourceFieldById: Map<string, IFormField>,
        targetFieldIdByLabel: Map<string, string>,
        strictResolution = false
    ): (fieldId: string) => string {
        return (fieldId: string): string => {
            const importedFieldId = fieldIdMap.get(fieldId);
            if (importedFieldId) {
                return importedFieldId;
            }

            const sourceField = sourceFieldById.get(fieldId);
            if (!sourceField) {
                return fieldId;
            }

            const targetFieldId = targetFieldIdByLabel.get(sourceField.label);
            if (targetFieldId) {
                return targetFieldId;
            }

            if (strictResolution) {
                throw new Error(`动作引用的字段“${sourceField.label}”未导入，且目标表单中不存在同名字段`);
            }

            return fieldId;
        };
    }

    private cloneFieldsForImport(
        fields: IFormField[],
        sourceFieldById: Map<string, IFormField>,
        targetFieldIdByLabel: Map<string, string>
    ): {
        fields: IFormField[];
        fieldIdMap: Map<string, string>;
    } {
        const clonedFields = this.deepCloneFields(fields);
        const fieldIdMap = new Map<string, string>();

        clonedFields.forEach(field => {
            fieldIdMap.set(field.id, this.generateNewId());
        });

        const resolveFieldReference = this.createFieldReferenceResolver(
            fieldIdMap,
            sourceFieldById,
            targetFieldIdByLabel,
            true
        );

        clonedFields.forEach(field => {
            field.id = fieldIdMap.get(field.id) || field.id;
            this.remapFilterFieldReferences(field.condition, resolveFieldReference);
        });

        return {
            fields: clonedFields,
            fieldIdMap
        };
    }

    private cloneActionsForImport(
        actions: IFormAction[],
        resolveFieldReference: (fieldId: string) => string
    ): {
        actions: IFormAction[];
        actionIdMap: Map<string, string>;
    } {
        const clonedActions = this.deepCloneActions(actions);
        const actionIdMap = new Map<string, string>();

        clonedActions.forEach(action => {
            actionIdMap.set(action.id, this.generateNewId());
        });

        clonedActions.forEach(action => {
            action.id = actionIdMap.get(action.id) || action.id;
            this.remapActionFieldReferences(action, resolveFieldReference);
        });

        return {
            actions: clonedActions,
            actionIdMap
        };
    }

    private cloneActionGraphForImport(
        actions: IFormAction[],
        sourceActionGroups: ActionGroup[],
        resolveFieldReference: (fieldId: string) => string
    ): {
        topLevelActions: IFormAction[];
        actionGroups: ActionGroup[];
        importedActions: IFormAction[];
        topLevelActionIdMap: Map<string, string>;
    } {
        const groupById = new Map(sourceActionGroups.map(group => [group.id, group]));
        const reachableGroups = this.collectReachableActionGroups(actions, groupById);
        const topLevelActions = this.deepCloneActions(actions);
        const actionGroups = reachableGroups.map(group => JSON.parse(JSON.stringify(group)) as ActionGroup);
        const actionIdMap = new Map<string, string>();
        const topLevelActionIdMap = new Map<string, string>();
        const actionGroupIdMap = new Map<string, string>();

        topLevelActions.forEach(action => {
            const newId = this.generateNewId();
            actionIdMap.set(action.id, newId);
            topLevelActionIdMap.set(action.id, newId);
        });

        actionGroups.forEach(group => {
            actionGroupIdMap.set(group.id, this.generateNewId());
            (group.actions || []).forEach(action => {
                actionIdMap.set(action.id, this.generateNewId());
            });
        });

        const resolveActionGroupReference = (groupId: string): string => {
            return actionGroupIdMap.get(groupId) || groupId;
        };

        topLevelActions.forEach(action => {
            action.id = actionIdMap.get(action.id) || action.id;
            this.remapActionFieldReferences(action, resolveFieldReference, resolveActionGroupReference);
        });

        actionGroups.forEach(group => {
            group.id = actionGroupIdMap.get(group.id) || group.id;
            group.actions = (group.actions || []).map(action => {
                action.id = actionIdMap.get(action.id) || action.id;
                this.remapActionFieldReferences(action, resolveFieldReference, resolveActionGroupReference);
                return action;
            });
        });

        return {
            topLevelActions,
            actionGroups,
            importedActions: [
                ...topLevelActions,
                ...actionGroups.flatMap(group => group.actions || [])
            ],
            topLevelActionIdMap
        };
    }

    private collectReachableActionGroups(
        actions: IFormAction[],
        groupById: Map<string, ActionGroup>
    ): ActionGroup[] {
        const reachableGroups: ActionGroup[] = [];
        const visitedGroupIds = new Set<string>();

        const walk = (items: IFormAction[]) => {
            items.forEach(action => {
                if (action.type !== FormActionType.LOOP) {
                    return;
                }

                const actionGroupId = (action as LoopFormAction).actionGroupId;
                if (!actionGroupId || visitedGroupIds.has(actionGroupId)) {
                    return;
                }

                const actionGroup = groupById.get(actionGroupId);
                if (!actionGroup) {
                    return;
                }

                visitedGroupIds.add(actionGroupId);
                reachableGroups.push(actionGroup);
                walk(actionGroup.actions || []);
            });
        };

        walk(actions || []);
        return reachableGroups;
    }

    private cloneActionTriggersForImport(
        triggers: ActionTrigger[],
        topLevelActionIdMap: Map<string, string>
    ): ActionTrigger[] {
        return triggers
            .map(trigger => ActionTrigger.fromJSON(JSON.parse(JSON.stringify(trigger))))
            .map(trigger => {
                const droppedActionIds = (trigger.actionIds || [])
                    .filter(actionId => !topLevelActionIdMap.has(actionId));

                if (droppedActionIds.length > 0) {
                    console.warn(
                        `导入动作触发器时过滤了 ${droppedActionIds.length} 个非顶层动作引用: ${trigger.name || trigger.id}`
                    );
                }

                trigger.actionIds = (trigger.actionIds || [])
                    .map(actionId => topLevelActionIdMap.get(actionId))
                    .filter((actionId): actionId is string => Boolean(actionId));
                return trigger;
            })
            .filter(trigger => trigger.actionIds.length > 0)
            .map(trigger => {
                trigger.id = this.generateNewId();
                trigger.commandId = undefined;
                trigger.lastExecutionTime = undefined;
                return trigger;
            });
    }

    private remapActionFieldReferences(
        action: IFormAction,
        resolveFieldReference: (fieldId: string) => string,
        resolveActionGroupReference?: (groupId: string) => string
    ): void {
        this.remapFilterFieldReferences(action.condition, resolveFieldReference);

        if (action.type === FormActionType.LOOP && resolveActionGroupReference) {
            const loopAction = action as LoopFormAction;
            if (loopAction.actionGroupId) {
                loopAction.actionGroupId = resolveActionGroupReference(loopAction.actionGroupId);
            }
        }

        this.remapTemplateFieldReferencesInValue(action, resolveFieldReference);
    }

    private remapFilterFieldReferences(
        filter: Filter | null | undefined,
        resolveFieldReference: (fieldId: string) => string
    ): void {
        if (!filter) {
            return;
        }

        if (typeof filter.property === 'string' && filter.property.trim().length > 0) {
            filter.property = resolveFieldReference(filter.property.trim());
        }

        if (filter.value !== undefined) {
            filter.value = this.remapTemplateFieldReferencesInValue(filter.value, resolveFieldReference);
        }

        if (filter.extendedConfig !== undefined) {
            filter.extendedConfig = this.remapTemplateFieldReferencesInValue(
                filter.extendedConfig,
                resolveFieldReference
            );
        }

        filter.conditions?.forEach(condition => {
            this.remapFilterFieldReferences(condition, resolveFieldReference);
        });
    }

    private remapTemplateFieldReferencesInValue<T>(
        value: T,
        resolveFieldReference: (fieldId: string) => string
    ): T {
        if (typeof value === 'string') {
            return value.replace(/\{\{@([^}]+)\}\}/g, (_match, fieldRef: string) => {
                return `{{@${resolveFieldReference(fieldRef.trim())}}}`;
            }) as T;
        }

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                value[index] = this.remapTemplateFieldReferencesInValue(item, resolveFieldReference);
            });
            return value;
        }

        if (value && typeof value === 'object') {
            Object.entries(value as Record<string, unknown>).forEach(([key, entryValue]) => {
                (value as Record<string, unknown>)[key] = this.remapTemplateFieldReferencesInValue(
                    entryValue,
                    resolveFieldReference
                );
            });
        }

        return value;
    }

    private applyOtherSettings(
        targetConfig: FormConfig,
        sourceConfig: FormConfig,
        selection?: {
            showSubmitSuccessToast?: boolean;
            enableExecutionTimeout?: boolean;
            executionTimeoutThreshold?: boolean;
            commandEnabled?: boolean;
            contextMenuEnabled?: boolean;
            runOnStartup?: boolean;
            startupConditions?: boolean;
            multiSubmitFormExecutionMode?: boolean;
            multiSubmitFormDisplayMode?: boolean;
        }
    ): number {
        let importedCount = 0;

        const assignSetting = <K extends keyof FormConfig>(
            key: K,
            enabled: boolean,
            cloneValue = false
        ) => {
            if (!enabled || sourceConfig[key] === undefined) {
                return;
            }

            targetConfig[key] = cloneValue
                ? JSON.parse(JSON.stringify(sourceConfig[key]))
                : sourceConfig[key];
            importedCount++;
        };

        assignSetting('showSubmitSuccessToast', selection?.showSubmitSuccessToast !== false);
        assignSetting('enableExecutionTimeout', selection?.enableExecutionTimeout !== false);
        assignSetting('executionTimeoutThreshold', selection?.executionTimeoutThreshold !== false);
        assignSetting('commandEnabled', selection?.commandEnabled !== false);
        assignSetting('contextMenuEnabled', selection?.contextMenuEnabled !== false);
        assignSetting('runOnStartup', selection?.runOnStartup !== false);
        assignSetting('startupConditions', selection?.startupConditions !== false, true);
        assignSetting(
            'multiSubmitFormExecutionMode',
            selection?.multiSubmitFormExecutionMode !== false
        );
        assignSetting(
            'multiSubmitFormDisplayMode',
            selection?.multiSubmitFormDisplayMode !== false
        );

        return importedCount;
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
        importOptions: FormImportOptions,
        importedFields: IFormField[],
        importedActions: IFormAction[],
        importedOtherSettingsCount: number
    ): ImportSummary {
        return {
            importedFieldsCount: importedFields.length,
            importedActionsCount: importedActions.length,
            importedStylesCount: importOptions.importType === 'all' ? 1 : 0,
            importedValidationRulesCount: this.countValidationRules(importedFields),
            importedOtherSettingsCount
        };
    }

    /**
     * 统计验证规则数量
     */
    private countValidationRules(fields: IFormField[]): number {
        let count = 0;
        fields.forEach(field => {
            if (field.required) count++;
            // 这里可以添加其他验证规则的统计
        });
        return count;
    }
}