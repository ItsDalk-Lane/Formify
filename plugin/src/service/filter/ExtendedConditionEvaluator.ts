/**
 * 扩展条件评估器
 * 用于评估时间条件和文件条件
 */
import { App, TFile } from "obsidian";
import { Filter, FilterType } from "src/model/filter/Filter";
import {
  TimeConditionSubType,
  FileConditionSubType,
  FileTargetMode,
  FileStatusCheckType,
  ConditionOperator,
} from "src/model/startup-condition/StartupCondition";
import type {
  TimeConditionConfig,
  FileConditionConfig,
} from "src/model/startup-condition/StartupCondition";
import { DebugLogger } from "src/utils/DebugLogger";

/**
 * 扩展条件评估上下文
 */
export interface ExtendedConditionContext {
  /** Obsidian App 实例 */
  app: App;
  /** 当前文件 */
  currentFile?: TFile | null;
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

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // 跨午夜的情况
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
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
    return config.daysOfWeek.includes(currentDay);
  }

  /**
   * 评估日期范围
   */
  private static evaluateDateRange(config: TimeConditionConfig, now: Date): boolean {
    const today = now.toISOString().split("T")[0];

    if (config.startDate && today < config.startDate) {
      return false;
    }

    if (config.endDate && today > config.endDate) {
      return false;
    }

    return true;
  }

  /**
   * 评估文件条件
   */
  private static evaluateFileCondition(config: FileConditionConfig, context?: ExtendedConditionContext): boolean {
    if (!context?.app) {
      // 没有上下文时，默认满足条件
      return true;
    }

    switch (config.subType) {
      case FileConditionSubType.FileExists:
        return this.evaluateFileExists(config, context);
      case FileConditionSubType.FileStatus:
        return this.evaluateFileStatus(config, context);
      case FileConditionSubType.ContentContains:
        return this.evaluateContentContainsSync(config, context);
      case FileConditionSubType.FrontmatterProperty:
        return this.evaluateFrontmatterProperty(config, context);
      default:
        return true;
    }
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
    return abstractFile instanceof TFile;
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

    // 检查文件是否打开
    if (checks.includes(FileStatusCheckType.IsOpen)) {
      const isOpen = this.isFileOpen(context.app, config.targetFilePath);
      if (!isOpen) return false;
    }

    // 检查文件是否激活
    if (checks.includes(FileStatusCheckType.IsActive)) {
      const isActive = context.currentFile?.path === config.targetFilePath;
      if (!isActive) return false;
    }

    return true;
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

    // 使用 metadataCache 获取内容（同步方式）
    // 注意：这只能检查文件的缓存内容，可能不是最新的
    const cache = context.app.metadataCache.getFileCache(targetFile);
    if (!cache) {
      // 如果没有缓存，返回 true（不阻止操作）
      return true;
    }

    // 检查 frontmatter 中是否包含搜索文本
    if (cache.frontmatter) {
      const frontmatterStr = JSON.stringify(cache.frontmatter);
      if (frontmatterStr.includes(config.searchText)) {
        return true;
      }
    }

    // 由于同步方式无法读取完整文件内容，这里返回 true
    // 完整的内容检查需要异步操作，在这种情况下我们选择不阻止操作
    DebugLogger.debug("[ExtendedConditionEvaluator] 内容检查需要异步操作，返回 true");
    return true;
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
}
