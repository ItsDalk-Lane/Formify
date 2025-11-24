import { FormConfig } from "./FormConfig";
import { IFormField } from "./field/IFormField";
import { IFormAction } from "./action/IFormAction";

/**
 * 表单导入配置选项
 */
export interface FormImportOptions {
    /** 导入类型：全部导入或部分导入 */
    importType: 'all' | 'partial';
    /** 部分导入的具体配置 */
    partialImport?: PartialImportConfig;
    /** 是否执行深拷贝确保数据独立性 */
    deepCopy?: boolean;
}

/**
 * 部分导入配置
 */
export interface PartialImportConfig {
    /** 是否导入字段 */
    importFields: boolean;
    /** 要导入的具体字段ID列表，为空则导入所有字段 */
    fieldIds?: string[];
    /** 是否导入动作 */
    importActions: boolean;
    /** 要导入的具体动作ID列表，为空则导入所有动作 */
    actionIds?: string[];
    /** 是否导入样式设置 */
    importStyles: boolean;
    /** 是否导入验证规则 */
    importValidationRules: boolean;
    /** 是否导入其他设置 */
    importOtherSettings: boolean;
    /** 其他设置的具体项 */
    otherSettings?: {
        showSubmitSuccessToast?: boolean;
        enableExecutionTimeout?: boolean;
        executionTimeoutThreshold?: number;
    };
}

/**
 * 表单导入结果
 */
export interface FormImportResult {
    /** 导入是否成功 */
    success: boolean;
    /** 导入的错误信息 */
    error?: string;
    /** 导入的内容摘要 */
    summary?: ImportSummary;
    /** 导入的表单配置 */
    importedConfig?: FormConfig;
    /** 导入操作的警告信息 */
    warnings?: string[];
}

/**
 * 导入内容摘要
 */
export interface ImportSummary {
    /** 导入的字段数量 */
    importedFieldsCount: number;
    /** 导入的动作数量 */
    importedActionsCount: number;
    /** 导入的样式设置数量 */
    importedStylesCount: number;
    /** 导入的验证规则数量 */
    importedValidationRulesCount: number;
    /** 导入的其他设置数量 */
    importedOtherSettingsCount: number;
}

/**
 * 可导入的表单信息
 */
export interface ImportableFormInfo {
    /** 表单ID */
    id: string;
    /** 表单文件路径 */
    filePath: string;
    /** 表单名称（从文件路径提取） */
    name: string;
    /** 表单字段数量 */
    fieldsCount: number;
    /** 表单动作数量 */
    actionsCount: number;
    /** 表单创建时间 */
    createdAt?: Date;
    /** 表单修改时间 */
    modifiedAt?: Date;
    /** 表单分类 */
    category?: string;
    /** 表单标签 */
    tags?: string[];
}

/**
 * 表单导入进度状态
 */
export interface ImportProgress {
    /** 当前步骤 */
    step: string;
    /** 进度百分比 (0-100) */
    percentage: number;
    /** 当前步骤的详细信息 */
    details?: string;
    /** 是否正在处理 */
    processing: boolean;
}

/**
 * 表单导入冲突类型
 */
export enum ImportConflictType {
    /** ID冲突 */
    ID_CONFLICT = 'id_conflict',
    /** 字段名称冲突 */
    FIELD_NAME_CONFLICT = 'field_name_conflict',
    /** 动作名称冲突 */
    ACTION_NAME_CONFLICT = 'action_name_conflict',
    /** 版本兼容性问题 */
    VERSION_INCOMPATIBLE = 'version_incompatible',
    /** 权限不足 */
    PERMISSION_DENIED = 'permission_denied',
    /** 文件损坏 */
    FILE_CORRUPTED = 'file_corrupted',
}

/**
 * 表单导入冲突信息
 */
export interface ImportConflict {
    /** 冲突类型 */
    type: ImportConflictType;
    /** 冲突描述 */
    description: string;
    /** 冲突的项ID */
    itemId?: string;
    /** 冲突的项名称 */
    itemName?: string;
    /** 建议的解决方案 */
    suggestedResolution?: ConflictResolution;
}

/**
 * 冲突解决方案
 */
export enum ConflictResolution {
    /** 跳过该项 */
    SKIP = 'skip',
    /** 重命名该项 */
    RENAME = 'rename',
    /** 覆盖该项 */
    OVERWRITE = 'overwrite',
    /** 合并该项 */
    MERGE = 'merge',
    /** 取消导入 */
    CANCEL = 'cancel',
}

/**
 * 表单导入过滤器配置
 */
export interface FormImportFilter {
    /** 搜索关键词 */
    searchKeyword?: string;
    /** 分类筛选 */
    category?: string;
    /** 标签筛选 */
    tags?: string[];
    /** 字段数量范围 */
    fieldsCountRange?: {
        min?: number;
        max?: number;
    };
    /** 动作数量范围 */
    actionsCountRange?: {
        min?: number;
        max?: number;
    };
    /** 创建时间范围 */
    dateRange?: {
        start?: Date;
        end?: Date;
    };
}