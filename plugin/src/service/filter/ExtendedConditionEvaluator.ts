/**
 * 扩展条件评估器
 * 用于评估时间条件、文件条件和脚本表达式条件
 */
import { App, TFile, TFolder } from "obsidian";
import { Filter, FilterType } from "src/model/filter/Filter";
import {
  TimeConditionSubType,
  FileCheckType,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
  ConditionOperator,
} from "src/model/startup-condition/StartupCondition";
import type {
  TimeConditionConfig,
  FileConditionConfig,
  ScriptConditionConfig,
} from "src/model/startup-condition/StartupCondition";
import { DebugLogger } from "src/utils/DebugLogger";
import { ConditionVariableResolver } from "src/utils/ConditionVariableResolver";
import { FormConfig } from "src/model/FormConfig";

/**
 * 扩展条件评估上下文
 */
export interface ExtendedConditionContext {
  /** Obsidian App 实例 */
  app: App;
  /** 当前文件 */
  currentFile?: TFile | null;
  /** 表单配置（用于变量解析） */
  formConfig?: FormConfig;
  /** 表单当前值（用于变量解析） */
  formValues?: Record<string, any>;
  /** 表单文件路径 */
  formFilePath?: string;
}

/**
 * 扩展条件评估器
 * 提供同步的条件评估方法，用于字段显示和动作执行条件
 */
export class ExtendedConditionEvaluator {
  /**
   * 评估扩展条件
   * @param filter 过滤器条件
   * @param context 评估上下文（可选）
   * @returns 条件是否满足
   */
  static evaluate(filter: Filter, context?: ExtendedConditionContext): boolean {
    if (!filter.extendedConfig) {
      // 如果没有扩展配置，默认满足条件
      return true;
    }

    try {
      if (filter.type === FilterType.timeCondition) {
        return this.evaluateTimeCondition(filter.extendedConfig as TimeConditionConfig);
      }

      if (filter.type === FilterType.fileCondition) {
        return this.evaluateFileCondition(filter.extendedConfig as FileConditionConfig, context);
      }

      if (filter.type === FilterType.scriptCondition) {
        return this.evaluateScriptConditionSync(filter.extendedConfig as ScriptConditionConfig, context);
      }

      return true;
    } catch (error) {
      DebugLogger.error("[ExtendedConditionEvaluator] 评估条件失败", error);
      // 评估失败时默认返回 true，不阻止正常操作
      return true;
    }
  }

  /**
   * 评估时间条件
   */
  private static evaluateTimeCondition(config: TimeConditionConfig): boolean {
    const now = new Date();

    switch (config.subType) {
      case TimeConditionSubType.TimeRange:
        return this.evaluateTimeRange(config, now);
      case TimeConditionSubType.DayOfWeek:
        return this.evaluateDayOfWeek(config, now);
      case TimeConditionSubType.DateRange:
        return this.evaluateDateRange(config, now);
      default:
        return true;
    }
  }

