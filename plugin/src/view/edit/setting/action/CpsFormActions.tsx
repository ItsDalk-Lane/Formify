import useSortable from "src/hooks/useSortable";
import { localInstance } from "src/i18n/locals";
import { FormActionFactory } from "src/model/action/FormActionFactory";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { FormConfig } from "src/model/FormConfig";
import { getActionsCompatible } from "src/utils/getActionsCompatible";
import { v4 } from "uuid";
import { NewActionGridPopover } from "./common/new-action-grid/NewActionGridPopover";
import FormVariableQuotePanel from "./common/variable-quoter/FormVariableQuotePanel";
import CpsFormAction from "./CpsFormAction";
import { useState } from "react";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import { useLoopContext } from "src/context/LoopContext";

export function CpsFormActions(props: {
    config: FormConfig;
    onChange: (actions: IFormAction[]) => void;
    selectMode?: boolean;
    onToggleSelectMode?: () => void;
    onSelectAll?: () => void;
    onSelectNone?: () => void;
    onDeleteSelected?: () => void;
    selectedIds?: string[];
    onToggleSelection?: (id: string) => void;
    isInsideLoop?: boolean; // 是否在循环内部，用于控制动作显示（已废弃，使用LoopContext）
    hideVariablePanel?: boolean;
}) {
    const { config } = props;
    const loopContext = useLoopContext();
    const isInsideLoop = loopContext.isInsideLoop;
    const [internalSelectMode, setInternalSelectMode] = useState(false);
    const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);

    const selectMode = props.selectMode ?? internalSelectMode;
    const selectedIds = props.selectedIds ?? internalSelectedIds;
	const saveAction = (action: IFormAction[]) => {
		props.onChange(action);
	};

	const actions = getActionsCompatible(config);
	useSortable({
		items: actions || [],
		getId: (item) => item.id,
		onChange: (orders) => {
			props.onChange(orders);
		},
	});

    const addAction = (type: FormActionType) => {
        const newAction = FormActionFactory.create(type);
        const newActions = [...actions, newAction];
        saveAction(newActions);
    };

    const handleToggleSelectMode = () => {
        if (props.onToggleSelectMode) {
            props.onToggleSelectMode();
        } else {
            setInternalSelectMode(!internalSelectMode);
        }
    };

    const handleToggleSelection = (id: string) => {
        if (props.onToggleSelection) {
            props.onToggleSelection(id);
        } else {
            setInternalSelectedIds(prev => {
                const s = new Set(prev);
                if (s.has(id)) {
                    s.delete(id);
                } else {
                    s.add(id);
                }
                return Array.from(s);
            });
        }
    };

    return (
        <div className="form--CpsFormActionsSetting">
            {!props.hideVariablePanel && <FormVariableQuotePanel formConfig={config} isInsideLoop={isInsideLoop} />}
            {actions.map((action, index) => {
                return (
                    <div key={action.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {selectMode && (
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(action.id)}
                                onChange={() => handleToggleSelection(action.id)}
                            />
                        )}
                        <CpsFormAction
                            value={action}
                            defaultOpen={actions.length === 1}
                            onChange={(v) => {
                                const newActions = actions.map((a) => {
                                    if (v.id === a.id) {
                                        return v;
                                    }
                                    return a;
                                });
                                saveAction(newActions);
                            }}
                            onDelete={(v) => {
                                const newActions = actions.filter((a) => a.id !== v.id);
                                saveAction(newActions);
                            }}
                            onDuplicate={(v) => {
                                const newAction = { ...v, id: v4() };
                                const originIndex = actions.findIndex((a) => a.id === v.id);
                                const newActions = [
                                    ...actions.slice(0, originIndex + 1),
                                    newAction,
                                    ...actions.slice(originIndex + 1),
                                ];
                                saveAction(newActions);
                            }}
                            formConfig={config}
                        />
                    </div>
                );
            })}
            <NewActionGridPopover onSelect={addAction} isInsideLoop={isInsideLoop}>
                <button className="form--AddButton">
                    + {localInstance.add_action}
                </button>
            </NewActionGridPopover>
        </div>
    );
}
