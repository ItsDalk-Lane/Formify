import { AlertTriangle } from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { ConflictInfo, ConflictType, VariableInfo, VariableSource } from "src/types/variable";

type Props = {
    conflict: ConflictInfo | null;
    onApplySuggestion?: (suggestedName: string) => void;
};

const conflictLabelMap: Record<ConflictType, string> = {
    [ConflictType.DUPLICATE]: localInstance.field_name_duplicate,
    [ConflictType.RESERVED]: localInstance.system_reserved_conflict,
    [ConflictType.FORMAT_INVALID]: localInstance.loop_variable_names,
    [ConflictType.CROSS_SCOPE]: localInstance.loop_variable_conflict,
    [ConflictType.SELF_CONFLICT]: localInstance.loop_variable_conflict
};

function formatTarget(variable: VariableInfo): string {
    switch (variable.source) {
        case VariableSource.FORM_FIELD:
            return `${localInstance.form_field_variable}`;
        case VariableSource.LOOP_VAR:
            return `${localInstance.loop_variable}`;
        case VariableSource.AI_OUTPUT:
            return `${localInstance.ai_output_variable}`;
        case VariableSource.SUGGEST_MODAL:
            return `${localInstance.suggest_field_variable}`;
        case VariableSource.INTERNAL:
            return `${localInstance.internal_variable}`;
        case VariableSource.SYSTEM_RESERVED:
            return `${localInstance.system_reserved_variable}`;
        default:
            return localInstance.variable_source;
    }
}

export function FieldNameConflictWarning(props: Props) {
    const { conflict, onApplySuggestion } = props;
    if (!conflict) {
        return null;
    }

    const label = conflictLabelMap[conflict.conflictType] || localInstance.variable_name_conflict;

    return (
        <div className="form--FieldNameConflictWarning">
            <AlertTriangle size={16} />
            <div className="form--FieldNameConflictWarningContent">
                <div className="form--FieldNameConflictWarningTitle">
                    {label}
                </div>
                <ul>
                    {conflict.items.map((item, index) => (
                        <li key={`${item.sourceId ?? item.name}-${index}`}>
                            {formatTarget(item)}：{item.name}
                        </li>
                    ))}
                </ul>
                {conflict.suggestion && (
                    <button
                        className="form--FieldNameConflictSuggestion"
                        onClick={() => onApplySuggestion?.(conflict.suggestion!)}
                    >
                        {localInstance.apply_suggestion}
                        <span>{conflict.suggestion}</span>
                    </button>
                )}
            </div>
        </div>
    );
}

