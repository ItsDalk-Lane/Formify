import { OperatorType } from "./OperatorType";
import type {
	TimeConditionConfig,
	FileConditionConfig,
	SystemConditionConfig,
	ScriptConditionConfig,
} from "../startup-condition/StartupCondition";

export interface Filter {

	id: string;

	type: FilterType

	operator: OperatorType;

	property?: string;

	value?: any;

	conditions: Filter[];

	/**
	 * 扩展条件配置（用于时间条件、文件条件等启动条件类型）
	 * 当 type 为 FilterType.timeCondition 或 FilterType.fileCondition 时使用
	 */
	extendedConfig?: TimeConditionConfig | FileConditionConfig | SystemConditionConfig | ScriptConditionConfig;

}

/**
 * 过滤器类型枚举
 * - group: 条件组，包含多个子条件
 * - filter: 基于表单字段值的条件
 * - jsQuery: JavaScript 表达式条件
 * - timeCondition: 时间条件（扩展类型）
 * - fileCondition: 文件条件（扩展类型）
 */
export enum FilterType {
	group = "group",
	filter = "filter",
	jsQuery = "jsQuery",
	/** 时间条件 */
	timeCondition = "timeCondition",
	/** 文件条件 */
	fileCondition = "fileCondition",
}
