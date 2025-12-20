import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { FormConfig } from "src/model/FormConfig";
import { LoopType } from "src/model/enums/LoopType";
import { LoopVariableMeta } from "src/utils/LoopVariableScope";
import { CpsFormActions } from "../CpsFormActions";
import { LoopProvider } from "src/context/LoopContext";

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

export function NestedActionsEditor(props: {
	loopAction: LoopFormAction;
	formConfig: FormConfig;
	actions: IFormAction[];
	onActionsChange: (actions: IFormAction[]) => void;
}) {
	const { loopAction, formConfig, actions, onActionsChange } = props;

	const nestedConfig = new FormConfig(formConfig.id);
	nestedConfig.fields = formConfig.fields;
	nestedConfig.actions = actions;
	nestedConfig.actionGroups = formConfig.actionGroups;

	// 根据循环类型获取所有应该显示的循环变量
	const loopVariableMetas = getLoopVariablesByType(loopAction.loopType);

	// 将变量名映射到用户自定义的变量名
	const loopVariables = loopVariableMetas.map(meta => {
		switch (meta.name) {
			case "item":
				return loopAction.itemVariableName || "item";
			case "index":
				return loopAction.indexVariableName || "index";
			case "total":
				return loopAction.totalVariableName || "total";
			case "iteration":
				return "iteration";
			case "currentPage":
				return "currentPage";
			case "pageSize":
				return "pageSize";
			case "totalPage":
				return "totalPage";
			default:
				return meta.name;
		}
	});

	const loopContextValue = {
		isInsideLoop: true,
		loopVariables,
		loopType: loopAction.loopType
	};

	return (
		<div className="form--LoopNestedActions">
			<div className="form--LoopNestedActionsHeader">
				<div className="form--LoopNestedActionsTitle">
					{localInstance.loop_nested_actions}
				</div>
			</div>

			<LoopProvider value={loopContextValue}>
				<CpsFormActions config={nestedConfig} onChange={onActionsChange} />
			</LoopProvider>
		</div>
	);
}