  /**
   * 评估时间范围
   */
  private static evaluateTimeRange(config: TimeConditionConfig, now: Date): boolean {
    if (!config.startTime || !config.endTime) {
      return true;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMin] = config.startTime.split(":").map(Number);
    const [endHour, endMin] = config.endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    const operator = config.operator || ConditionOperator.Between;

    // 判断是否在范围内（考虑跨午夜）
    let inRange: boolean;
    if (startMinutes <= endMinutes) {
      inRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // 跨午夜的情况
      inRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    switch (operator) {
      case ConditionOperator.Between:
        return inRange;
      case ConditionOperator.NotIn:
        return !inRange;
      case ConditionOperator.LessThan:
        return currentMinutes < startMinutes;
      case ConditionOperator.LessThanOrEqual:
        return currentMinutes <= startMinutes;
      case ConditionOperator.GreaterThan:
        return currentMinutes > endMinutes;
      case ConditionOperator.GreaterThanOrEqual:
        return currentMinutes >= endMinutes;
      default:
        return inRange;
    }
  }

  /**
   * 评估星期几
   */
  private static evaluateDayOfWeek(config: TimeConditionConfig, now: Date): boolean {
    if (!config.daysOfWeek || config.daysOfWeek.length === 0) {
      return true;
    }

    const currentDay = now.getDay();
    const operator = config.operator || ConditionOperator.In;
    const isInList = config.daysOfWeek.includes(currentDay);

    switch (operator) {
      case ConditionOperator.In:
        return isInList;
      case ConditionOperator.NotIn:
        return !isInList;
      default:
        return isInList;
    }
  }

  /**
   * 评估日期范围
   */
  private static evaluateDateRange(config: TimeConditionConfig, now: Date): boolean {
    const today = now.toISOString().split("T")[0];
    const operator = config.operator || ConditionOperator.Between;

    // 判断是否在范围内
    const afterStart = !config.startDate || today >= config.startDate;
    const beforeEnd = !config.endDate || today <= config.endDate;
    const inRange = afterStart && beforeEnd;

    switch (operator) {
      case ConditionOperator.Between:
        return inRange;
      case ConditionOperator.NotIn:
        return !inRange;
      case ConditionOperator.LessThan:
        return config.startDate ? today < config.startDate : true;
      case ConditionOperator.LessThanOrEqual:
        return config.startDate ? today <= config.startDate : true;
      case ConditionOperator.GreaterThan:
        return config.endDate ? today > config.endDate : true;
      case ConditionOperator.GreaterThanOrEqual:
        return config.endDate ? today >= config.endDate : true;
      default:
        return inRange;
    }
  }

  /**
   * 评估文件条件
   */
  private static evaluateFileCondition(config: FileConditionConfig, context?: ExtendedConditionContext): boolean {
    if (!context?.app) {
      // 没有上下文时，默认满足条件
      return true;
    }

    // 解析配置中的变量引用
    const resolvedConfig = this.resolveVariablesInFileConfig(config, context);

    switch (resolvedConfig.subType) {
      case FileConditionSubType.FileExists:
        return this.evaluateFileExists(resolvedConfig, context);
      case FileConditionSubType.FileStatus:
        return this.evaluateFileStatus(resolvedConfig, context);
      case FileConditionSubType.ContentContains:
        return this.evaluateContentContainsSync(resolvedConfig, context);
      case FileConditionSubType.FrontmatterProperty:
        return this.evaluateFrontmatterProperty(resolvedConfig, context);
      default:
        return true;
    }
  }

  /**
   * 解析文件条件配置中的变量引用
   */
  private static resolveVariablesInFileConfig(
    config: FileConditionConfig,
    context: ExtendedConditionContext
  ): FileConditionConfig {
    const resolvedConfig = { ...config };

    // 解析 targetFilePath
    if (resolvedConfig.targetFilePath) {
      resolvedConfig.targetFilePath = ConditionVariableResolver.resolve(
        resolvedConfig.targetFilePath,
        {
          formConfig: context.formConfig,
          formValues: context.formValues,
        }
      );
    }

    // 解析 searchText
    if (resolvedConfig.searchText) {
      resolvedConfig.searchText = ConditionVariableResolver.resolve(
        resolvedConfig.searchText,
        {
          formConfig: context.formConfig,
          formValues: context.formValues,
        }
      );
    }

    // 解析 propertyValue
    if (resolvedConfig.propertyValue) {
      resolvedConfig.propertyValue = ConditionVariableResolver.resolve(
        resolvedConfig.propertyValue,
        {
          formConfig: context.formConfig,
          formValues: context.formValues,
        }
      );
    }

    // 解析多属性检查中的值
    if (resolvedConfig.properties) {
      resolvedConfig.properties = resolvedConfig.properties.map(prop => ({
        ...prop,
        value: ConditionVariableResolver.resolve(
          prop.value,
          {
            formConfig: context.formConfig,
            formValues: context.formValues,
          }
        ),
      }));
    }

    return resolvedConfig;
  }

  /**
   * 评估文件是否存在
   */
  private static evaluateFileExists(config: FileConditionConfig, context: ExtendedConditionContext): boolean {
    if (config.targetMode !== FileTargetMode.SpecificFile) {
      return true;
    }

    if (!config.targetFilePath) {
      return false;
    }

    const abstractFile = context.app.vault.getAbstractFileByPath(config.targetFilePath);
    const checkType = config.checkType || FileCheckType.File;

    const exists = (() => {
      switch (checkType) {
        case FileCheckType.Folder:
          return abstractFile instanceof TFolder;
        case FileCheckType.FolderHasFiles:
          return abstractFile instanceof TFolder && this.folderHasAnyFile(abstractFile);
        case FileCheckType.File:
        default:
          return abstractFile instanceof TFile;
      }
    })();
    const operator = config.operator || ConditionOperator.Equals;

    switch (operator) {
      case ConditionOperator.Equals:
        return exists;
      case ConditionOperator.NotEquals:
        return !exists;
      default:
        return exists;
    }
  }

  private static folderHasAnyFile(folder: TFolder): boolean {
    const queue: TFolder[] = [folder];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      for (const child of current.children) {
        if (child instanceof TFile) return true;
        if (child instanceof TFolder) queue.push(child);
      }
    }

    return false;
  }

