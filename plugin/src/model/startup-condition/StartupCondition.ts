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
  /** 当前文件存在性检查 */
  FileExists = "file_exists",
  /** 路径匹配（支持通配符） */
  PathMatch = "path_match",
  /** 文件内容包含检查 */
  ContentContains = "content_contains",
  /** Frontmatter 属性检查 */
  FrontmatterProperty = "frontmatter_property",
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
  /** 文件路径或通配符模式 */
  pathPattern?: string;
  /** 文件内容搜索文本 */
  searchText?: string;
  /** Frontmatter 属性名 */
  propertyName?: string;
  /** Frontmatter 属性值 */
  propertyValue?: string;
  /** 操作符 */
  operator?: ConditionOperator;
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
        subType: FileConditionSubType.FileExists,
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
