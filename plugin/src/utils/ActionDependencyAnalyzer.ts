import { IFormAction } from "src/model/action/IFormAction";
import { IFormField } from "src/model/field/IFormField";
import { Filter } from "src/model/filter/Filter";

/**
 * 动作依赖分析结果
 */
export interface DependencyValidationResult {
	valid: boolean;
	/** 缺失的 output 变量名及其产出动作 ID */
	missingOutputs: string[];
}

/**
 * 动作依赖分析工具
 * 
 * 通过解析动作模板中的变量引用来分析依赖关系：
 * - `{{@fieldId}}` / `{{@fieldLabel}}` — 引用表单字段值
 * - `{{output:varName}}` — 引用其他动作的输出变量
 */
export class ActionDependencyAnalyzer {

	/** 匹配 {{@fieldId}} 模式 */
	private static readonly FIELD_REF_REGEX = /\{\{@([^}]+)\}\}/g;

	/** 匹配 {{output:varName}} 模式 */
	private static readonly OUTPUT_REF_REGEX = /\{\{output:([^}]+)\}\}/g;

	/** 提取对象中的 {{@...}} 字段引用 */
	private static collectTemplateFieldRefs(target: unknown, refs: Set<string>): void {
		const jsonStr = typeof target === "string" ? target : JSON.stringify(target);
		let match: RegExpExecArray | null;
		const regex = new RegExp(this.FIELD_REF_REGEX.source, "g");
		while ((match = regex.exec(jsonStr)) !== null) {
			const ref = match[1]?.trim();
			if (ref) {
				refs.add(ref);
			}
		}
	}

	/** 从条件树中提取字段依赖（property + 条件值中的 {{@...}}） */
	private static collectConditionFieldRefs(condition: Filter | null | undefined, refs: Set<string>): void {
		if (!condition) {
			return;
		}

		const stack: Filter[] = [condition];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) {
				continue;
			}

			const property = typeof current.property === "string" ? current.property.trim() : "";
			if (property) {
				refs.add(property);
			}

			if (current.value !== undefined) {
				this.collectTemplateFieldRefs(current.value, refs);
			}

			if (current.extendedConfig !== undefined) {
				this.collectTemplateFieldRefs(current.extendedConfig, refs);
			}

			if (Array.isArray(current.conditions) && current.conditions.length > 0) {
				for (const child of current.conditions) {
					if (child) {
						stack.push(child);
					}
				}
			}
		}
	}

	private static resolveFieldIds(refNames: Set<string>, allFields: IFormField[]): Set<string> {
		const ids = new Set<string>();
		const fieldById = new Map(allFields.map((f) => [f.id, f]));
		const fieldByLabel = new Map(allFields.map((f) => [f.label, f]));

		for (const refName of refNames) {
			const key = refName?.trim();
			if (!key) {
				continue;
			}

			if (fieldById.has(key)) {
				ids.add(key);
			}

			const byLabel = fieldByLabel.get(key);
			if (byLabel) {
				ids.add(byLabel.id);
			}
		}

		return ids;
	}

	/**
	 * 获取动作列表中引用的字段名集合（可能是字段 id 或 label）
	 */
	static getReferencedFieldIds(actions: IFormAction[]): Set<string> {
		const refs = new Set<string>();
		this.collectTemplateFieldRefs(actions, refs);
		return refs;
	}

	/**
	 * 获取动作列表引用的 output 变量名
	 */
	static getRequiredOutputVariables(actions: IFormAction[]): Set<string> {
		const outputVars = new Set<string>();
		const jsonStr = JSON.stringify(actions);

		let match: RegExpExecArray | null;
		const regex = new RegExp(this.OUTPUT_REF_REGEX.source, "g");
		while ((match = regex.exec(jsonStr)) !== null) {
			outputVars.add(match[1]);
		}

		return outputVars;
	}

	/**
	 * 获取动作列表产出的 output 变量名
	 * 通过检查具有 outputVariableName 字段的动作来提取
	 */
	static getProducedOutputVariables(actions: IFormAction[]): Set<string> {
		const produced = new Set<string>();

		for (const action of actions) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const outputVarName = (action as any).outputVariableName;
			if (typeof outputVarName === "string" && outputVarName.trim()) {
				produced.add(outputVarName.trim());
			}
		}

		return produced;
	}

	/**
	 * 验证选中动作的输出变量依赖完整性
	 * 
	 * @param selectedActions 触发器选中的动作列表
	 * @returns 验证结果，包含缺失的 output 变量名
	 */
	static validateOutputDependencies(selectedActions: IFormAction[]): DependencyValidationResult {
		const required = this.getRequiredOutputVariables(selectedActions);
		const produced = this.getProducedOutputVariables(selectedActions);

		const missingOutputs: string[] = [];
		for (const varName of required) {
			if (!produced.has(varName)) {
				missingOutputs.push(varName);
			}
		}

		return {
			valid: missingOutputs.length === 0,
			missingOutputs,
		};
	}

	/**
	 * 获取动作执行条件中引用的字段（property + 模板变量）
	 */
	static getActionConditionReferencedFieldIds(actions: IFormAction[]): Set<string> {
		const refs = new Set<string>();
		for (const action of actions) {
			this.collectConditionFieldRefs(action.condition as Filter | undefined, refs);
		}
		return refs;
	}

	/**
	 * 获取字段显示条件中引用的字段（property + 模板变量）
	 */
	static getFieldConditionReferencedFieldIds(fields: IFormField[]): Set<string> {
		const refs = new Set<string>();
		for (const field of fields) {
			this.collectConditionFieldRefs(field.condition as Filter | undefined, refs);
		}
		return refs;
	}

	/**
	 * 获取动作列表需要的字段（过滤后仅返回被引用的字段）
	 * 
	 * @param actions 动作列表
	 * @param allFields 表单中的所有字段
	 * @returns 被引用的字段列表（保持原序）
	 */
	static getReferencedFields(actions: IFormAction[], allFields: IFormField[]): IFormField[] {
		const referencedIds = this.getReferencedFieldIds(actions);
		const referencedLabels = this.getReferencedFieldLabels(actions);

		return allFields.filter(
			field => referencedIds.has(field.id) || referencedLabels.has(field.label)
		);
	}

	/**
	 * 获取触发器动作执行所需字段（带条件依赖闭包）
	 *
	 * 包含：
	 * - 动作模板引用字段
	 * - 动作执行条件引用字段
	 * - 上述字段的显示条件依赖（递归闭包）
	 */
	static getReferencedFieldsWithConditionClosure(actions: IFormAction[], allFields: IFormField[]): IFormField[] {
		const directRefs = new Set<string>();
		const templateRefs = this.getReferencedFieldIds(actions);
		const actionConditionRefs = this.getActionConditionReferencedFieldIds(actions);
		for (const ref of templateRefs) {
			directRefs.add(ref);
		}
		for (const ref of actionConditionRefs) {
			directRefs.add(ref);
		}

		const includedFieldIds = this.resolveFieldIds(directRefs, allFields);
		const fieldById = new Map(allFields.map((f) => [f.id, f]));
		const queue = Array.from(includedFieldIds);

		while (queue.length > 0) {
			const fieldId = queue.shift();
			if (!fieldId) {
				continue;
			}
			const field = fieldById.get(fieldId);
			if (!field?.condition) {
				continue;
			}

			const conditionRefs = new Set<string>();
			this.collectConditionFieldRefs(field.condition as Filter | undefined, conditionRefs);
			const conditionFieldIds = this.resolveFieldIds(conditionRefs, allFields);
			for (const depId of conditionFieldIds) {
				if (!includedFieldIds.has(depId)) {
					includedFieldIds.add(depId);
					queue.push(depId);
				}
			}
		}

		return allFields.filter((field) => includedFieldIds.has(field.id));
	}

	/**
	 * 获取通过字段 label 引用的字段名集合
	 * 匹配 {{@fieldLabel}} 模式中 fieldLabel 可能是字段的 label 而非 id
	 */
	private static getReferencedFieldLabels(actions: IFormAction[]): Set<string> {
		// fieldId 和 fieldLabel 使用相同的 {{@...}} 语法
		// 返回的集合包含所有引用的名称，由调用方判断是 id 还是 label
		return this.getReferencedFieldIds(actions);
	}
}