  /**
   * 评估文件状态
   */
  private static evaluateFileStatus(config: FileConditionConfig, context: ExtendedConditionContext): boolean {
    if (config.targetMode !== FileTargetMode.SpecificFile) {
      return true;
    }

    if (!config.targetFilePath) {
      return false;
    }

    const checks = config.fileStatusChecks || [];
    if (checks.length === 0) {
      return true;
    }

    const operator = config.operator || ConditionOperator.Equals;
    let statusMatch = true;

    // 检查文件是否打开
    if (checks.includes(FileStatusCheckType.IsOpen)) {
      const isOpen = this.isFileOpen(context.app, config.targetFilePath);
      if (!isOpen) statusMatch = false;
    }

    // 检查文件是否激活
    if (statusMatch && checks.includes(FileStatusCheckType.IsActive)) {
      const isActive = context.currentFile?.path === config.targetFilePath;
      if (!isActive) statusMatch = false;
    }

    switch (operator) {
      case ConditionOperator.Equals:
        return statusMatch;
      case ConditionOperator.NotEquals:
        return !statusMatch;
      default:
        return statusMatch;
    }
  }

  /**
   * 检查文件是否在编辑器中打开
   */
  private static isFileOpen(app: App, filePath: string): boolean {
    const leaves = app.workspace.getLeavesOfType("markdown");
    return leaves.some((leaf) => {
      // @ts-ignore - 访问 leaf.view.file
      const file = leaf.view?.file;
      return file?.path === filePath;
    });
  }

  /**
   * 评估文件内容包含（同步版本，使用缓存）
   */
  private static evaluateContentContainsSync(config: FileConditionConfig, context: ExtendedConditionContext): boolean {
    if (!config.searchText) {
      return true;
    }

    const targetFile = this.resolveTargetFile(config, context);
    if (!targetFile) {
      return false;
    }

    const operator = config.operator || ConditionOperator.Contains;

    // 使用 metadataCache 获取内容（同步方式）
    // 注意：这只能检查文件的缓存内容，可能不是最新的
    const cache = context.app.metadataCache.getFileCache(targetFile);
    if (!cache) {
      // 如果没有缓存，返回 true（不阻止操作）
      return true;
    }

    // 检查 frontmatter 中是否包含搜索文本
    let contains = false;
    if (cache.frontmatter) {
      const frontmatterStr = JSON.stringify(cache.frontmatter);
      if (frontmatterStr.includes(config.searchText)) {
        contains = true;
      }
    }

    // 根据操作符返回结果
    switch (operator) {
      case ConditionOperator.Contains:
        return contains;
      case ConditionOperator.NotContains:
        return !contains;
      default:
        return contains;
    }
  }

