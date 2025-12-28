import { v4 } from "uuid";

/**
 * 启动条件类型枚举
 */
export enum StartupConditionType {
  /** 时间条件 */
  Time = "time",
  /** 文件条件 */
  File = "file",
  /** 系统条件 */
  System = "system",
  /** 自定义脚本条件 */
  Script = "script",
}

/**
 * 时间条件子类型
 */
export enum TimeConditionSubType {
  /** 时间段 */
  TimeRange = "time_range",
  /** 星期几 */
  DayOfWeek = "day_of_week",
  /** 日期范围 */
  DateRange = "date_range",
  /** 距离上次执行的间隔 */
  LastExecutionInterval = "last_execution_interval",
}

/**
 * 文件条件子类型
 */
export enum FileConditionSubType {
  /** 文件存在性检查（仅在指定具体文件模式下可用） */
  FileExists = "file_exists",
  /** 文件状态检查（是否打开、是否激活）（仅在指定具体文件模式下可用） */
  FileStatus = "file_status",
  /** 文件内容包含检查 */
  ContentContains = "content_contains",
  /** Frontmatter 属性检查 */
  FrontmatterProperty = "frontmatter_property",
  /** @deprecated 路径匹配（已废弃，保留用于向后兼容） */
  PathMatch = "path_match",
}

/**
 * 文件检测目标类型
 */
export enum FileCheckType {
  /** 检测文件是否存在 */
  File = "file",
  /** 检测文件夹是否存在 */
  Folder = "folder",
  /** 检测文件夹中是否存在文件 */
  FolderHasFiles = "folder_has_files",
}

/**
 * 文件目标模式
 */
export enum FileTargetMode {
  /** 当前激活文件 */
  CurrentFile = "current_file",
  /** 指定具体文件 */
  SpecificFile = "specific_file",
}

/**
 * 文件状态检查选项
 */
export enum FileStatusCheckType {
  /** 文件是否在编辑器中打开 */
  IsOpen = "is_open",
  /** 文件是否是当前激活文件 */
  IsActive = "is_active",
}

/**
 * 系统条件子类型
 */
export enum SystemConditionSubType {
  /** 插件版本 */
  PluginVersion = "plugin_version",
  /** Obsidian 版本 */
  ObsidianVersion = "obsidian_version",
  /** 工作区布局 */
  WorkspaceLayout = "workspace_layout",
}

/**
 * 条件逻辑关系
 */
export enum ConditionRelation {
  And = "and",
  Or = "or",
}

/**
 * 条件操作符
 */
export enum ConditionOperator {
  Equals = "equals",
  NotEquals = "not_equals",
  Contains = "contains",
  NotContains = "not_contains",
  GreaterThan = "greater_than",
  GreaterThanOrEqual = "greater_than_or_equal",
  LessThan = "less_than",
  LessThanOrEqual = "less_than_or_equal",
  Matches = "matches",
  Between = "between",
  In = "in",
  NotIn = "not_in",
}

/**
 * 时间条件配置
 */
export interface TimeConditionConfig {
  subType: TimeConditionSubType;
  /** 比较操作符（可选，默认根据子类型使用默认行为） */
  operator?: ConditionOperator;
  /** 时间段开始（HH:mm 格式） */
  startTime?: string;
  /** 时间段结束（HH:mm 格式） */
  endTime?: string;
  /** 星期几列表（0-6，0 表示周日） */
  daysOfWeek?: number[];
  /** 日期范围开始（YYYY-MM-DD 格式） */
  startDate?: string;
  /** 日期范围结束（YYYY-MM-DD 格式） */
  endDate?: string;
  /** 间隔时间（分钟） */
  intervalMinutes?: number;
}

/**
 * 文件条件配置
 */
export interface FileConditionConfig {
  subType: FileConditionSubType;
  /** 检测目标类型（文件/文件夹/文件夹是否包含文件），默认 File */
  checkType?: FileCheckType;
  /** 文件目标模式 */
  targetMode?: FileTargetMode;
  /** 指定的文件路径（当 targetMode 为 SpecificFile 时使用） */
  targetFilePath?: string;
  /** 文件内容搜索文本 */
  searchText?: string;
  /** Frontmatter 属性名（单属性检查，向后兼容） */
  propertyName?: string;
  /** Frontmatter 属性值（单属性检查，向后兼容） */
  propertyValue?: string;
  /** 操作符（单属性检查，向后兼容） */
  operator?: ConditionOperator;
  /** 多属性检查配置 */
  properties?: PropertyCheckConfig[];
  /** 文件状态检查选项 */
  fileStatusChecks?: FileStatusCheckType[];
  /** @deprecated 文件路径模式（已废弃，保留用于向后兼容） */
  pathPattern?: string;
}

/**
 * 属性检查配置
 */
export interface PropertyCheckConfig {
  /** 属性名 */
  name: string;
  /** 操作符 */
  operator: ConditionOperator;
  /** 期望值 */
  value: string;
}

/**
 * 系统条件配置
 */
