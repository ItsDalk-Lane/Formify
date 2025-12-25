import { App, TFile } from "obsidian";
import { FormConfig } from "src/model/FormConfig";
import { FormService } from "../FormService";
import { DebugLogger } from "src/utils/DebugLogger";
import { getStartupConditionService, ConditionEvaluationContext } from "../startup-condition/StartupConditionService";

/**
 * 启动时表单执行服务
 * 负责在 Obsidian 启动完成后自动执行标记为"启动时运行"的表单
 */
export class StartupFormService {
    private static instance: StartupFormService | null = null;
    private app: App;
    private isExecuted: boolean = false;
    private pluginVersion: string = "";

    private constructor(app: App) {
        this.app = app;
    }

    /**
     * 获取单例实例
     */
    static getInstance(app: App): StartupFormService {
        if (!StartupFormService.instance) {
            StartupFormService.instance = new StartupFormService(app);
        }
        return StartupFormService.instance;
    }

    /**
     * 设置插件版本（用于条件评估）
     */
    setPluginVersion(version: string): void {
        this.pluginVersion = version;
    }

    /**
     * 执行所有标记为启动时运行的表单
     * 确保每次 Obsidian 启动只执行一次
     */
    async executeStartupForms(): Promise<void> {
        // 防止重复执行
        if (this.isExecuted) {
            DebugLogger.debug('[StartupFormService] 启动表单已执行，跳过重复执行');
            return;
        }

        this.isExecuted = true;

        try {
            // 获取所有 .cform 文件
            const formFiles = this.app.vault.getFiles()
                .filter(file => file.extension === 'cform');

            DebugLogger.debug(`[StartupFormService] 找到 ${formFiles.length} 个表单文件`);

            // 收集需要启动时运行的表单
            const startupForms: { file: TFile; config: FormConfig }[] = [];

            for (const file of formFiles) {
                try {
                    const config = await this.readFormConfig(file);
                    if (config && config.runOnStartup === true) {
                        startupForms.push({ file, config });
                        DebugLogger.debug(`[StartupFormService] 发现启动时运行表单: ${file.path}`);
                    }
                } catch (error) {
                    DebugLogger.warn(`[StartupFormService] 读取表单配置失败: ${file.path}`, error);
                }
            }

            if (startupForms.length === 0) {
                DebugLogger.debug('[StartupFormService] 没有需要启动时运行的表单');
                return;
            }

            DebugLogger.info(`[StartupFormService] 开始执行 ${startupForms.length} 个启动时运行表单`);

            // 依次执行启动时运行的表单
            const formService = new FormService();
            const conditionService = getStartupConditionService();

            for (const { file, config } of startupForms) {
                try {
                    // 评估启动条件
                    const conditionResult = await this.evaluateStartupConditions(file, config, conditionService);
                    
                    if (!conditionResult.satisfied) {
                        DebugLogger.debug(
                            `[StartupFormService] 表单 ${file.path} 的启动条件不满足，跳过执行。原因: ${conditionResult.details}`
                        );
                        continue;
                    }

                    DebugLogger.debug(`[StartupFormService] 执行表单: ${file.path}`);
                    // 使用与命令提交相同的逻辑
                    await formService.open(file, this.app);
                    
                    // 更新执行时间
                    await this.updateLastExecutionTime(file, config);
                } catch (error) {
                    DebugLogger.error(`[StartupFormService] 执行表单失败: ${file.path}`, error);
                    // 单个表单执行失败不影响其他表单
                }
            }

            DebugLogger.info('[StartupFormService] 启动时运行表单执行完成');
        } catch (error) {
            DebugLogger.error('[StartupFormService] 执行启动表单时发生错误', error);
        }
    }

    /**
     * 评估表单的启动条件
     */
    private async evaluateStartupConditions(
        file: TFile,
        config: FormConfig,
        conditionService: ReturnType<typeof getStartupConditionService>
    ): Promise<{ satisfied: boolean; details: string }> {
        // 如果没有配置启动条件，默认满足
        if (!config.hasStartupConditions()) {
            return { satisfied: true, details: "未配置启动条件，默认执行" };
        }

        try {
            // 构建评估上下文
            const context: ConditionEvaluationContext = {
                app: this.app,
                currentFile: this.app.workspace.getActiveFile(),
                formFilePath: file.path,
                lastExecutionTime: config.getLastExecutionTime(),
                pluginVersion: this.pluginVersion,
            };

            // 评估条件
            const result = await conditionService.evaluateConditions(
                config.getStartupConditions(),
                context
            );

            return {
                satisfied: result.satisfied,
                details: result.details,
            };
        } catch (error) {
            DebugLogger.error(`[StartupFormService] 评估启动条件时发生错误: ${file.path}`, error);
            // 条件评估失败时，为了安全起见，不执行表单
            return {
                satisfied: false,
                details: `条件评估失败: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * 更新表单的上次执行时间
     */
    private async updateLastExecutionTime(file: TFile, config: FormConfig): Promise<void> {
        try {
            config.updateLastExecutionTime();
            const configData = JSON.stringify(config, null, 2);
            await this.app.vault.modify(file, configData);
            DebugLogger.debug(`[StartupFormService] 已更新表单 ${file.path} 的执行时间`);
        } catch (error) {
            DebugLogger.warn(`[StartupFormService] 更新执行时间失败: ${file.path}`, error);
        }
    }

    /**
     * 读取表单配置
     */
    private async readFormConfig(file: TFile): Promise<FormConfig | null> {
        try {
            const configData = await this.app.vault.read(file);
            const config = JSON.parse(configData);

            if (typeof config === 'object' && config.id) {
                const formConfig = Object.assign(new FormConfig(config.id), config);
                return formConfig;
            }

            return null;
        } catch (error) {
            DebugLogger.warn(`[StartupFormService] 解析表单配置失败: ${file.path}`, error);
            return null;
        }
    }

    /**
     * 重置执行状态（用于测试或特殊情况）
     */
    reset(): void {
        this.isExecuted = false;
    }
}

// 导出单例获取函数
export function getStartupFormService(app: App): StartupFormService {
    return StartupFormService.getInstance(app);
}
