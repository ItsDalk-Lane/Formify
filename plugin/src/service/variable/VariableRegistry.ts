import { FormConfig } from "src/model/FormConfig";
import { FormActionType } from "src/model/enums/FormActionType";
import { GenerateFormAction } from "src/model/action/OpenFormAction";
import { SuggestModalFormAction } from "src/model/action/SuggestModalFormAction";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { AIFormAction } from "src/model/action/AIFormAction";
import { VariableCollectOptions, VariableInfo, VariableSource } from "src/types/variable";
import { IFormAction } from "src/model/action/IFormAction";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { INTERNAL_VARIABLE_NAMES, SYSTEM_RESERVED_LOOP_VARIABLES } from "./VariableConstants";

const DEFAULT_COLLECT_OPTIONS: Required<VariableCollectOptions> = {
    includeInternal: true,
    includeSystemReserved: true,
    includeEmpty: false
};

export class VariableRegistry {
    static collectAllVariables(formConfig: FormConfig, options?: VariableCollectOptions): VariableInfo[] {
        const opts = { ...DEFAULT_COLLECT_OPTIONS, ...options };
        const result: VariableInfo[] = [];

        result.push(...this.collectFormFieldVariables(formConfig, opts));
        result.push(...this.collectActionDerivedVariables(formConfig, opts));

        if (opts.includeInternal) {
            result.push(...INTERNAL_VARIABLE_NAMES.map<VariableInfo>((name) => ({
                name,
                source: VariableSource.INTERNAL,
                isReserved: true
            })));
        }

        if (opts.includeSystemReserved) {
            result.push(...SYSTEM_RESERVED_LOOP_VARIABLES.map<VariableInfo>((name) => ({
                name,
                source: VariableSource.SYSTEM_RESERVED,
                description: LoopVariableScope.getVariableDescription(name),
                isReserved: true
            })));
        }

        return result;
    }

    static collectFormFieldVariables(formConfig: FormConfig, options?: VariableCollectOptions): VariableInfo[] {
        const opts = { ...DEFAULT_COLLECT_OPTIONS, ...options };
        const fields = formConfig.fields || [];
        return fields
            .map<VariableInfo>((field, index) => ({
                name: field.label,
                description: field.description,
                source: VariableSource.FORM_FIELD,
                sourceId: field.id,
                location: {
                    fieldId: field.id,
                    index
                }
            }))
            .filter((info) => this.shouldInclude(info.name, opts));
    }

    static collectActionDerivedVariables(formConfig: FormConfig, options?: VariableCollectOptions): VariableInfo[] {
        const opts = { ...DEFAULT_COLLECT_OPTIONS, ...options };
        const actions = this.flattenActions(formConfig);
        const result: VariableInfo[] = [];

        actions.forEach((action, index) => {
            switch (action.type) {
                case FormActionType.SUGGEST_MODAL: {
                    const suggest = action as SuggestModalFormAction;
                    if (this.shouldInclude(suggest.fieldName, opts)) {
                        result.push({
                            name: suggest.fieldName,
                            source: VariableSource.SUGGEST_MODAL,
                            sourceId: suggest.id,
                            description: "",
                            location: {
                                actionId: suggest.id,
                                actionType: action.type,
                                index
                            }
                        });
                    }
                    break;
                }
                case FormActionType.GENERATE_FORM: {
                    const generated = action as GenerateFormAction;
                    const childFields = generated.fields || [];
                    childFields.forEach((field, childIndex) => {
                        if (!this.shouldInclude(field.label, opts)) {
                            return;
                        }
                        result.push({
                            name: field.label,
                            source: VariableSource.FORM_FIELD,
                            sourceId: field.id,
                            description: field.description,
                            location: {
                                actionId: generated.id,
                                actionType: action.type,
                                index,
                                path: `actions.${index}.fields.${childIndex}`
                            }
                        });
                    });
                    break;
                }
                case FormActionType.LOOP: {
                    const loopAction = action as LoopFormAction;
                    const loopVariables = [
                        loopAction.itemVariableName,
                        loopAction.indexVariableName,
                        loopAction.totalVariableName
                    ];
                    loopVariables.forEach((name, varIndex) => {
                        if (!this.shouldInclude(name, opts)) {
                            return;
                        }
                        result.push({
                            name,
                            source: VariableSource.LOOP_VAR,
                            sourceId: loopAction.id,
                            description: "",
                            location: {
                                actionId: loopAction.id,
                                actionType: action.type,
                                index,
                                path: `loopVariables.${varIndex}`,
                                actionGroupId: loopAction.actionGroupId
                            }
                        });
                    });
                    break;
                }
                case FormActionType.AI: {
                    const aiAction = action as AIFormAction;
                    if (this.shouldInclude(aiAction.outputVariableName, opts)) {
                        result.push({
                            name: aiAction.outputVariableName!,
                            source: VariableSource.AI_OUTPUT,
                            sourceId: aiAction.id,
                            description: "",
                            location: {
                                actionId: aiAction.id,
                                actionType: action.type,
                                index
                            }
                        });
                    }
                    break;
                }
                default:
                    break;
            }
        });

        return result;
    }

    private static flattenActions(formConfig: FormConfig): IFormAction[] {
        const result: IFormAction[] = [];
        const visitedGroupIds = new Set<string>();
        const traverse = (actions: IFormAction[] | undefined) => {
            if (!actions) {
                return;
            }
            actions.forEach((action) => {
                result.push(action);
                if (action.type === FormActionType.LOOP) {
                    const loopAction = action as LoopFormAction;
                    if (!loopAction.actionGroupId) {
                        return;
                    }
                    if (visitedGroupIds.has(loopAction.actionGroupId)) {
                        return;
                    }
                    visitedGroupIds.add(loopAction.actionGroupId);
                    const group = (formConfig.actionGroups || []).find(
                        (g) => g.id === loopAction.actionGroupId
                    );
                    if (group) {
                        traverse(group.actions);
                    }
                }
            });
        };

        traverse(formConfig.actions || []);
        return result;
    }

    private static shouldInclude(name: string | undefined, options: Required<VariableCollectOptions>): boolean {
        if (!name) {
            return options.includeEmpty;
        }
        return !!name.trim();
    }
}

