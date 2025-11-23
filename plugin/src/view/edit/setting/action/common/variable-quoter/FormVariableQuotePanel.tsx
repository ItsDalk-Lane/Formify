import { ChevronsUpDown } from "lucide-react";
import { Notice } from "obsidian";
import { DropdownMenu } from "src/component/dropdown";
import { localInstance } from "src/i18n/locals";
import { GenerateFormAction } from "src/model/action/OpenFormAction";
import { SuggestModalFormAction } from "src/model/action/SuggestModalFormAction";
import { FormConfig } from "src/model/FormConfig";
import { FormActionType } from "src/model/enums/FormActionType";
import { LoopType } from "src/model/enums/LoopType";
import { AIFormAction } from "src/model/action/AIFormAction";
import { Objects } from "src/utils/Objects";
import { LoopVariableScope, LoopVariableMeta } from "src/utils/LoopVariableScope";
import { useLoopContext } from "src/contexts/LoopContext";
import "./FormVariableQuotePanel.css";
import InternalVariablePopover from "./InternalVariablePopover";

export default function (props: {
    formConfig: FormConfig;
    isInsideLoop?: boolean; // 是否在循环内部，用于控制是否显示循环变量
}) {
    const loopContext = useLoopContext();
    const actualLoopType = loopContext.isInsideLoop ? loopContext.loopType : undefined;

    /**
     * 根据循环类型获取对应的循环变量列表（从 useVariablesWithLoop.tsx 复制）
     */
    function getLoopVariablesByType(loopType?: LoopType): LoopVariableMeta[] {
        // 基础变量：所有循环类型都有
        const baseVars: LoopVariableMeta[] = [
            { name: "index", description: "当前循环索引（从0开始）", isStandard: true },
            { name: "iteration", description: "当前迭代次数（从1开始）", isStandard: true }
        ];

        if (!loopType) {
            // 如果没有指定循环类型，返回基础变量
            return baseVars;
        }

        switch (loopType) {
            case LoopType.LIST:
                // 列表循环：item, index, total, iteration
                return [
                    { name: "item", description: "当前循环元素", isStandard: true },
                    ...baseVars,
                    { name: "total", description: "循环总次数", isStandard: true }
                ];

            case LoopType.CONDITION:
                // 条件循环：只有 index, iteration（不包含item和total，因为它们在条件循环中无意义）
                return baseVars;

            case LoopType.COUNT:
                // 计数循环：item, index, total, iteration
                return [
                    { name: "item", description: "当前计数值", isStandard: true },
                    ...baseVars,
                    { name: "total", description: "计数目标值", isStandard: true }
                ];

            case LoopType.PAGINATION:
                // 分页循环：item, index, total, iteration, currentPage, pageSize, totalPage
                return [
                    { name: "item", description: "当前页数据项", isStandard: true },
                    ...baseVars,
                    { name: "total", description: "总数据条数", isStandard: true },
                    { name: "currentPage", description: "当前页码（从1开始）", isStandard: true },
                    { name: "pageSize", description: "每页大小", isStandard: true },
                    { name: "totalPage", description: "总页数", isStandard: true }
                ];

            default:
                // 未知循环类型，返回基础变量
                return baseVars;
        }
    }
	const fields = props.formConfig.fields || [];
	const actions = props.formConfig.actions || [];

	// 收集所有字段变量，包括从动态动作中生成的字段
	const allFields = (fields || []).map((f) => {
		return {
			label: f.label,
			info: f.description,
			type: "variable",
		};
	});

	// 遍历所有动作，收集动态生成的字段
	actions.forEach((action) => {
		if (action.type === FormActionType.SUGGEST_MODAL) {
			const a = action as SuggestModalFormAction;
			if (a.fieldName && !allFields.find((f) => f.label === a.fieldName)) {
				allFields.push({
					label: a.fieldName,
					info: "",
					type: "variable",
				});
			}
		}

		if (action.type === FormActionType.GENERATE_FORM) {
			const a = action as GenerateFormAction;
			const afields = a.fields || [];
			afields.forEach((f) => {
				if (!allFields.find((ff) => ff.label === f.label)) {
					allFields.push({
						label: f.label,
						info: f.description,
						type: "variable",
					});
				}
			});
		}
	});

	// 收集表单字段变量
	const fieldNames = allFields
		.map((f) => f.label)
		.filter((l) => Objects.exists(l) && l !== "")
		.reduce((acc, l) => {
			// distinct
			if (!acc.includes(l)) {
				acc.push(l);
			}
			return acc;
		}, [] as string[])
		.map((f) => {
			return {
				label: f,
				value: `field_${f}`,
				data: { type: 'field', name: f }
			};
		});

	// 收集 AI 动作的输出变量
	const outputVariables = actions
		.filter((action) => action.type === FormActionType.AI)
		.map((action) => action as AIFormAction)
		.filter((aiAction) => aiAction.outputVariableName && aiAction.outputVariableName.trim() !== "")
		.map((aiAction) => {
			return {
				label: `output:${aiAction.outputVariableName}`,
				value: `output_${aiAction.outputVariableName}`,
				data: { type: 'output', name: aiAction.outputVariableName! }
			};
		});

	// 收集循环变量（仅在循环内部显示）
	let loopVariables: any[] = [];
	if (props.isInsideLoop) {
		let loopVars: LoopVariableMeta[] = [];

		if (LoopVariableScope.isInsideLoop()) {
			// 运行时：从实际作用域获取
			loopVars = LoopVariableScope.getAvailableVariables();
		} else {
			// 编辑时：根据循环类型提供模拟数据用于显示
			loopVars = getLoopVariablesByType(actualLoopType);
		}

		loopVariables = loopVars.map((meta: LoopVariableMeta) => ({
			label: meta.name,
			value: `loop_${meta.name}`,
			data: {
				type: 'loop',
				name: meta.name,
				description: meta.description || '循环变量'
			}
		}));
	}

	// 合并所有变量
	const allVariables = [...fieldNames, ...outputVariables, ...loopVariables];

	const copyVariable = (item: any) => {
		if (!item.data) return;

		const { type, name } = item.data;
		let variableText: string;

		switch (type) {
			case 'output':
				variableText = `{{output:${name}}}`;
				break;
			case 'loop':
				variableText = `{{${name}}}`;
				break;
			case 'field':
			default:
				variableText = `{{@${name}}}`;
				break;
		}

		navigator.clipboard.writeText(variableText).then(
			() => {
				new Notice(localInstance.copy_success);
			},
			() => {
				new Notice(localInstance.copy_failed);
			}
		);
	};

	const copyInnerVariable = (fieldName: string) => {
		navigator.clipboard.writeText(fieldName).then(
			() => {
				new Notice(localInstance.copy_success);
			},
			() => {
				new Notice(localInstance.copy_failed);
			}
		);
	};
	return (
		<div className="form--FormVariableQuotePanel ">
			<span className="form--CpsFormDescription">
				{localInstance.form_variable_usage}
			</span>
			<div className="form--FormVariables">
				<DropdownMenu
					menuLabel={localInstance.form_variables}
					menuIcon={<ChevronsUpDown size={16} />}
					items={allVariables}
					onSelect={(item, e) => {
						copyVariable(item);
					}}
				/>
				<span> | </span>
				<InternalVariablePopover
					onSelect={(value) => {
						copyInnerVariable(value);
					}}
				/>
			</div>
		</div>
	);
}
