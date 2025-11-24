import React, { useState, useEffect, useCallback } from 'react';
import { App } from 'obsidian';
import { X, Search, Filter, Download, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
import { FormConfig } from 'src/model/FormConfig';
import { FormImportService } from 'src/service/FormImportService';
import {
    ImportableFormInfo,
    FormImportOptions,
    FormImportResult,
    ImportProgress,
    PartialImportConfig,
    ImportConflict,
    ConflictResolution
} from 'src/model/FormImport';
import { FormFieldType } from 'src/model/enums/FormFieldType';
import { FormActionType } from 'src/model/enums/FormActionType';
import { localInstance } from 'src/i18n/locals';
import './FormImportDialog.css';

interface FormImportDialogProps {
    app: App;
    currentConfig: FormConfig;
    onClose: () => void;
    onComplete: (importedConfig: FormConfig) => void;
}

export function FormImportDialog({
    app,
    currentConfig,
    onClose,
    onComplete
}: FormImportDialogProps) {
    // 基础状态
    const [currentStep, setCurrentStep] = useState<'select' | 'configure' | 'importing' | 'result'>('select');
    const [selectedForm, setSelectedForm] = useState<ImportableFormInfo | null>(null);
    const [selectedFormData, setSelectedFormData] = useState<FormConfig | null>(null);
    const [importOptions, setImportOptions] = useState<FormImportOptions>({
        importType: 'all',
        deepCopy: true
    });

    // 表单列表相关状态
    const [forms, setForms] = useState<ImportableFormInfo[]>([]);
    const [filteredForms, setFilteredForms] = useState<ImportableFormInfo[]>([]);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [loadingForms, setLoadingForms] = useState(false);

    // 导入相关状态
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [importResult, setImportResult] = useState<FormImportResult | null>(null);
    const [conflicts, setConflicts] = useState<ImportConflict[]>([]);

    // 服务实例
    const [importService] = useState(() => new FormImportService(app));

    // 分类列表
    const [categories, setCategories] = useState<string[]>([]);

    // 部分导入分类展开状态
    const [expandedSections, setExpandedSections] = useState({
        fields: true,
        actions: true,
        otherSettings: true
    });

    // 字段类型映射为用户友好名称
    const getFieldTypeDisplayName = (type: FormFieldType): string => {
        switch (type) {
            case FormFieldType.TEXT:
                return '文本';
            case FormFieldType.TEXTAREA:
                return '多行文本';
            case FormFieldType.PASSWORD:
                return '密码';
            case FormFieldType.NUMBER:
                return '数字';
            case FormFieldType.DATE:
                return '日期';
            case FormFieldType.DATETIME:
                return '日期时间';
            case FormFieldType.TIME:
                return '时间';
            case FormFieldType.CHECKBOX:
                return '复选框';
            case FormFieldType.TOGGLE:
                return '开关';
            case FormFieldType.RADIO:
                return '单选框';
            case FormFieldType.SELECT:
                return '下拉选择';
            case FormFieldType.PROPERTY_VALUE_SUGGESTION:
                return '属性值建议';
            case FormFieldType.FILE_LIST:
                return '文件列表';
            case FormFieldType.FOLDER_PATH:
                return '文件夹路径';
            default:
                return type;
        }
    };

    // 动作类型映射为用户友好名称
    const getActionTypeDisplayName = (type: FormActionType): string => {
        switch (type) {
            case FormActionType.CREATE_FILE:
                return '创建文件';
            case FormActionType.INSERT_TEXT:
                return '插入文本';
            case FormActionType.RUN_SCRIPT:
                return '运行脚本';
            case FormActionType.UPDATE_FRONTMATTER:
                return '更新Frontmatter';
            case FormActionType.SUGGEST_MODAL:
                return '建议模态框';
            case FormActionType.GENERATE_FORM:
                return '生成表单';
            case FormActionType.RUN_COMMAND:
                return '运行命令';
            case FormActionType.WAIT:
                return '等待';
            case FormActionType.BUTTON:
                return '按钮';
            case FormActionType.TEXT:
                return '文本';
            case FormActionType.AI:
                return 'AI动作';
            case FormActionType.LOOP:
                return '循环';
            case FormActionType.BREAK:
                return '中断循环';
            case FormActionType.CONTINUE:
                return '继续循环';
            default:
                return type;
        }
    };

    // 初始化
    useEffect(() => {
        loadForms();
    }, []);

    // 加载表单列表
    const loadForms = async () => {
        setLoadingForms(true);
        try {
            const formsList = await importService.getImportableForms();
            setForms(formsList);
            setFilteredForms(formsList);

            // 提取分类列表
            const categorySet = new Set<string>();
            formsList.forEach(form => {
                if (form.category) {
                    categorySet.add(form.category);
                }
            });
            setCategories(Array.from(categorySet).sort());
        } catch (error) {
            console.error('加载表单列表失败:', error);
        } finally {
            setLoadingForms(false);
        }
    };

    // 搜索和筛选
    useEffect(() => {
        let filtered = forms;

        // 关键词搜索
        if (searchKeyword) {
            const keyword = searchKeyword.toLowerCase();
            filtered = filtered.filter(form =>
                form.name.toLowerCase().includes(keyword) ||
                form.category?.toLowerCase().includes(keyword)
            );
        }

        // 分类筛选
        if (selectedCategory) {
            filtered = filtered.filter(form => form.category === selectedCategory);
        }

        setFilteredForms(filtered);
    }, [forms, searchKeyword, selectedCategory]);

    // 设置导入进度回调
    useEffect(() => {
        importService.setProgressCallback((progress) => {
            setImportProgress(progress);
        });
    }, [importService]);

    // 选择表单
    const handleSelectForm = async (form: ImportableFormInfo) => {
        setSelectedForm(form);
        try {
            // 加载表单数据
            const sourceConfig = await importService['loadFormConfig'](form.filePath);
            setSelectedFormData(sourceConfig);
            // 检测冲突
            checkConflicts(form);
        } catch (error) {
            console.error('加载表单数据失败:', error);
            setSelectedFormData(null);
        }
    };

    // 检测导入冲突
    const checkConflicts = async (form: ImportableFormInfo) => {
        try {
            const sourceConfig = await importService['loadFormConfig'](form.filePath);
            if (sourceConfig) {
                const detectedConflicts = await importService['detectConflicts'](sourceConfig, currentConfig);
                setConflicts(detectedConflicts);
            }
        } catch (error) {
            console.error('检测冲突失败:', error);
        }
    };

    // 更新部分导入配置的辅助函数
    const updatePartialImportConfig = (key: string, value: any) => {
        setImportOptions(prev => ({
            ...prev,
            partialImport: {
                ...prev.partialImport!,
                [key]: value
            }
        }));
    };

    // 更新其他设置的辅助函数
    const updateOtherSetting = (key: string, value: any) => {
        setImportOptions(prev => ({
            ...prev,
            partialImport: {
                ...prev.partialImport!,
                otherSettings: {
                    ...prev.partialImport?.otherSettings,
                    [key]: value
                }
            }
        }));
    };

    // 检查是否有有效的选择
    const hasValidSelection = () => {
        if (importOptions.importType === 'all') return true;

        const partial = importOptions.partialImport;
        if (!partial) return false;

        const hasFields = partial.importFields && (partial.fieldIds?.length || 0) > 0;
        const hasActions = partial.importActions && (partial.actionIds?.length || 0) > 0;
        const hasOtherSettings = partial.importOtherSettings;

        return hasFields || hasActions || hasOtherSettings;
    };

    // 执行导入
    const handleImport = async () => {
        if (!selectedForm) return;

        setCurrentStep('importing');
        setImportProgress(null);
        setImportResult(null);

        try {
            const result = await importService.importForm(
                selectedForm.filePath,
                importOptions,
                currentConfig
            );

            setImportResult(result);

            if (result.success && result.importedConfig) {
                setTimeout(() => {
                    setCurrentStep('result');
                }, 500);
            } else {
                setCurrentStep('result');
            }
        } catch (error) {
            console.error('导入失败:', error);
            setImportResult({
                success: false,
                error: `导入过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`
            });
            setCurrentStep('result');
        }
    };

    // 完成导入
    const handleComplete = () => {
        if (importResult?.success && importResult.importedConfig) {
            onComplete(importResult.importedConfig);
        }
    };

    // 渲染表单选择步骤
    const renderFormSelection = () => (
        <div className="import-step form-selection">
            <div className="step-header">
                <h3>选择要导入的表单</h3>
                <p className="step-description">从现有的表单中选择一个作为导入源</p>
            </div>

            {/* 搜索和筛选工具栏 */}
            <div className="search-filter-toolbar" style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px',
                padding: '12px',
                background: 'var(--background-secondary)',
                borderRadius: '8px',
            }}>
                <div className="search-input" style={{
                    flex: 1,
                    position: 'relative',
                }}>
                    <Search size={16} style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                    }} />
                    <input
                        type="text"
                        placeholder="搜索表单名称..."
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        style={{
                            width: '100%',
                            height: '36px',
                            padding: '8px 12px 8px 36px',
                            border: '1px solid var(--background-modifier-border)',
                            borderRadius: '4px',
                            background: 'var(--background-primary)',
                            color: 'var(--text-normal)',
                            fontSize: '14px',
                            boxSizing: 'border-box',
                        }}
                    />
                </div>

                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{
                        height: '36px',
                        padding: '8px 12px',
                        border: '1px solid var(--background-modifier-border)',
                        borderRadius: '4px',
                        background: 'var(--background-primary)',
                        color: 'var(--text-normal)',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                    }}
                >
                    <option value="">所有分类</option>
                    {categories.map(category => (
                        <option key={category} value={category}>
                            {category}
                        </option>
                    ))}
                </select>
            </div>

            {/* 表单列表 */}
            <div className="forms-list" style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '8px',
            }}>
                {loadingForms ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        padding: '40px',
                        color: 'var(--text-muted)',
                    }}>
                        <Loader2 className="animate-spin" size={24} />
                        <span style={{ marginLeft: '8px' }}>加载表单列表...</span>
                    </div>
                ) : filteredForms.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '40px',
                        color: 'var(--text-muted)',
                    }}>
                        <FileText size={48} style={{ marginBottom: '12px' }} />
                        <p>没有找到可导入的表单</p>
                    </div>
                ) : (
                    filteredForms.map(form => (
                        <div
                            key={form.id}
                            className={`form-item ${selectedForm?.id === form.id ? 'selected' : ''}`}
                            onClick={() => handleSelectForm(form)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '16px',
                                borderBottom: '1px solid var(--background-modifier-border)',
                                cursor: 'pointer',
                                background: selectedForm?.id === form.id ? 'var(--background-modifier-hover)' : 'transparent',
                                transition: 'background-color 0.2s ease',
                            }}
                            onMouseOver={(e) => {
                                if (selectedForm?.id !== form.id) {
                                    e.currentTarget.style.background = 'var(--background-modifier-hover)';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (selectedForm?.id !== form.id) {
                                    e.currentTarget.style.background = 'transparent';
                                }
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '4px',
                                }}>
                                    <FileText size={16} />
                                    <span style={{
                                        fontWeight: '500',
                                        color: 'var(--text-normal)',
                                    }}>
                                        {form.name}
                                    </span>
                                    {form.category && (
                                        <span style={{
                                            fontSize: '12px',
                                            padding: '2px 6px',
                                            background: 'var(--background-secondary)',
                                            color: 'var(--text-muted)',
                                            borderRadius: '4px',
                                        }}>
                                            {form.category}
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--text-muted)',
                                }}>
                                    {form.fieldsCount} 个字段 • {form.actionsCount} 个动作
                                    {form.modifiedAt && ` • 修改于 ${form.modifiedAt.toLocaleDateString()}`}
                                </div>
                            </div>
                            {selectedForm?.id === form.id && (
                                <Check size={20} style={{ color: 'var(--interactive-accent)' }} />
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* 操作按钮 */}
            <div className="step-actions" style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '24px',
            }}>
                <button
                    onClick={onClose}
                    style={{
                        padding: '10px 20px',
                        border: '1px solid var(--background-modifier-border)',
                        background: 'var(--background-secondary)',
                        color: 'var(--text-normal)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                    }}
                >
                    取消
                </button>
                <button
                    onClick={() => setCurrentStep('configure')}
                    disabled={!selectedForm}
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        background: selectedForm ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                        color: selectedForm ? 'var(--text-on-accent)' : 'var(--text-muted)',
                        borderRadius: '6px',
                        cursor: selectedForm ? 'pointer' : 'not-allowed',
                    }}
                >
                    下一步
                </button>
            </div>
        </div>
    );

    // 渲染导入配置步骤
    const renderImportConfiguration = () => (
        <div className="import-step import-configuration">
            <div className="step-header">
                <h3>配置导入选项</h3>
                <p className="step-description">
                    选择要从 "{selectedForm?.name}" 导入的内容
                </p>
            </div>

            {/* 冲突提示 */}
            {conflicts.length > 0 && (
                <div className="conflicts-warning" style={{
                    padding: '12px 16px',
                    background: 'var(--background-warning)',
                    border: '1px solid var(--background-modifier-error)',
                    borderRadius: '6px',
                    marginBottom: '20px',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                        color: 'var(--text-warning)',
                    }}>
                        <AlertCircle size={16} />
                        <strong>检测到 {conflicts.length} 个潜在冲突</strong>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-warning)' }}>
                        系统将自动重命名冲突项以避免数据覆盖
                    </div>
                </div>
            )}

            {/* 导入类型选择 */}
            <div className="import-type-selection" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px' }}>导入范围</h4>
                <div style={{
                    display: 'flex',
                    gap: '12px',
                }}>
                    <button
                        className={`import-type-btn ${importOptions.importType === 'all' ? 'active' : ''}`}
                        onClick={() => setImportOptions({ ...importOptions, importType: 'all' })}
                        style={{
                            flex: 1,
                            padding: '16px',
                            border: '2px solid',
                            borderColor: importOptions.importType === 'all' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                            background: importOptions.importType === 'all' ? 'var(--background-modifier-hover)' : 'transparent',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <div style={{ fontWeight: '600' }}>全部导入</div>
                    </button>

                    <button
                        className={`import-type-btn ${importOptions.importType === 'partial' ? 'active' : ''}`}
                        onClick={() => setImportOptions({
                            ...importOptions,
                            importType: 'partial',
                            partialImport: {
                                importFields: true,
                                importActions: true,
                                importStyles: true,
                                importValidationRules: true,
                                importOtherSettings: false
                            }
                        })}
                        style={{
                            flex: 1,
                            padding: '16px',
                            border: '2px solid',
                            borderColor: importOptions.importType === 'partial' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                            background: importOptions.importType === 'partial' ? 'var(--background-modifier-hover)' : 'transparent',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <div style={{ fontWeight: '600' }}>部分导入</div>
                    </button>
                </div>
            </div>

            {/* 部分导入配置 */}
            {importOptions.importType === 'partial' && importOptions.partialImport && (
                <div className="partial-import-config">
                    <h4 style={{ marginBottom: '12px' }}>选择导入内容</h4>

                    {/* 表单字段选择 */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'var(--background-secondary)',
                            borderRadius: '6px',
                            marginBottom: '8px',
                            cursor: 'pointer'
                        }}
                        onClick={(e) => {
                            // 只有点击空白区域时才触发折叠/展开
                            const target = e.target;
                            const isCheckbox = target.tagName === 'INPUT' && target.type === 'checkbox';
                            const isTitle = target.classList.contains('field-title');

                            // 如果点击的是复选框、标题文本，不触发折叠
                            if (isCheckbox || isTitle) {
                                return;
                            }

                            // 否则触发折叠/展开
                            setExpandedSections(prev => ({
                                ...prev,
                                fields: !prev.fields
                            }));
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={importOptions.partialImport.importFields}
                                    onChange={(e) => {
                                        const newValue = e.target.checked;
                                        updatePartialImportConfig('importFields', newValue);
                                        // 当选中时，立即选择所有字段
                                        if (newValue && selectedFormData?.fields) {
                                            updatePartialImportConfig('fieldIds', selectedFormData.fields.map(f => f.id));
                                        } else {
                                            updatePartialImportConfig('fieldIds', []);
                                        }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span
                                    className="field-title"
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newValue = !importOptions.partialImport.importFields;
                                        updatePartialImportConfig('importFields', newValue);
                                        if (newValue && selectedFormData?.fields) {
                                            updatePartialImportConfig('fieldIds', selectedFormData.fields.map(f => f.id));
                                            // 如果选择了字段，确保展开状态为true
                                            setExpandedSections(prev => ({ ...prev, fields: true }));
                                        } else {
                                            updatePartialImportConfig('fieldIds', []);
                                        }
                                    }}
                                >
                                    表单字段
                                </span>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {selectedFormData?.fields?.length || 0} 个字段
                            </span>
                        </div>

                        {expandedSections.fields && selectedFormData?.fields && (
                            <div style={{
                                padding: '12px',
                                background: 'var(--background-primary)',
                                border: '1px solid var(--background-modifier-border)',
                                borderRadius: '6px'
                            }}>
                                <div style={{
                                    display: 'grid',
                                    gap: '6px',
                                    maxHeight: '200px',
                                    overflowY: 'auto'
                                }}>
                                    {selectedFormData.fields.map(field => (
                                        <label key={field.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '8px 12px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            background: 'var(--background-secondary)',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={(importOptions.partialImport.fieldIds || []).includes(field.id)}
                                                onChange={(e) => {
                                                    const current = importOptions.partialImport.fieldIds || [];
                                                    if (e.target.checked) {
                                                        updatePartialImportConfig('fieldIds', [...current, field.id]);
                                                    } else {
                                                        updatePartialImportConfig('fieldIds', current.filter(id => id !== field.id));
                                                    }
                                                }}
                                            />
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <div style={{ fontWeight: '500' }}>{field.label || field.name}</div>
                                                <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                                    <span>类型: {getFieldTypeDisplayName(field.type)}</span>
                                                    <span>({field.type})</span>
                                                    {(field.defaultValue !== undefined && field.defaultValue !== '') && (
                                                        <span style={{ color: 'var(--text-accent)' }}>包含默认值</span>
                                                    )}
                                                    {field.required && <span style={{ color: 'var(--text-error)' }}>必填</span>}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 表单动作选择 */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'var(--background-secondary)',
                            borderRadius: '6px',
                            marginBottom: '8px',
                            cursor: 'pointer'
                        }}
                        onClick={(e) => {
                            // 只有点击空白区域时才触发折叠/展开
                            const target = e.target;
                            const isCheckbox = target.tagName === 'INPUT' && target.type === 'checkbox';
                            const isTitle = target.classList.contains('action-title');

                            // 如果点击的是复选框、标题文本，不触发折叠
                            if (isCheckbox || isTitle) {
                                return;
                            }

                            // 否则触发折叠/展开
                            setExpandedSections(prev => ({
                                ...prev,
                                actions: !prev.actions
                            }));
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={importOptions.partialImport.importActions}
                                    onChange={(e) => {
                                        const newValue = e.target.checked;
                                        updatePartialImportConfig('importActions', newValue);
                                        if (newValue && selectedFormData?.actions) {
                                            updatePartialImportConfig('actionIds', selectedFormData.actions.map(a => a.id));
                                        } else {
                                            updatePartialImportConfig('actionIds', []);
                                        }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span
                                    className="action-title"
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newValue = !importOptions.partialImport.importActions;
                                        updatePartialImportConfig('importActions', newValue);
                                        if (newValue && selectedFormData?.actions) {
                                            updatePartialImportConfig('actionIds', selectedFormData.actions.map(a => a.id));
                                            // 如果选择了动作，确保展开状态为true
                                            setExpandedSections(prev => ({ ...prev, actions: true }));
                                        } else {
                                            updatePartialImportConfig('actionIds', []);
                                        }
                                    }}
                                >
                                    表单动作
                                </span>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {selectedFormData?.actions?.length || 0} 个动作
                            </span>
                        </div>

                        {expandedSections.actions && selectedFormData?.actions && (
                            <div style={{
                                padding: '12px',
                                background: 'var(--background-primary)',
                                border: '1px solid var(--background-modifier-border)',
                                borderRadius: '6px'
                            }}>
                                <div style={{
                                    display: 'grid',
                                    gap: '6px',
                                    maxHeight: '200px',
                                    overflowY: 'auto'
                                }}>
                                    {selectedFormData.actions.map(action => (
                                        <label key={action.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '8px 12px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            background: 'var(--background-secondary)',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={(importOptions.partialImport.actionIds || []).includes(action.id)}
                                                onChange={(e) => {
                                                    const current = importOptions.partialImport.actionIds || [];
                                                    if (e.target.checked) {
                                                        updatePartialImportConfig('actionIds', [...current, action.id]);
                                                    } else {
                                                        updatePartialImportConfig('actionIds', current.filter(id => id !== action.id));
                                                    }
                                                }}
                                            />
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <div style={{ fontWeight: '500' }}>{action.name || action.label}</div>
                                                <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                                    <span>类型: {getActionTypeDisplayName(action.type)}</span>
                                                    <span>({action.type})</span>
                                                    {action.target && <span>目标: {action.target}</span>}
                                                    {action.confirmation && <span style={{ color: 'var(--text-warning)' }}>需确认</span>}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 其他设置选择 */}
                    <div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'var(--background-secondary)',
                            borderRadius: '6px',
                            marginBottom: '8px',
                            cursor: 'pointer'
                        }}
                        onClick={(e) => {
                            // 只有点击空白区域时才触发折叠/展开
                            const target = e.target;
                            const isCheckbox = target.tagName === 'INPUT' && target.type === 'checkbox';
                            const isTitle = target.classList.contains('other-title');

                            // 如果点击的是复选框、标题文本，不触发折叠
                            if (isCheckbox || isTitle) {
                                return;
                            }

                            // 否则触发折叠/展开
                            setExpandedSections(prev => ({
                                ...prev,
                                otherSettings: !prev.otherSettings
                            }));
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                    type="checkbox"
                                    checked={importOptions.partialImport.importOtherSettings}
                                    onChange={(e) => {
                                        const newValue = e.target.checked;
                                        updatePartialImportConfig('importOtherSettings', newValue);
                                        // 当启用其他设置时，默认启用所有子项
                                        if (newValue) {
                                            updateOtherSetting('showSubmitSuccessToast', true);
                                            updateOtherSetting('enableExecutionTimeout', true);
                                            updateOtherSetting('executionTimeoutThreshold', 30);
                                        } else {
                                            updateOtherSetting('showSubmitSuccessToast', false);
                                            updateOtherSetting('enableExecutionTimeout', false);
                                        }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span
                                    className="other-title"
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const newValue = !importOptions.partialImport.importOtherSettings;
                                        updatePartialImportConfig('importOtherSettings', newValue);
                                        // 当启用其他设置时，默认启用所有子项
                                        if (newValue) {
                                            updateOtherSetting('showSubmitSuccessToast', true);
                                            updateOtherSetting('enableExecutionTimeout', true);
                                            updateOtherSetting('executionTimeoutThreshold', 30);
                                            // 如果选择了其他设置，确保展开状态为true
                                            setExpandedSections(prev => ({ ...prev, otherSettings: true }));
                                        } else {
                                            updateOtherSetting('showSubmitSuccessToast', false);
                                            updateOtherSetting('enableExecutionTimeout', false);
                                        }
                                    }}
                                >
                                    其他设置
                                </span>
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                表单配置选项
                            </span>
                        </div>

                        {expandedSections.otherSettings && (
                            <div style={{
                                padding: '12px',
                                background: 'var(--background-primary)',
                                border: '1px solid var(--background-modifier-border)',
                                borderRadius: '6px'
                            }}>
                                <div style={{ display: 'grid', gap: '8px' }}>
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        background: 'var(--background-secondary)',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={importOptions.partialImport.otherSettings?.showSubmitSuccessToast !== false}
                                            onChange={(e) => updateOtherSetting('showSubmitSuccessToast', e.target.checked)}
                                            style={{ marginTop: '2px' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '500', marginBottom: '2px' }}>显示提交成功提示</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                提交表单后显示成功通知消息
                                            </div>
                                        </div>
                                    </label>
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        background: 'var(--background-secondary)',
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={importOptions.partialImport.otherSettings?.enableExecutionTimeout === true}
                                            onChange={(e) => updateOtherSetting('enableExecutionTimeout', e.target.checked)}
                                            style={{ marginTop: '2px' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '500', marginBottom: '2px' }}>启用执行超时</div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                                防止表单动作执行时间过长
                                            </div>
                                        </div>
                                    </label>
                                    {importOptions.partialImport.otherSettings?.enableExecutionTimeout && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '12px',
                                            padding: '8px 12px',
                                            borderRadius: '4px',
                                            background: 'var(--background-modifier-hover)',
                                        }}>
                                            <span style={{ minWidth: '80px' }}>超时阈值:</span>
                                            <input
                                                type="number"
                                                min="5"
                                                step="1"
                                                value={importOptions.partialImport.otherSettings?.executionTimeoutThreshold || 30}
                                                onChange={(e) => updateOtherSetting('executionTimeoutThreshold', parseInt(e.target.value, 10) || 30)}
                                                style={{
                                                    width: '80px',
                                                    padding: '4px 6px',
                                                    border: '1px solid var(--background-modifier-border)',
                                                    borderRadius: '4px',
                                                    background: 'var(--background-primary)',
                                                    color: 'var(--text-normal)'
                                                }}
                                            />
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>秒后超时</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 数据独立性选项 */}
            <div className="data-independence-option" style={{
                marginTop: '24px',
                padding: '16px',
                background: 'var(--background-modifier-hover)',
                borderRadius: '8px',
            }}>
                <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                }}>
                    <input
                        type="checkbox"
                        checked={importOptions.deepCopy}
                        onChange={(e) => setImportOptions({
                            ...importOptions,
                            deepCopy: e.target.checked
                        })}
                    />
                    <div>
                        <strong>确保数据独立性</strong>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            执行深拷贝操作，确保导入的数据与原始表单完全分离
                        </div>
                    </div>
                </label>
            </div>

            {/* 操作按钮 */}
            <div className="step-actions" style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '24px',
            }}>
                <button
                    onClick={() => setCurrentStep('select')}
                    style={{
                        padding: '10px 20px',
                        border: '1px solid var(--background-modifier-border)',
                        background: 'var(--background-secondary)',
                        color: 'var(--text-normal)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                    }}
                >
                    上一步
                </button>
                <button
                    onClick={handleImport}
                    disabled={!hasValidSelection()}
                    style={{
                        padding: '10px 20px',
                        border: 'none',
                        background: hasValidSelection() ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                        color: hasValidSelection() ? 'var(--text-on-accent)' : 'var(--text-muted)',
                        borderRadius: '6px',
                        cursor: hasValidSelection() ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                    }}
                >
                    <Download size={16} />
                    开始导入
                </button>
            </div>
        </div>
    );

    // 渲染导入进度
    const renderImportProgress = () => (
        <div className="import-step import-progress">
            <div className="step-header">
                <h3>正在导入表单数据</h3>
                <p className="step-description">请稍候，正在处理您的导入请求...</p>
            </div>

            <div style={{
                textAlign: 'center',
                padding: '40px 20px',
            }}>
                <Loader2 className="animate-spin" size={48} style={{
                    margin: '0 auto 16px',
                    color: 'var(--interactive-accent)',
                }} />

                {importProgress && (
                    <div>
                        <div style={{
                            fontSize: '16px',
                            fontWeight: '500',
                            marginBottom: '8px',
                            color: 'var(--text-normal)',
                        }}>
                            {importProgress.step}
                        </div>

                        {importProgress.details && (
                            <div style={{
                                fontSize: '14px',
                                color: 'var(--text-muted)',
                                marginBottom: '16px',
                            }}>
                                {importProgress.details}
                            </div>
                        )}

                        {/* 进度条 */}
                        <div style={{
                            width: '100%',
                            height: '8px',
                            background: 'var(--background-modifier-border)',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            marginBottom: '8px',
                        }}>
                            <div style={{
                                width: `${importProgress.percentage}%`,
                                height: '100%',
                                background: 'var(--interactive-accent)',
                                transition: 'width 0.3s ease',
                            }} />
                        </div>

                        <div style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                        }}>
                            {importProgress.percentage}%
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    // 渲染导入结果
    const renderImportResult = () => (
        <div className="import-step import-result">
            <div className="step-header">
                <h3>
                    {importResult?.success ? '导入成功' : '导入失败'}
                </h3>
                <p className="step-description">
                    {importResult?.success
                        ? '表单数据已成功导入，您可以继续编辑和调整'
                        : importResult?.error || '导入过程中发生未知错误'
                    }
                </p>
            </div>

            {/* 导入摘要 */}
            {importResult?.success && importResult.summary && (
                <div className="import-summary" style={{
                    padding: '16px',
                    background: 'var(--background-secondary)',
                    borderRadius: '8px',
                    marginBottom: '24px',
                }}>
                    <h4 style={{ marginBottom: '12px' }}>导入摘要</h4>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '12px',
                    }}>
                        <div style={{
                            textAlign: 'center',
                            padding: '12px',
                            background: 'var(--background-primary)',
                            borderRadius: '6px',
                        }}>
                            <div style={{
                                fontSize: '24px',
                                fontWeight: '600',
                                color: 'var(--interactive-accent)',
                                marginBottom: '4px',
                            }}>
                                {importResult.summary.importedFieldsCount}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                个字段
                            </div>
                        </div>

                        <div style={{
                            textAlign: 'center',
                            padding: '12px',
                            background: 'var(--background-primary)',
                            borderRadius: '6px',
                        }}>
                            <div style={{
                                fontSize: '24px',
                                fontWeight: '600',
                                color: 'var(--interactive-accent)',
                                marginBottom: '4px',
                            }}>
                                {importResult.summary.importedActionsCount}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                个动作
                            </div>
                        </div>

                        <div style={{
                            textAlign: 'center',
                            padding: '12px',
                            background: 'var(--background-primary)',
                            borderRadius: '6px',
                        }}>
                            <div style={{
                                fontSize: '24px',
                                fontWeight: '600',
                                color: 'var(--interactive-accent)',
                                marginBottom: '4px',
                            }}>
                                {importResult.summary.importedOtherSettingsCount}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                项其他设置
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 警告信息 */}
            {importResult?.warnings && importResult.warnings.length > 0 && (
                <div className="import-warnings" style={{
                    padding: '16px',
                    background: 'var(--background-warning)',
                    border: '1px solid var(--background-modifier-error)',
                    borderRadius: '8px',
                    marginBottom: '24px',
                }}>
                    <h4 style={{ marginBottom: '12px', color: 'var(--text-warning)' }}>注意事项</h4>
                    <ul style={{ margin: 0, paddingLeft: '16px' }}>
                        {importResult.warnings.map((warning, index) => (
                            <li key={index} style={{ color: 'var(--text-warning)', marginBottom: '4px' }}>
                                {warning}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* 操作按钮 */}
            <div className="step-actions" style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '24px',
            }}>
                <button
                    onClick={onClose}
                    style={{
                        padding: '10px 20px',
                        border: '1px solid var(--background-modifier-border)',
                        background: 'var(--background-secondary)',
                        color: 'var(--text-normal)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                    }}
                >
                    关闭
                </button>
                {importResult?.success && (
                    <button
                        onClick={handleComplete}
                        style={{
                            padding: '10px 20px',
                            border: 'none',
                            background: 'var(--interactive-accent)',
                            color: 'var(--text-on-accent)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    >
                        完成导入
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className="form-import-dialog-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
        }}>
            <div className="form-import-dialog" style={{
                width: '90%',
                maxWidth: '800px',
                maxHeight: '90vh',
                background: 'var(--background-primary)',
                borderRadius: '12px',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
            }}>
                {/* 对话框头部 */}
                <div className="dialog-header" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--background-modifier-border)',
                }}>
                    <h2 style={{
                        margin: 0,
                        fontSize: '20px',
                        fontWeight: '600',
                        color: 'var(--text-normal)',
                    }}>
                        导入表单数据
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.background = 'var(--background-modifier-hover)';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* 进度指示器 */}
                <div className="progress-indicator" style={{
                    display: 'flex',
                    padding: '0 24px',
                    marginTop: '16px',
                    gap: '8px',
                }}>
                    {[
                        { key: 'select', label: '选择表单' },
                        { key: 'configure', label: '配置选项' },
                        { key: 'importing', label: '导入数据' },
                        { key: 'result', label: '完成' }
                    ].map((step, index) => (
                        <div key={step.key} style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            <div style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: currentStep === step.key
                                    ? 'var(--interactive-accent)'
                                    : (['select', 'configure', 'importing', 'result'].indexOf(currentStep) > index
                                        ? 'var(--interactive-accent)'
                                        : 'var(--background-modifier-border)'),
                                color: currentStep === step.key || ['select', 'configure', 'importing', 'result'].indexOf(currentStep) > index
                                    ? 'var(--text-on-accent)'
                                    : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: '500',
                            }}>
                                {['select', 'configure', 'importing', 'result'].indexOf(currentStep) > index ? '✓' : (index + 1)}
                            </div>
                            <span style={{
                                fontSize: '12px',
                                color: currentStep === step.key
                                    ? 'var(--text-normal)'
                                    : (['select', 'configure', 'importing', 'result'].indexOf(currentStep) > index
                                        ? 'var(--text-normal)'
                                        : 'var(--text-muted)'),
                            }}>
                                {step.label}
                            </span>
                            {index < 3 && (
                                <div style={{
                                    flex: 1,
                                    height: '1px',
                                    background: ['select', 'configure', 'importing', 'result'].indexOf(currentStep) > index
                                        ? 'var(--interactive-accent)'
                                        : 'var(--background-modifier-border)',
                                }} />
                            )}
                        </div>
                    ))}
                </div>

                {/* 对话框内容 */}
                <div className="dialog-content" style={{
                    flex: 1,
                    padding: '24px',
                    overflowY: 'auto',
                }}>
                    {currentStep === 'select' && renderFormSelection()}
                    {currentStep === 'configure' && renderImportConfiguration()}
                    {currentStep === 'importing' && renderImportProgress()}
                    {currentStep === 'result' && renderImportResult()}
                </div>
            </div>
        </div>
    );
}