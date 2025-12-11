import { App, TFile } from "obsidian";
import { FormConfig } from "src/model/FormConfig";
import { FormService } from "../FormService";
import { DebugLogger } from "src/utils/DebugLogger";

/**
 * 启动时表单执行服务
 * 负责在 Obsidian 启动完成后自动执行标记为"启动时运行"的表单
 */
export class StartupFormService {
    private static instance: StartupFormService | null = null;
    private app: App;
    private isExecuted: boolean = false;

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
            for (const { file, config } of startupForms) {
                try {
                    DebugLogger.debug(`[StartupFormService] 执行表单: ${file.path}`);
                    // 使用与命令提交相同的逻辑
                    await formService.open(file, this.app);
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
