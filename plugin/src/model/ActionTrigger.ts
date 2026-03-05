import { v4 } from "uuid";
import { StartupConditionsConfig } from "./startup-condition/StartupCondition";

/**
 * 动作触发器模型
 * 
 * 允许为表单中的一个或多个动作配置独立的调用入口，
 * 支持通过命令面板、右键菜单、快捷键、启动执行、定时触发等方式单独调用。
 */
export class ActionTrigger {
	/** 触发器唯一标识 */
	id: string;

	/** 触发器显示名称（用于命令名、菜单项） */
	name: string;

	/** 引用的动作 ID 列表（有序，引用 FormConfig.actions 中的动作 ID） */
	actionIds: string[];

	/** 是否注册为 Obsidian 命令 */
	commandEnabled?: boolean;

	/** 稳定的命令 ID（首次生成后不变） */
	commandId?: string;

	/** 是否显示在右键菜单 */
	contextMenuEnabled?: boolean;

	/** 是否在 Obsidian 启动时执行 */
	runOnStartup?: boolean;

	/** 是否启用定时自动触发 */
	autoTriggerEnabled?: boolean;

	/** 启动/自动触发条件配置 */
	startupConditions?: StartupConditionsConfig;

	/** 上次执行时间（毫秒时间戳，用于定时触发冷却） */
	lastExecutionTime?: number;

	constructor(partial?: Partial<ActionTrigger>) {
		this.id = v4();
		this.name = "";
		this.actionIds = [];
		this.commandEnabled = false;
		this.contextMenuEnabled = false;
		this.runOnStartup = false;
		this.autoTriggerEnabled = false;

		if (partial) {
			Object.assign(this, partial);
		}
	}

	/**
	 * 获取或生成命令 ID
	 * @param filePath 表单文件路径，用于生成稳定 ID
	 */
	getOrCreateCommandId(filePath: string): string {
		if (!this.commandId) {
			this.commandId = this.generateCommandId(filePath);
		}
		return this.commandId;
	}

	/**
	 * 生成稳定的命令 ID
	 */
	private generateCommandId(filePath: string): string {
		const timestamp = Date.now();
		const pathHash = this.hashString(filePath).substr(0, 6);
		const random = Math.random().toString(36).substr(2, 4);
		return `${timestamp}-${pathHash}-${random}`;
	}

	/**
	 * 简单的字符串哈希函数
	 */
	private hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(36);
	}

	/**
	 * 检查命令是否启用
	 */
	isCommandEnabled(): boolean {
		return this.commandEnabled === true;
	}

	/**
	 * 检查右键菜单是否启用
	 */
	isContextMenuEnabled(): boolean {
		return this.contextMenuEnabled === true;
	}

	/**
	 * 检查是否启用启动时执行
	 */
	isRunOnStartup(): boolean {
		return this.runOnStartup === true;
	}

	/**
	 * 检查是否启用定时自动触发
	 */
	isAutoTriggerEnabled(): boolean {
		return this.autoTriggerEnabled === true;
	}

	/**
	 * 获取上次执行时间
	 */
	getLastExecutionTime(): number | undefined {
		return this.lastExecutionTime;
	}

	/**
	 * 更新上次执行时间
	 */
	updateLastExecutionTime(): void {
		this.lastExecutionTime = Date.now();
	}

	/**
	 * 从普通对象创建 ActionTrigger 实例
	 */
	static fromJSON(data: any): ActionTrigger {
		if (!data || typeof data !== "object") {
			throw new Error("Invalid ActionTrigger data");
		}
		const trigger = new ActionTrigger();
		Object.assign(trigger, data);
		return trigger;
	}

	/**
	 * 清理无效的动作引用
	 * @param validActionIds 当前表单中有效的动作 ID 集合
	 */
	removeInvalidActionIds(validActionIds: Set<string>): void {
		this.actionIds = this.actionIds.filter(id => validActionIds.has(id));
	}
}
