import { App, TFile } from "obsidian";
import {
  ConditionOperator,
  ConditionRelation,
  FileConditionConfig,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
  PropertyCheckConfig,
  ScriptConditionConfig,
  StartupCondition,
  StartupConditionsConfig,
  StartupConditionType,
  SystemConditionConfig,
  SystemConditionSubType,
  TimeConditionConfig,
  TimeConditionSubType,
} from "src/model/startup-condition/StartupCondition";
import { DebugLogger } from "src/utils/DebugLogger";
import { FormConfig } from "src/model/FormConfig";
import { processObTemplate } from "src/utils/templates";

/**
 * 条件评估上下文
 */
export interface ConditionEvaluationContext {
  /** Obsidian App 实例 */
  app: App;
  /** 当前文件 */
  currentFile?: TFile | null;
  /** 表单文件路径 */
  formFilePath?: string;
  /** 上次执行时间（毫秒时间戳） */
  lastExecutionTime?: number;
  /** 插件版本 */
  pluginVersion?: string;
  /** 表单配置（用于解析变量引用） */
  formConfig?: FormConfig;
}

/**
 * 条件评估结果
 */
export interface ConditionEvaluationResult {
  /** 是否满足条件 */
  satisfied: boolean;
  /** 评估详情 */
  details: string;
  /** 子条件评估结果 */
  childResults?: ConditionEvaluationResult[];
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 条件评估器接口
 */
export interface IConditionEvaluator {
  /**
   * 评估条件是否满足
   */
  evaluate(condition: StartupCondition, context: ConditionEvaluationContext): Promise<ConditionEvaluationResult>;
}

/**
 * 解析字符串中的变量引用
 * 支持:
 * - 表单变量: {{@fieldLabel}} - 使用字段的默认值
 * - 内置变量: {{date}}, {{time}}, {{random:n}} - 使用 processObTemplate 处理
 */
function resolveVariableReferences(value: string, context: ConditionEvaluationContext): string {
  if (!value) return value;

  let result = value;

  // 解析表单变量 {{@fieldLabel}}
  if (context.formConfig && context.formConfig.fields) {
    result = result.replace(/\{\{@([^}]+)\}\}/g, (match, fieldLabel) => {
      const field = context.formConfig!.fields.find(f => f.label === fieldLabel.trim());
      if (field && field.defaultValue !== undefined && field.defaultValue !== null) {
        return String(field.defaultValue);
      }
      // 如果找不到字段或没有默认值，返回原始匹配
      DebugLogger.debug(`[StartupConditionService] 无法解析变量 ${match}: 字段不存在或没有默认值`);
      return match;
    });
  }

  // 解析内置变量（date, time, random），使用 processObTemplate
  result = processObTemplate(result);

  return result;
}

/**
 * 启动条件评估服务
 * 负责评估表单的启动条件是否满足
 */
export class StartupConditionService {
  private static instance: StartupConditionService | null = null;
  private evaluators: Map<StartupConditionType, IConditionEvaluator> = new Map();

  private constructor() {
    this.registerDefaultEvaluators();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): StartupConditionService {
    if (!StartupConditionService.instance) {
      StartupConditionService.instance = new StartupConditionService();
    }
    return StartupConditionService.instance;
  }

  /**
   * 注册默认的条件评估器
   */
  private registerDefaultEvaluators(): void {
    this.evaluators.set(StartupConditionType.Time, new TimeConditionEvaluator());
    this.evaluators.set(StartupConditionType.File, new FileConditionEvaluator());
    this.evaluators.set(StartupConditionType.System, new SystemConditionEvaluator());
    this.evaluators.set(StartupConditionType.Script, new ScriptConditionEvaluator());
  }

  /**
   * 注册条件评估器（用于扩展）
   */
  registerEvaluator(type: StartupConditionType, evaluator: IConditionEvaluator): void {
    this.evaluators.set(type, evaluator);
  }