export interface SystemConditionConfig {
  subType: SystemConditionSubType;
  /** 版本号 */
  version?: string;
  /** 操作符 */
  operator?: ConditionOperator;
  /** 布局类型 */
  layoutType?: string;
}

/**
 * 脚本条件配置
 */
export interface ScriptConditionConfig {
  /** JavaScript 表达式 */
  expression: string;
}

/**
 * 单个启动条件
 */
export interface StartupCondition {
  /** 条件唯一标识 */
  id: string;
  /** 条件类型 */
  type: StartupConditionType | "group";
  /** 条件名称（用于显示） */
  name?: string;
  /** 条件配置 */
  config?: TimeConditionConfig | FileConditionConfig | SystemConditionConfig | ScriptConditionConfig;
  /** 与其他条件的逻辑关系 */
  relation: ConditionRelation;
  /** 子条件（用于条件组） */
  conditions?: StartupCondition[];
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 启动条件根配置
 */
export interface StartupConditionsConfig {
  /** 是否启用启动条件 */
  enabled: boolean;
  /** 根条件逻辑关系 */
  relation: ConditionRelation;
  /** 条件列表 */
  conditions: StartupCondition[];
}

/**
 * 创建空的启动条件配置
 */
export function createEmptyStartupConditionsConfig(): StartupConditionsConfig {
  return {
    enabled: false,
    relation: ConditionRelation.And,
    conditions: [],
  };
}

/**
 * 创建新的条件
 */
export function createCondition(type: StartupConditionType): StartupCondition {
  return {
    id: v4(),
    type,
    relation: ConditionRelation.And,
    enabled: true,
    config: getDefaultConfig(type),
  };
}

/**
 * 创建条件组
 */
export function createConditionGroup(): StartupCondition {
  return {
    id: v4(),
    type: "group",
    relation: ConditionRelation.And,
    enabled: true,
    conditions: [],
  };
}

/**
 * 获取条件类型的默认配置
 */
function getDefaultConfig(
  type: StartupConditionType
): TimeConditionConfig | FileConditionConfig | SystemConditionConfig | ScriptConditionConfig {
  switch (type) {
    case StartupConditionType.Time:
      return {
        subType: TimeConditionSubType.TimeRange,
        startTime: "09:00",
        endTime: "18:00",
      };
    case StartupConditionType.File:
      return {
        subType: FileConditionSubType.ContentContains,
        targetMode: FileTargetMode.CurrentFile,
        operator: ConditionOperator.Equals,
      };
    case StartupConditionType.System:
      return {
        subType: SystemConditionSubType.PluginVersion,
        operator: ConditionOperator.GreaterThanOrEqual,
      };
    case StartupConditionType.Script:
      return {
        expression: "return true;",
      };
  }
}

/**
 * 预设条件模板
 */
export interface ConditionPreset {
  id: string;
  name: string;
  description: string;
  conditions: StartupCondition[];
}

/**
 * 获取预设条件模板列表
 */
export function getConditionPresets(): ConditionPreset[] {
  return [
    {
      id: "weekday_only",
      name: "startup_condition_preset_weekday_only",
      description: "startup_condition_preset_weekday_only_desc",
      conditions: [
        {
          id: v4(),
          type: StartupConditionType.Time,
          relation: ConditionRelation.And,
          enabled: true,
          config: {
            subType: TimeConditionSubType.DayOfWeek,
            daysOfWeek: [1, 2, 3, 4, 5],
          } as TimeConditionConfig,
        },
      ],
    },
    {
      id: "daytime_only",
      name: "startup_condition_preset_daytime_only",
      description: "startup_condition_preset_daytime_only_desc",
      conditions: [
        {
          id: v4(),
          type: StartupConditionType.Time,
          relation: ConditionRelation.And,
          enabled: true,
          config: {
            subType: TimeConditionSubType.TimeRange,
            startTime: "08:00",
            endTime: "20:00",
          } as TimeConditionConfig,
        },
      ],
    },
    {
      id: "once_per_day",
      name: "startup_condition_preset_once_per_day",
      description: "startup_condition_preset_once_per_day_desc",
      conditions: [
        {
          id: v4(),
          type: StartupConditionType.Time,
          relation: ConditionRelation.And,
          enabled: true,
          config: {
            subType: TimeConditionSubType.LastExecutionInterval,
            intervalMinutes: 1440,
          } as TimeConditionConfig,
        },
      ],
    },
    {
      id: "weekday_daytime",
      name: "startup_condition_preset_weekday_daytime",
      description: "startup_condition_preset_weekday_daytime_desc",
      conditions: [
        {
          id: v4(),
          type: StartupConditionType.Time,
          relation: ConditionRelation.And,
          enabled: true,
          config: {
            subType: TimeConditionSubType.DayOfWeek,
            daysOfWeek: [1, 2, 3, 4, 5],
          } as TimeConditionConfig,
        },
        {
          id: v4(),
          type: StartupConditionType.Time,
          relation: ConditionRelation.And,
          enabled: true,
          config: {
            subType: TimeConditionSubType.TimeRange,
            startTime: "09:00",
            endTime: "18:00",
          } as TimeConditionConfig,
        },
      ],
    },
  ];
}
