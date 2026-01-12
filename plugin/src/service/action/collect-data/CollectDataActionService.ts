import { IFormAction } from "src/model/action/IFormAction";
import { CollectDataFormAction } from "src/model/action/CollectDataFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { StorageMode } from "src/model/enums/StorageMode";
import { VariableType } from "src/model/enums/VariableType";
import { ActionChain, ActionContext, IActionService } from "../IActionService";
import { FormTemplateProcessEngine } from "src/service/engine/FormTemplateProcessEngine";
import { DebugLogger } from "src/utils/DebugLogger";
import { localInstance } from "src/i18n/locals";

/**
 * 数据收集动作服务
 * 只能在循环内部使用，用于收集每次迭代的数据到指定变量
 */
export default class CollectDataActionService implements IActionService {

	accept(action: IFormAction, context: ActionContext): boolean {
		return action.type === FormActionType.COLLECT_DATA;
	}

	async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<void> {
		const collectAction = action as CollectDataFormAction;
		const state = context.state;

		try {
			// 1. 验证是否在循环内部
			if (!context.loopContext) {
				throw new Error(localInstance.collect_data_outside_loop_error);
			}

			// 2. 验证必填字段
			if (!collectAction.outputVariableName || !collectAction.outputVariableName.trim()) {
				throw new Error(localInstance.collect_data_variable_name_required);
			}

			// 3. 处理模板变量
			const engine = new FormTemplateProcessEngine();
			const processedContent = await engine.process(
				collectAction.content || "",
				state,
				context.app
			);

			DebugLogger.debug(
				`[CollectData] 处理后的内容: ${processedContent.substring(0, 100)}...`
			);

			// 4. 根据存储模式和变量类型处理数据
			const variableName = collectAction.outputVariableName.trim();
			const currentValue = state.values[variableName];

			if (collectAction.storageMode === StorageMode.APPEND) {
				// 追加模式
				if (collectAction.variableType === VariableType.ARRAY) {
					// 数组类型: 追加元素
					if (currentValue === undefined) {
						state.values[variableName] = [processedContent];
					} else if (Array.isArray(currentValue)) {
						currentValue.push(processedContent);
					} else {
						// 如果现有值不是数组,转换为数组
						state.values[variableName] = [String(currentValue), processedContent];
					}
					DebugLogger.debug(
						`[CollectData] 追加到数组 ${variableName}, 当前长度: ${(state.values[variableName] as any[]).length}`
					);
				} else {
					// 字符串类型: 拼接文本
					if (currentValue === undefined || currentValue === null) {
						state.values[variableName] = processedContent;
					} else {
						// 追加时在已有内容后添加换行符，保持格式
						state.values[variableName] = String(currentValue) + "\n" + processedContent;
					}
					DebugLogger.debug(
						`[CollectData] 追加到字符串 ${variableName}, 当前长度: ${String(state.values[variableName]).length}`
					);
				}
			} else {
				// 替换模式
				if (collectAction.variableType === VariableType.ARRAY) {
					state.values[variableName] = [processedContent];
				} else {
					state.values[variableName] = processedContent;
				}
				DebugLogger.debug(`[CollectData] 替换变量 ${variableName}`);
			}

			// 5. 继续执行下一个动作
			return await chain.next(context);
		} catch (error) {
			DebugLogger.error("[CollectData] 执行失败:", error);
			throw error;
		}
	}
}
