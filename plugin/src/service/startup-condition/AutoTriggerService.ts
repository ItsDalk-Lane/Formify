import { App, Notice, TAbstractFile, TFile } from "obsidian";
import FormPlugin from "src/main";
import { FormConfig } from "src/model/FormConfig";
import { FormService } from "src/service/FormService";
import { getStartupConditionService } from "src/service/startup-condition/StartupConditionService";
import { DebugLogger } from "src/utils/DebugLogger";

interface MonitoredForm {
  filePath: string;
  config: FormConfig;
  isRunning: boolean;
}

/**
 * 启动条件自动触发服务
 * 
 * - 监听 .cform 文件变化，自动注册/注销需要监控的表单
 * - 定时评估启动条件，满足时自动执行表单
 * - 执行成功后写回 lastExecutionTime，避免重复触发
 */
export class AutoTriggerService {
  private plugin: FormPlugin | null = null;
  private app: App | null = null;
  private formService: FormService | null = null;

  private isInitialized = false;
  private intervalId: number | null = null;

  private readonly monitoredForms: Map<string, MonitoredForm> = new Map();

  /** 默认每分钟评估一次 */
  private readonly evaluationIntervalMs = 60_000;

  /** 自动触发的最小冷却时间（避免条件一直为真导致每分钟重复执行） */
  private readonly minAutoCooldownMs = 60_000;

  async initialize(plugin: FormPlugin, formService: FormService, force = false): Promise<void> {
    this.plugin = plugin;
    this.app = plugin.app;
    this.formService = formService;

    if (!force && this.isInitialized) {
      return;
    }

    this.cleanup();

    await this.scanAndRegisterForms();
    this.registerFileWatchers();
    this.startTimer();

    this.isInitialized = true;
  }

  cleanup(): void {
    this.stopTimer();
    this.monitoredForms.clear();
    this.isInitialized = false;
  }

  private startTimer(): void {
    if (!this.app || this.intervalId !== null) {
      return;
    }

    // 先延迟一小段时间再开始第一次评估，避免布局未就绪导致误判
    window.setTimeout(() => {
      void this.evaluateAllOnce();
    }, 2_000);

    this.intervalId = window.setInterval(() => {
      void this.evaluateAllOnce();
    }, this.evaluationIntervalMs);
  }

  private stopTimer(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private registerFileWatchers(): void {
    if (!this.plugin || !this.app) {
      return;
    }

    const vault = this.app.vault;

    this.plugin.registerEvent(
      vault.on("create", async (file) => {
        if (this.isValidFormFile(file)) {
          await this.handleFileUpsert(file.path);
        }
      })
    );

    this.plugin.registerEvent(
      vault.on("modify", async (file) => {
        if (this.isValidFormFile(file)) {
          await this.handleFileUpsert(file.path);
        }
      })
    );

    this.plugin.registerEvent(
      vault.on("delete", async (file) => {
        if (this.isValidFormFile(file)) {
          this.unregister(file.path);
        }
      })
    );

    this.plugin.registerEvent(
      vault.on("rename", async (file, oldPath) => {
        // 旧路径是 .cform 才需要处理注销
        if (oldPath.endsWith(".cform")) {
          this.unregister(oldPath);
        }

        if (this.isValidFormFile(file)) {
          await this.handleFileUpsert(file.path);
        }
      })
    );
  }

  private isValidFormFile(file: TAbstractFile): file is TFile {
    return file instanceof TFile && file.extension === "cform";
  }

  private async scanAndRegisterForms(): Promise<void> {
    if (!this.app) {
      return;
    }

    const formFiles = this.app.vault.getFiles().filter((f) => f.extension === "cform");

    for (const file of formFiles) {
      await this.handleFileUpsert(file.path);
    }
  }

  private async handleFileUpsert(filePath: string): Promise<void> {
    if (!this.app) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      this.unregister(filePath);
      return;
    }

    const config = await this.readFormConfig(file);
    if (!config) {
      this.unregister(filePath);
      return;
    }

    if (!this.shouldMonitor(config)) {
      this.unregister(filePath);
      return;
    }

    this.register(filePath, config);
  }

  private register(filePath: string, config: FormConfig): void {
    const existing = this.monitoredForms.get(filePath);
    if (existing) {
      existing.config = config;
      return;
    }

    this.monitoredForms.set(filePath, {
      filePath,
      config,
      isRunning: false,
    });
  }