  /**
   * 评估启动条件配置
   */
  async evaluateConditions(
    config: StartupConditionsConfig | undefined,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    // 如果没有配置条件或条件未启用，则默认满足
    if (!config || !config.enabled || config.conditions.length === 0) {
      return {
        satisfied: true,
        details: "启动条件未配置或未启用，默认满足",
      };
    }

    try {
      const results: ConditionEvaluationResult[] = [];

      for (const condition of config.conditions) {
        const result = await this.evaluateCondition(condition, context);
        results.push(result);

        // 短路评估
        if (config.relation === ConditionRelation.And && !result.satisfied) {
          return {
            satisfied: false,
            details: `AND 条件不满足`,
            childResults: results,
          };
        }
        if (config.relation === ConditionRelation.Or && result.satisfied) {
          return {
            satisfied: true,
            details: `OR 条件满足`,
            childResults: results,
          };
        }
      }

      // 所有条件评估完成
      const satisfied = config.relation === ConditionRelation.And;
      return {
        satisfied,
        details: satisfied ? "所有 AND 条件都满足" : "所有 OR 条件都不满足",
        childResults: results,
      };
    } catch (error) {
      DebugLogger.error("[StartupConditionService] 评估条件时发生错误", error);
      return {
        satisfied: false,
        details: "条件评估发生错误",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 评估单个条件
   */
  async evaluateCondition(
    condition: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    // 如果条件未启用，视为满足
    if (!condition.enabled) {
      return {
        satisfied: true,
        details: "条件已禁用，视为满足",
      };
    }

    // 处理条件组
    if (condition.type === "group") {
      return this.evaluateConditionGroup(condition, context);
    }

    // 获取对应的评估器
    const evaluator = this.evaluators.get(condition.type as StartupConditionType);
    if (!evaluator) {
      DebugLogger.warn(`[StartupConditionService] 未找到条件类型 ${condition.type} 的评估器`);
      return {
        satisfied: false,
        details: `未知的条件类型: ${condition.type}`,
        error: `未知的条件类型: ${condition.type}`,
      };
    }

    try {
      return await evaluator.evaluate(condition, context);
    } catch (error) {
      DebugLogger.error(`[StartupConditionService] 评估条件失败`, error);
      return {
        satisfied: false,
        details: "条件评估失败",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 评估条件组
   */
  private async evaluateConditionGroup(
    group: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    if (!group.conditions || group.conditions.length === 0) {
      return {
        satisfied: true,
        details: "空条件组，默认满足",
      };
    }

    const results: ConditionEvaluationResult[] = [];
    const relation = group.relation;

    for (const condition of group.conditions) {
      const result = await this.evaluateCondition(condition, context);
      results.push(result);

      // 短路评估
      if (relation === ConditionRelation.And && !result.satisfied) {
        return {
          satisfied: false,
          details: `条件组 AND 条件不满足`,
          childResults: results,
        };
      }
      if (relation === ConditionRelation.Or && result.satisfied) {
        return {
          satisfied: true,
          details: `条件组 OR 条件满足`,
          childResults: results,
        };
      }
    }

    const satisfied = relation === ConditionRelation.And;
    return {
      satisfied,
      details: satisfied ? "条件组所有 AND 条件都满足" : "条件组所有 OR 条件都不满足",
      childResults: results,
    };
  }

  /**
   * 测试条件（用于 UI 预览）
   */
  async testConditions(
    config: StartupConditionsConfig,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    return this.evaluateConditions(config, context);
  }
}

/**
 * 时间条件评估器
 */
class TimeConditionEvaluator implements IConditionEvaluator {
  async evaluate(
    condition: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    const config = condition.config as TimeConditionConfig;
    if (!config) {
      return { satisfied: false, details: "时间条件配置缺失" };
    }

    const now = new Date();

    switch (config.subType) {
      case TimeConditionSubType.TimeRange:
        return this.evaluateTimeRange(config, now);
      case TimeConditionSubType.DayOfWeek:
        return this.evaluateDayOfWeek(config, now);
      case TimeConditionSubType.DateRange:
        return this.evaluateDateRange(config, now);
      case TimeConditionSubType.LastExecutionInterval:
        return this.evaluateLastExecutionInterval(config, context);
      default:
        return { satisfied: false, details: `未知的时间条件子类型: ${config.subType}` };
    }
  }

  private evaluateTimeRange(config: TimeConditionConfig, now: Date): ConditionEvaluationResult {
    if (!config.startTime || !config.endTime) {
      return { satisfied: false, details: "时间范围配置不完整" };
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMin] = config.startTime.split(":").map(Number);
    const [endHour, endMin] = config.endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    const operator = config.operator || ConditionOperator.Between;
    let satisfied: boolean;
    let details: string;

    switch (operator) {
      case ConditionOperator.NotEquals:
      case ConditionOperator.NotIn:
        // 不在时间范围内
        if (startMinutes <= endMinutes) {
          satisfied = currentMinutes < startMinutes || currentMinutes > endMinutes;
        } else {
          satisfied = currentMinutes < startMinutes && currentMinutes > endMinutes;
        }
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "不在" : "在"} ${config.startTime}-${config.endTime} 范围内`;
        break;

      case ConditionOperator.LessThan:
        // 早于开始时间
        satisfied = currentMinutes < startMinutes;
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "早于" : "不早于"} ${config.startTime}`;
        break;

      case ConditionOperator.LessThanOrEqual:
        // 早于或等于开始时间
        satisfied = currentMinutes <= startMinutes;
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "早于或等于" : "晚于"} ${config.startTime}`;
        break;

      case ConditionOperator.GreaterThan:
        // 晚于结束时间
        satisfied = currentMinutes > endMinutes;
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "晚于" : "不晚于"} ${config.endTime}`;
        break;

      case ConditionOperator.GreaterThanOrEqual:
        // 晚于或等于结束时间
        satisfied = currentMinutes >= endMinutes;
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "晚于或等于" : "早于"} ${config.endTime}`;
        break;

      case ConditionOperator.Equals:
      case ConditionOperator.Between:
      case ConditionOperator.In:
      default:
        // 在时间范围内（默认行为）
        if (startMinutes <= endMinutes) {
          satisfied = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        } else {
          // 跨午夜
          satisfied = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        }
        details = `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "在" : "不在"} ${config.startTime}-${config.endTime} 范围内`;
        break;
    }

    return { satisfied, details };
  }

  private evaluateDayOfWeek(config: TimeConditionConfig, now: Date): ConditionEvaluationResult {
    if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
      return { satisfied: true, details: "未指定星期限制" };
    }

    const currentDay = now.getDay();
    const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const operator = config.operator || ConditionOperator.In;

    let satisfied: boolean;
    let details: string;

    switch (operator) {
      case ConditionOperator.NotEquals:
      case ConditionOperator.NotIn:
        // 不在星期列表中
        satisfied = !config.daysOfWeek.includes(currentDay);
        details = `今天是${dayNames[currentDay]}，${satisfied ? "不在" : "在"}指定的日期列表中`;
        break;

      case ConditionOperator.Between:
        // 在连续星期范围内（使用列表的最小和最大值作为范围）
        if (config.daysOfWeek.length >= 2) {
          const minDay = Math.min(...config.daysOfWeek);
          const maxDay = Math.max(...config.daysOfWeek);
          satisfied = currentDay >= minDay && currentDay <= maxDay;
          details = `今天是${dayNames[currentDay]}，${satisfied ? "在" : "不在"}${dayNames[minDay]}至${dayNames[maxDay]}范围内`;
        } else {
          satisfied = config.daysOfWeek.includes(currentDay);
          details = `今天是${dayNames[currentDay]}，${satisfied ? "在" : "不在"}允许的日期列表中`;
        }
        break;

      case ConditionOperator.NotContains:
        // 不在连续星期范围内
        if (config.daysOfWeek.length >= 2) {
          const minDay = Math.min(...config.daysOfWeek);
          const maxDay = Math.max(...config.daysOfWeek);
          satisfied = currentDay < minDay || currentDay > maxDay;
          details = `今天是${dayNames[currentDay]}，${satisfied ? "不在" : "在"}${dayNames[minDay]}至${dayNames[maxDay]}范围内`;
        } else {
          satisfied = !config.daysOfWeek.includes(currentDay);
          details = `今天是${dayNames[currentDay]}，${satisfied ? "不在" : "在"}允许的日期列表中`;
        }
        break;

      case ConditionOperator.Equals:
      case ConditionOperator.In:
      default:
        // 在星期列表中（默认行为）
        satisfied = config.daysOfWeek.includes(currentDay);
        details = `今天是${dayNames[currentDay]}，${satisfied ? "在" : "不在"}允许的日期列表中`;
        break;
    }

    return { satisfied, details };
  }

  private evaluateDateRange(config: TimeConditionConfig, now: Date): ConditionEvaluationResult {
    const today = now.toISOString().split("T")[0];
    const operator = config.operator || ConditionOperator.Between;

    let satisfied: boolean;
    let details: string;

    // 检查是否在日期范围内
    const inRange = (): boolean => {
      if (config.startDate && today < config.startDate) return false;
      if (config.endDate && today > config.endDate) return false;
      return true;
    };

    switch (operator) {
      case ConditionOperator.NotEquals:
      case ConditionOperator.NotIn:
        // 不在日期范围内
        satisfied = !inRange();
        details = `当前日期 ${today} ${satisfied ? "不在" : "在"} ${config.startDate || "起始"} 至 ${config.endDate || "结束"} 范围内`;
        break;

      case ConditionOperator.LessThan:
        // 早于开始日期
        satisfied = config.startDate ? today < config.startDate : false;
        details = `当前日期 ${today} ${satisfied ? "早于" : "不早于"} ${config.startDate || "未指定"}`;
        break;

      case ConditionOperator.LessThanOrEqual:
        // 早于或等于开始日期
        satisfied = config.startDate ? today <= config.startDate : false;
        details = `当前日期 ${today} ${satisfied ? "早于或等于" : "晚于"} ${config.startDate || "未指定"}`;
        break;

      case ConditionOperator.GreaterThan:
        // 晚于结束日期
        satisfied = config.endDate ? today > config.endDate : false;
        details = `当前日期 ${today} ${satisfied ? "晚于" : "不晚于"} ${config.endDate || "未指定"}`;
        break;

      case ConditionOperator.GreaterThanOrEqual:
        // 晚于或等于结束日期
        satisfied = config.endDate ? today >= config.endDate : false;
        details = `当前日期 ${today} ${satisfied ? "晚于或等于" : "早于"} ${config.endDate || "未指定"}`;
        break;

      case ConditionOperator.Equals:
      case ConditionOperator.Between:
      case ConditionOperator.In:
      default:
        // 在日期范围内（默认行为）
        satisfied = inRange();
        if (!satisfied) {
          if (config.startDate && today < config.startDate) {
            details = `当前日期 ${today} 早于开始日期 ${config.startDate}`;
          } else if (config.endDate && today > config.endDate) {
            details = `当前日期 ${today} 晚于结束日期 ${config.endDate}`;
          } else {
            details = `当前日期 ${today} 不在指定范围内`;
          }
        } else {
          details = `当前日期 ${today} 在指定范围内`;
        }
        break;
    }

    return { satisfied, details };
  }

  private evaluateLastExecutionInterval(
    config: TimeConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    if (!config.intervalMinutes) {
      return { satisfied: true, details: "未指定执行间隔" };
    }

    if (!context.lastExecutionTime) {
      return { satisfied: true, details: "首次执行，无上次执行记录" };
    }

    const now = Date.now();
    const elapsed = (now - context.lastExecutionTime) / 60000; // 转换为分钟
    const satisfied = elapsed >= config.intervalMinutes;

    return {
      satisfied,
      details: `距离上次执行已过 ${Math.floor(elapsed)} 分钟，${satisfied ? "已超过" : "未达到"}设定间隔 ${config.intervalMinutes} 分钟`,
    };
  }
}

/**
 * 文件条件评估器
 */
class FileConditionEvaluator implements IConditionEvaluator {
  async evaluate(
    condition: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    const config = condition.config as FileConditionConfig;
    if (!config) {
      return { satisfied: false, details: "文件条件配置缺失" };
    }

    // 确定目标文件
    const targetFile = await this.resolveTargetFile(config, context);

    switch (config.subType) {
      case FileConditionSubType.FileExists:
        return this.evaluateFileExists(config, context);
      case FileConditionSubType.FileStatus:
        return this.evaluateFileStatus(config, context);
      case FileConditionSubType.ContentContains:
        return await this.evaluateContentContains(config, context, targetFile);
      case FileConditionSubType.FrontmatterProperty:
        return await this.evaluateFrontmatterProperty(config, context, targetFile);
      case FileConditionSubType.PathMatch:
        // 向后兼容：PathMatch 已废弃，转换为检查当前文件路径
        return this.evaluatePathMatchLegacy(config, context);
      default:
        return { satisfied: false, details: `未知的文件条件子类型: ${config.subType}` };
    }
  }

  /**
   * 解析目标文件
   */
  private async resolveTargetFile(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): Promise<TFile | null> {
    const targetMode = config.targetMode || FileTargetMode.CurrentFile;
    
    if (targetMode === FileTargetMode.CurrentFile) {
      return context.currentFile || null;
    }

    // 指定具体文件模式
    if (!config.targetFilePath) {
      return null;
    }

    // 解析变量引用
    const resolvedPath = resolveVariableReferences(config.targetFilePath, context);
    const abstractFile = context.app.vault.getAbstractFileByPath(resolvedPath);
    if (abstractFile instanceof TFile) {
      return abstractFile;
    }

    return null;
  }

  /**
   * @deprecated 向后兼容：评估旧的路径匹配条件
   */
  private evaluatePathMatchLegacy(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    if (!context.currentFile || !config.pathPattern) {
      return { satisfied: false, details: "当前无文件或未配置路径模式" };
    }

    const filePath = context.currentFile.path;
    const pattern = config.pathPattern;

    // 简单的通配符匹配
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      "i"
    );
    const satisfied = regex.test(filePath);

    return {
      satisfied,
      details: `文件路径 "${filePath}" ${satisfied ? "匹配" : "不匹配"} 模式 "${pattern}"`,
    };
  }

  /**
   * 评估文件存在性（仅在指定具体文件模式下使用）
   */
  private evaluateFileExists(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    // 文件存在检查只在指定具体文件模式下有意义
    if (config.targetMode !== FileTargetMode.SpecificFile) {
      return { satisfied: true, details: "当前文件模式下此检查无意义，默认满足" };
    }

    if (!config.targetFilePath) {
      return { satisfied: false, details: "未指定目标文件路径" };
    }

    // 解析变量引用
    const resolvedPath = resolveVariableReferences(config.targetFilePath, context);
    const abstractFile = context.app.vault.getAbstractFileByPath(resolvedPath);
    const fileExists = abstractFile instanceof TFile;

    const operator = config.operator || ConditionOperator.Equals;
    let satisfied: boolean;
    let details: string;

    switch (operator) {
      case ConditionOperator.NotEquals:
        // 文件不存在
        satisfied = !fileExists;
        details = satisfied 
          ? `文件 "${resolvedPath}" 在 vault 中不存在（符合预期）` 
          : `文件 "${resolvedPath}" 在 vault 中存在（预期不存在）`;
        break;

      case ConditionOperator.Equals:
      default:
        // 文件存在（默认行为）
        satisfied = fileExists;
        details = satisfied 
          ? `文件 "${resolvedPath}" 在 vault 中存在` 
          : `文件 "${resolvedPath}" 在 vault 中不存在`;
        break;
    }

    return { satisfied, details };
  }

  /**
   * 评估文件状态（是否打开、是否激活）
   */
  private evaluateFileStatus(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    // 文件状态检查只在指定具体文件模式下有意义
    if (config.targetMode !== FileTargetMode.SpecificFile) {
      return { satisfied: true, details: "当前文件模式下此检查无意义，默认满足" };
    }

    if (!config.targetFilePath) {
      return { satisfied: false, details: "未指定目标文件路径" };
    }

    // 解析变量引用
    const resolvedPath = resolveVariableReferences(config.targetFilePath, context);
    
    const checks = config.fileStatusChecks || [];
    if (checks.length === 0) {
      return { satisfied: true, details: "未指定文件状态检查条件" };
    }

    const results: string[] = [];
    let allChecksPassed = true;

    // 检查文件是否在编辑器中打开
    if (checks.includes(FileStatusCheckType.IsOpen)) {
      const isOpen = this.isFileOpen(context.app, resolvedPath);
      results.push(`文件${isOpen ? "已" : "未"}在编辑器中打开`);
      if (!isOpen) allChecksPassed = false;
    }

    // 检查文件是否是当前激活文件
    if (checks.includes(FileStatusCheckType.IsActive)) {
      const isActive = context.currentFile?.path === resolvedPath;
      results.push(`文件${isActive ? "是" : "不是"}当前激活文件`);
      if (!isActive) allChecksPassed = false;
    }

    // 应用操作符
    const operator = config.operator || ConditionOperator.Equals;
    let satisfied: boolean;

    switch (operator) {
      case ConditionOperator.NotEquals:
        // 文件状态不满足（期望不满足配置的状态检查）
        satisfied = !allChecksPassed;
        break;

      case ConditionOperator.Equals:
      default:
        // 文件状态满足（默认行为）
        satisfied = allChecksPassed;
        break;
    }

    return {
      satisfied,
      details: results.join("；") + (operator === ConditionOperator.NotEquals ? "（期望不满足）" : ""),
    };
  }

  /**
   * 检查文件是否在编辑器中打开
   */
  private isFileOpen(app: App, filePath: string): boolean {
    const leaves = app.workspace.getLeavesOfType("markdown");
    return leaves.some((leaf) => {
      // @ts-ignore - 访问 leaf.view.file
      const file = leaf.view?.file;
      return file?.path === filePath;
    });
  }

  private async evaluateContentContains(
    config: FileConditionConfig,
    context: ConditionEvaluationContext,
    targetFile: TFile | null
  ): Promise<ConditionEvaluationResult> {
    if (!targetFile) {
      return { satisfied: false, details: "目标文件不存在或未指定" };
    }
    
    if (!config.searchText) {
      return { satisfied: false, details: "未配置搜索文本" };
    }

    try {
      const content = await context.app.vault.read(targetFile);
      // 解析变量引用
      const resolvedSearchText = resolveVariableReferences(config.searchText, context);
      const contentContainsText = content.includes(resolvedSearchText);

      const operator = config.operator || ConditionOperator.Contains;
      let satisfied: boolean;
      let details: string;

      switch (operator) {
        case ConditionOperator.NotContains:
        case ConditionOperator.NotEquals:
          // 内容不包含
          satisfied = !contentContainsText;
          details = `文件 "${targetFile.path}" 的内容${satisfied ? "不包含" : "包含"}指定文本`;
          break;

        case ConditionOperator.Contains:
        case ConditionOperator.Equals:
        default:
          // 内容包含（默认行为）
          satisfied = contentContainsText;
          details = `文件 "${targetFile.path}" 的内容${satisfied ? "包含" : "不包含"}指定文本`;
          break;
      }

      return { satisfied, details };
    } catch (error) {
      return {
        satisfied: false,
        details: "读取文件内容失败",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async evaluateFrontmatterProperty(
    config: FileConditionConfig,
    context: ConditionEvaluationContext,
    targetFile: TFile | null
  ): Promise<ConditionEvaluationResult> {
    if (!targetFile) {
      return { satisfied: false, details: "目标文件不存在或未指定" };
    }

    try {
      const cache = context.app.metadataCache.getFileCache(targetFile);
      const frontmatter = cache?.frontmatter;

      if (!frontmatter) {
        return { satisfied: false, details: "文件没有 frontmatter" };
      }

      // 优先使用新的多属性配置
      if (config.properties && config.properties.length > 0) {
        return this.evaluateMultipleProperties(frontmatter, config.properties, context);
      }

      // 向后兼容：使用旧的单属性配置
      if (!config.propertyName) {
        return { satisfied: false, details: "未配置属性名" };
      }

      const propertyValue = frontmatter[config.propertyName];
      const satisfied = this.compareValues(propertyValue, config.propertyValue, config.operator);

      return {
        satisfied,
        details: `属性 "${config.propertyName}" 的值 "${propertyValue}" ${satisfied ? "满足" : "不满足"}条件`,
      };
    } catch (error) {
      return {
        satisfied: false,
        details: "读取 frontmatter 失败",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 评估多个属性条件
   */
  private evaluateMultipleProperties(
    frontmatter: Record<string, any>,
    properties: PropertyCheckConfig[],
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    const results: string[] = [];
    let allSatisfied = true;

    for (const prop of properties) {
      // 解析属性名和值中的变量引用
      const resolvedName = resolveVariableReferences(prop.name, context);
      const resolvedValue = resolveVariableReferences(prop.value, context);
      
      const actualValue = frontmatter[resolvedName];
      const satisfied = this.compareValues(actualValue, resolvedValue, prop.operator);
      
      results.push(`属性 "${resolvedName}" 的值 "${actualValue}" ${satisfied ? "满足" : "不满足"}条件`);
      
      if (!satisfied) {
        allSatisfied = false;
      }
    }

    return {
      satisfied: allSatisfied,
      details: results.join("；"),
    };
  }

  private compareValues(
    actual: any,
    expected: string | undefined,
    operator: ConditionOperator | undefined
  ): boolean {
    if (actual === undefined) return false;
    if (expected === undefined) return actual !== undefined;

    const actualStr = String(actual);
    const op = operator || ConditionOperator.Equals;

    switch (op) {
      case ConditionOperator.Equals:
        return actualStr === expected;
      case ConditionOperator.NotEquals:
        return actualStr !== expected;
      case ConditionOperator.Contains:
        return actualStr.includes(expected);
      case ConditionOperator.NotContains:
        return !actualStr.includes(expected);
      default:
        return actualStr === expected;
    }
  }
}

/**
 * 系统条件评估器
 */
class SystemConditionEvaluator implements IConditionEvaluator {
  async evaluate(
    condition: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    const config = condition.config as SystemConditionConfig;
    if (!config) {
      return { satisfied: false, details: "系统条件配置缺失" };
    }

    switch (config.subType) {
      case SystemConditionSubType.PluginVersion:
        return this.evaluatePluginVersion(config, context);
      case SystemConditionSubType.ObsidianVersion:
        return this.evaluateObsidianVersion(config, context);
      case SystemConditionSubType.WorkspaceLayout:
        return this.evaluateWorkspaceLayout(config, context);
      default:
        return { satisfied: false, details: `未知的系统条件子类型: ${config.subType}` };
    }
  }

  private evaluatePluginVersion(
    config: SystemConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    if (!config.version || !context.pluginVersion) {
      return { satisfied: true, details: "版本信息不完整，跳过检查" };
    }

    const satisfied = this.compareVersions(context.pluginVersion, config.version, config.operator);
    return {
      satisfied,
      details: `插件版本 ${context.pluginVersion} ${satisfied ? "满足" : "不满足"} ${config.operator} ${config.version}`,
    };
  }

  private evaluateObsidianVersion(
    config: SystemConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    if (!config.version) {
      return { satisfied: true, details: "未指定版本要求" };
    }

    // @ts-ignore - 访问 Obsidian 内部 API
    const obsidianVersion = context.app.version || "unknown";
    const satisfied = this.compareVersions(obsidianVersion, config.version, config.operator);

    return {
      satisfied,
      details: `Obsidian 版本 ${obsidianVersion} ${satisfied ? "满足" : "不满足"} ${config.operator} ${config.version}`,
    };
  }

  private evaluateWorkspaceLayout(
    config: SystemConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    if (!config.layoutType) {
      return { satisfied: true, details: "未指定布局类型" };
    }

    // 检查工作区是否有分屏或特定布局
    const workspace = context.app.workspace;
    let satisfied = false;
    let currentLayout = "unknown";

    // 简单判断：检查是否有多个叶子节点
    const leaves = workspace.getLeavesOfType("markdown");
    if (config.layoutType === "split" && leaves.length > 1) {
      satisfied = true;
      currentLayout = "split";
    } else if (config.layoutType === "single" && leaves.length <= 1) {
      satisfied = true;
      currentLayout = "single";
    }

    return {
      satisfied,
      details: `当前布局 "${currentLayout}" ${satisfied ? "匹配" : "不匹配"} "${config.layoutType}"`,
    };
  }

  private compareVersions(
    current: string,
    required: string,
    operator: ConditionOperator | undefined
  ): boolean {
    const parseVersion = (v: string): number[] => {
      return v.split(".").map((n) => parseInt(n, 10) || 0);
    };

    const currentParts = parseVersion(current);
    const requiredParts = parseVersion(required);
    const maxLength = Math.max(currentParts.length, requiredParts.length);

    for (let i = currentParts.length; i < maxLength; i++) currentParts.push(0);
    for (let i = requiredParts.length; i < maxLength; i++) requiredParts.push(0);

    let comparison = 0;
    for (let i = 0; i < maxLength; i++) {
      if (currentParts[i] > requiredParts[i]) {
        comparison = 1;
        break;
      } else if (currentParts[i] < requiredParts[i]) {
        comparison = -1;
        break;
      }
    }

    switch (operator) {
      case ConditionOperator.Equals:
        return comparison === 0;
      case ConditionOperator.NotEquals:
        return comparison !== 0;
      case ConditionOperator.GreaterThan:
        return comparison > 0;
      case ConditionOperator.GreaterThanOrEqual:
        return comparison >= 0;
      case ConditionOperator.LessThan:
        return comparison < 0;
      case ConditionOperator.LessThanOrEqual:
        return comparison <= 0;
      default:
        return comparison >= 0;
    }
  }
}

/**
 * 脚本条件评估器
 */
class ScriptConditionEvaluator implements IConditionEvaluator {
  async evaluate(
    condition: StartupCondition,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    const config = condition.config as ScriptConditionConfig;
    if (!config || !config.expression) {
      return { satisfied: false, details: "脚本条件配置缺失" };
    }

    try {
      // 创建安全的执行环境
      const scriptContext = {
        app: context.app,
        currentFile: context.currentFile,
        formFilePath: context.formFilePath,
        lastExecutionTime: context.lastExecutionTime,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        JSON,
      };

      // 构建函数体
      const funcBody = `
        with (context) {
          ${config.expression}
        }
      `;

      // 创建并执行函数
      const func = new Function("context", funcBody);
      const result = func(scriptContext);

      // 处理 Promise
      const finalResult = result instanceof Promise ? await result : result;
      const satisfied = Boolean(finalResult);

      return {
        satisfied,
        details: `脚本执行结果: ${satisfied}`,
      };
    } catch (error) {
      DebugLogger.error("[ScriptConditionEvaluator] 脚本执行失败", error);
      return {
        satisfied: false,
        details: "脚本执行失败",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * 获取启动条件服务实例
 */
export function getStartupConditionService(): StartupConditionService {
  return StartupConditionService.getInstance();
}
