import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";
import { StorageMode } from "../enums/StorageMode";
import { VariableType } from "../enums/VariableType";

/**
 * 数据收集动作
 * 只能在循环内部使用，用于收集每次迭代的数据
 */
export class CollectDataFormAction extends BaseFormAction {
	type: FormActionType.COLLECT_DATA;

	/**
	 * 输出变量名称
	 */
	outputVariableName: string;

	/**
	 * 要收集的内容（支持模板变量）
	 */
	content: string;

	/**
	 * 存储模式：追加或替换
	 */
	storageMode: StorageMode;

	/**
	 * 变量类型：字符串或数组
	 */
	variableType: VariableType;

	constructor(partial?: Partial<CollectDataFormAction>) {
		super(partial);
		this.type = FormActionType.COLLECT_DATA;
		this.outputVariableName = "";
		this.content = "";
		this.storageMode = StorageMode.APPEND;
		this.variableType = VariableType.STRING;
		Object.assign(this, partial);
	}
}