  /**
   * 评估 Frontmatter 属性
   */
  private static evaluateFrontmatterProperty(config: FileConditionConfig, context: ExtendedConditionContext): boolean {
    const targetFile = this.resolveTargetFile(config, context);
    if (!targetFile) {
      return false;
    }

    const cache = context.app.metadataCache.getFileCache(targetFile);
    const frontmatter = cache?.frontmatter;

    if (!frontmatter) {
      return false;
    }

    // 检查多属性配置
    if (config.properties && config.properties.length > 0) {
      return config.properties.every((prop) => {
        const actualValue = frontmatter[prop.name];
        return this.compareValues(actualValue, prop.value, prop.operator);
      });
    }

    // 向后兼容：单属性配置
    if (config.propertyName) {
      const propertyValue = frontmatter[config.propertyName];
      return this.compareValues(propertyValue, config.propertyValue, config.operator);
    }

    return true;
  }

  /**
   * 解析目标文件
   */
  private static resolveTargetFile(config: FileConditionConfig, context: ExtendedConditionContext): TFile | null {
    const targetMode = config.targetMode || FileTargetMode.CurrentFile;

    if (targetMode === FileTargetMode.CurrentFile) {
      return context.currentFile || null;
    }

    if (!config.targetFilePath) {
      return null;
    }

    const abstractFile = context.app.vault.getAbstractFileByPath(config.targetFilePath);
    if (abstractFile instanceof TFile) {
      return abstractFile;
    }

    return null;
  }

  /**
   * 比较值
   */
  private static compareValues(
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

  /**
   * 评估脚本条件（同步版本）
   * 注意：此方法会阻塞执行，仅适用于简单的同步脚本
   * 对于需要异步操作的场景，请使用 evaluateScriptConditionAsync
   */
  private static evaluateScriptConditionSync(
    config: ScriptConditionConfig,
    context?: ExtendedConditionContext
  ): boolean {
    if (!config || !config.expression) {
      // 没有配置表达式，默认满足条件
      return true;
    }

    try {
      // 构建脚本执行上下文
      const scriptContext = {
        app: context?.app,
        currentFile: context?.currentFile,
        formFilePath: context?.formFilePath || context?.formConfig?.formPath,
        formValues: context?.formValues || {},
        formConfig: context?.formConfig,
        // 提供安全的内置对象
        Date,
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        JSON,
        console: {
          log: (...args: any[]) => DebugLogger.debug("[ScriptCondition]", ...args),
          warn: (...args: any[]) => DebugLogger.warn("[ScriptCondition]", ...args),
          error: (...args: any[]) => DebugLogger.error("[ScriptCondition]", ...args),
        },
      };

      // 构建函数体，使用 with 语句提供上下文访问
      const funcBody = `
        with (context) {
          ${config.expression}
        }
      `;

      // 创建并执行函数
      const func = new Function("context", funcBody);
      const result = func(scriptContext);

      // 将结果转换为布尔值
      return Boolean(result);
    } catch (error) {
      DebugLogger.error("[ExtendedConditionEvaluator] 脚本条件评估失败", error);
      // 脚本执行失败时，默认返回 true，不阻止正常操作
      return true;
    }
  }

  /**
   * 异步评估脚本条件
   * 支持 async/await 的脚本表达式
   */
  static async evaluateScriptConditionAsync(
    config: ScriptConditionConfig,
    context?: ExtendedConditionContext
  ): Promise<boolean> {
    if (!config || !config.expression) {
      return true;
    }

    try {
      const scriptContext = {
        app: context?.app,
        currentFile: context?.currentFile,
        formFilePath: context?.formFilePath || context?.formConfig?.formPath,
        formValues: context?.formValues || {},
        formConfig: context?.formConfig,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        JSON,
        console: {
          log: (...args: any[]) => DebugLogger.debug("[ScriptCondition]", ...args),
          warn: (...args: any[]) => DebugLogger.warn("[ScriptCondition]", ...args),
          error: (...args: any[]) => DebugLogger.error("[ScriptCondition]", ...args),
        },
      };

      const funcBody = `
        with (context) {
          ${config.expression}
        }
      `;

      const func = new Function("context", funcBody);
      const result = func(scriptContext);

      // 处理 Promise 结果
      const finalResult = result instanceof Promise ? await result : result;
      return Boolean(finalResult);
    } catch (error) {
      DebugLogger.error("[ExtendedConditionEvaluator] 异步脚本条件评估失败", error);
      return true;
    }
  }
}
