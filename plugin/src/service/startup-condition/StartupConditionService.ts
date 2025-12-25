import { App, TFile } from "obsidian";
import {
  ConditionOperator,
  ConditionRelation,
  FileConditionConfig,
  FileConditionSubType,
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
            details: `AND 条件不满足: ${result.details}`,
            childResults: results,
          };
        }
        if (config.relation === ConditionRelation.Or && result.satisfied) {
          return {
            satisfied: true,
            details: `OR 条件满足: ${result.details}`,
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

    let satisfied: boolean;
    if (startMinutes <= endMinutes) {
      satisfied = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // 跨午夜
      satisfied = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    return {
      satisfied,
      details: `当前时间 ${now.toLocaleTimeString()} ${satisfied ? "在" : "不在"} ${config.startTime}-${config.endTime} 范围内`,
    };
  }

  private evaluateDayOfWeek(config: TimeConditionConfig, now: Date): ConditionEvaluationResult {
    if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
      return { satisfied: true, details: "未指定星期限制" };
    }

    const currentDay = now.getDay();
    const satisfied = config.daysOfWeek.includes(currentDay);
    const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

    return {
      satisfied,
      details: `今天是${dayNames[currentDay]}，${satisfied ? "在" : "不在"}允许的日期列表中`,
    };
  }

  private evaluateDateRange(config: TimeConditionConfig, now: Date): ConditionEvaluationResult {
    const today = now.toISOString().split("T")[0];
    let satisfied = true;
    let details = "";

    if (config.startDate && today < config.startDate) {
      satisfied = false;
      details = `当前日期 ${today} 早于开始日期 ${config.startDate}`;
    } else if (config.endDate && today > config.endDate) {
      satisfied = false;
      details = `当前日期 ${today} 晚于结束日期 ${config.endDate}`;
    } else {
      details = `当前日期 ${today} 在指定范围内`;
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

    switch (config.subType) {
      case FileConditionSubType.FileExists:
        return this.evaluateFileExists(config, context);
      case FileConditionSubType.PathMatch:
        return this.evaluatePathMatch(config, context);
      case FileConditionSubType.ContentContains:
        return await this.evaluateContentContains(config, context);
      case FileConditionSubType.FrontmatterProperty:
        return await this.evaluateFrontmatterProperty(config, context);
      default:
        return { satisfied: false, details: `未知的文件条件子类型: ${config.subType}` };
    }
  }

  private evaluateFileExists(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): ConditionEvaluationResult {
    const satisfied = context.currentFile !== null && context.currentFile !== undefined;
    return {
      satisfied,
      details: satisfied ? "当前有打开的文件" : "当前没有打开的文件",
    };
  }

  private evaluatePathMatch(
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

  private async evaluateContentContains(
    config: FileConditionConfig,
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    if (!context.currentFile || !config.searchText) {
      return { satisfied: false, details: "当前无文件或未配置搜索文本" };
    }

    try {
      const content = await context.app.vault.read(context.currentFile);
      const satisfied = content.includes(config.searchText);

      return {
        satisfied,
        details: `文件内容${satisfied ? "包含" : "不包含"}指定文本`,
      };
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
    context: ConditionEvaluationContext
  ): Promise<ConditionEvaluationResult> {
    if (!context.currentFile || !config.propertyName) {
      return { satisfied: false, details: "当前无文件或未配置属性名" };
    }

    try {
      const cache = context.app.metadataCache.getFileCache(context.currentFile);
      const frontmatter = cache?.frontmatter;

      if (!frontmatter) {
        return { satisfied: false, details: "文件没有 frontmatter" };
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