  private unregister(filePath: string): void {
    this.monitoredForms.delete(filePath);
  }

  private shouldMonitor(config: FormConfig): boolean {
    // 检查是否配置了启动条件且启用
    if (!config.hasStartupConditions()) {
      return false;
    }

    // 检查是否有 autoTrigger 类别的条件（没有 category 字段的默认为 startup）
    const hasAutoTrigger = config.startupConditions!.conditions.some(
      (c) => c.category === "autoTrigger"
    );

    return hasAutoTrigger;
  }

  private async evaluateAllOnce(): Promise<void> {
    if (!this.app || !this.formService) {
      return;
    }

    const filePaths = Array.from(this.monitoredForms.keys()).sort((a, b) => a.localeCompare(b));

    for (const filePath of filePaths) {
      const monitored = this.monitoredForms.get(filePath);
      if (!monitored) {
        continue;
      }

      try {
        await this.evaluateAndMaybeExecute(monitored);
      } catch (error) {
        DebugLogger.error(`[AutoTriggerService] 评估/执行失败: ${filePath}`, error);
        // 单个表单异常不影响其他表单
      }
    }
  }

  private async evaluateAndMaybeExecute(monitored: MonitoredForm): Promise<void> {
    if (!this.app || !this.formService || !this.plugin) {
      return;
    }

    if (monitored.isRunning) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(monitored.filePath);
    if (!file || !(file instanceof TFile)) {
      this.unregister(monitored.filePath);
      return;
    }

    // 冷却：避免条件一直为真导致每分钟重复触发
    const lastExecutionTime = monitored.config.getLastExecutionTime();
    if (lastExecutionTime && Date.now() - lastExecutionTime < this.minAutoCooldownMs) {
      return;
    }

    const conditionService = getStartupConditionService();

    const context = {
      app: this.app,
      currentFile: this.app.workspace.getActiveFile(),
      formFilePath: monitored.filePath,
      lastExecutionTime: monitored.config.getLastExecutionTime(),
      pluginVersion: this.plugin.manifest.version,
      formConfig: monitored.config,
    };

    const firstResult = await conditionService.evaluateConditions(
      monitored.config.getStartupConditions(),
      context,
      "autoTrigger"
    );
    if (!firstResult.satisfied) {
      return;
    }

    // 执行前再次确认，避免并发/状态变化
    const secondResult = await conditionService.evaluateConditions(
      monitored.config.getStartupConditions(),
      context,
      "autoTrigger"
    );
    if (!secondResult.satisfied) {
      return;
    }

    monitored.isRunning = true;

    try {
      const formName = file.basename;
      new Notice(`已自动执行表单「${formName}」：${secondResult.details}`);

      await this.formService.submitDirectly(monitored.config, this.app);

      // submitDirectly 会在 finally 更新 lastExecutionTime（当 hasStartupConditions 时）
      // 这里将 lastExecutionTime 写回文件，确保持久化、避免重启后重复触发
      await this.persistLastExecutionTime(file, monitored.config);
    } finally {
      monitored.isRunning = false;
    }
  }

  private async readFormConfig(file: TFile): Promise<FormConfig | null> {
    if (!this.app) {
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || !parsed?.id) {
        return null;
      }

      const config = FormConfig.fromJSON(parsed);
      // 补齐文件路径（部分流程依赖）
      (config as any).filePath = file.path;
      return config;
    } catch (error) {
      DebugLogger.warn(`[AutoTriggerService] 读取表单配置失败: ${file.path}`);
      DebugLogger.debug(String(error));
      return null;
    }
  }

  private async persistLastExecutionTime(file: TFile, config: FormConfig): Promise<void> {
    if (!this.app) {
      return;
    }

    try {
      const content = await this.app.vault.read(file);
      const parsed = JSON.parse(content);

      // 只写回 lastExecutionTime，尽量避免覆盖其他并发编辑
      parsed.lastExecutionTime = config.getLastExecutionTime() ?? Date.now();

      await this.app.vault.modify(file, JSON.stringify(parsed, null, 2));
    } catch (error) {
      DebugLogger.warn(`[AutoTriggerService] 写回 lastExecutionTime 失败: ${file.path}`);
      DebugLogger.debug(String(error));
    }
  }
}
