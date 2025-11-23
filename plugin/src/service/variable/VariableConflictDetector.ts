import { FormConfig } from "src/model/FormConfig";
import { ConflictInfo, ConflictType, VariableInfo, VariableSource } from "src/types/variable";
import { VariableRegistry } from "./VariableRegistry";
import { VariableNameValidator } from "src/utils/VariableNameValidator";
import { LoopFormAction } from "src/model/action/LoopFormAction";

export class VariableConflictDetector {
    static detectConflictsFromConfig(formConfig: FormConfig): ConflictInfo[] {
        const variables = VariableRegistry.collectAllVariables(formConfig);
        return this.detectConflicts(variables);
    }

    static detectConflicts(variables: VariableInfo[]): ConflictInfo[] {
        const conflicts: ConflictInfo[] = [];
        const normalizedNameMap = new Map<string, VariableInfo[]>();

        variables.forEach((variable) => {
            const normalized = this.normalize(variable.name);
            if (!normalized) {
                return;
            }
            if (!normalizedNameMap.has(normalized)) {
                normalizedNameMap.set(normalized, []);
            }
            normalizedNameMap.get(normalized)!.push(variable);
        });

        const allNames = new Set(
            Array.from(normalizedNameMap.keys()).map((key) => key)
        );

        normalizedNameMap.forEach((items, normalizedName) => {
            if (items.length <= 1) {
                return;
            }
            const conflictType = this.resolveConflictType(items);
            conflicts.push({
                variableName: items[0].name,
                conflictType,
                items,
                suggestion: VariableNameValidator.suggestAlternativeName(
                    items[0].name,
                    Array.from(allNames)
                ),
                messageKey: this.getMessageKey(conflictType)
            });
        });

        return conflicts;
    }

    static checkFieldNameConflict(fieldName: string, currentFieldId: string | undefined, formConfig: FormConfig): ConflictInfo | null {
        const normalized = this.normalize(fieldName);
        if (!normalized) {
            return null;
        }

        const allVariables = VariableRegistry.collectAllVariables(formConfig);
        const conflicts = allVariables.filter((variable) => {
            if (variable.source === VariableSource.FORM_FIELD && variable.sourceId === currentFieldId) {
                return false;
            }
            return this.normalize(variable.name) === normalized;
        });

        if (conflicts.length === 0) {
            return null;
        }

        const conflictType = conflicts.some((c) => c.source === VariableSource.SYSTEM_RESERVED || c.source === VariableSource.INTERNAL)
            ? ConflictType.RESERVED
            : ConflictType.DUPLICATE;

        return {
            variableName: fieldName,
            conflictType,
            items: conflicts,
            suggestion: VariableNameValidator.suggestAlternativeName(
                fieldName,
                allVariables.map((item) => item.name)
            ),
            messageKey: this.getMessageKey(conflictType)
        };
    }

    static checkLoopVariableConflict(
        variableName: string,
        loopAction: LoopFormAction,
        formConfig: FormConfig,
        siblingNames: string[]
    ): ConflictInfo | null {
        const normalized = this.normalize(variableName);
        if (!normalized) {
            return null;
        }

        if (
            siblingNames.some(
                (name) => this.normalize(name) === normalized
            )
        ) {
            return {
                variableName,
                conflictType: ConflictType.SELF_CONFLICT,
                items: [
                    {
                        name: variableName,
                        source: VariableSource.LOOP_VAR,
                        sourceId: loopAction.id,
                        location: {
                            actionId: loopAction.id
                        }
                    }
                ],
                suggestion: VariableNameValidator.suggestAlternativeName(
                    variableName,
                    siblingNames
                ),
                messageKey: "loop_variable_conflict_self"
            };
        }

        const allVariables = VariableRegistry.collectAllVariables(formConfig);
        const conflicts = allVariables.filter((variable) => {
            if (variable.source === VariableSource.LOOP_VAR && variable.sourceId === loopAction.id) {
                return false;
            }
            if (variable.source === VariableSource.SYSTEM_RESERVED) {
                return false;
            }
            return this.normalize(variable.name) === normalized;
        });

        if (conflicts.length === 0) {
            return null;
        }

        const conflictType = conflicts.some((c) => c.source === VariableSource.SYSTEM_RESERVED || c.source === VariableSource.INTERNAL)
            ? ConflictType.RESERVED
            : ConflictType.CROSS_SCOPE;

        return {
            variableName,
            conflictType,
            items: conflicts,
            suggestion: VariableNameValidator.suggestAlternativeName(
                variableName,
                allVariables.map((item) => item.name)
            ),
            messageKey: this.getMessageKey(conflictType)
        };
    }

    private static resolveConflictType(items: VariableInfo[]): ConflictType {
        const hasReserved = items.some(
            (item) =>
                item.source === VariableSource.SYSTEM_RESERVED ||
                item.source === VariableSource.INTERNAL ||
                item.isReserved
        );
        if (hasReserved) {
            return ConflictType.RESERVED;
        }
        const sourceSet = new Set(items.map((item) => item.source));
        if (sourceSet.size > 1) {
            return ConflictType.CROSS_SCOPE;
        }
        return ConflictType.DUPLICATE;
    }

    private static normalize(name?: string): string | null {
        if (!name) {
            return null;
        }
        const trimmed = name.trim();
        return trimmed || null;
    }

    private static getMessageKey(conflictType: ConflictType): string {
        switch (conflictType) {
            case ConflictType.RESERVED:
                return "system_reserved_conflict";
            case ConflictType.CROSS_SCOPE:
                return "loop_variable_conflict";
            case ConflictType.SELF_CONFLICT:
                return "loop_variable_self_conflict";
            default:
                return "field_name_duplicate";
        }
    }
}

