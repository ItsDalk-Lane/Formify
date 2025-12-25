/**
 * 启动条件模块导出
 */
export {
  // 枚举类型
  StartupConditionType,
  TimeConditionSubType,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
  SystemConditionSubType,
  ConditionRelation,
  ConditionOperator,
  // 工具函数
  createEmptyStartupConditionsConfig,
  createCondition,
  createConditionGroup,
  getConditionPresets,
} from "./StartupCondition";

// 类型导出
export type {
  StartupCondition,
  StartupConditionsConfig,
  TimeConditionConfig,
  FileConditionConfig,
  PropertyCheckConfig,
  SystemConditionConfig,
  ScriptConditionConfig,
  ConditionPreset,
} from "./StartupCondition";
