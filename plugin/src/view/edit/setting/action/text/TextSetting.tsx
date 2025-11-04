import React, { useMemo } from "react";
import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { TextActionMode, TextFormAction } from "src/model/action/TextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import Toggle, { ToggleOption } from "src/component/toggle/Toggle";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { TextCleanupSetting } from "./cleanup/TextCleanupSetting";
import "./TextSetting.css";

type TextSettingProps = {
    value: IFormAction;
    onChange: (value: IFormAction) => void;
};

const operationId = "operation";
const cleanupId = "cleanup";

export function TextSetting(props: TextSettingProps) {
    const { value, onChange } = props;
    if (value.type !== FormActionType.TEXT) {
        return null;
    }

    const action = value as TextFormAction;
    const mode: TextActionMode = action.mode ?? "cleanup";

    const modeOptions: ToggleOption<TextActionMode>[] = useMemo(
        () => [
            {
                id: operationId,
                label: localInstance.text_action_operation,
                value: "operation",
            },
            {
                id: cleanupId,
                label: localInstance.text_action_cleanup,
                value: "cleanup",
            },
        ],
        []
    );

    const handleActionChange = (newAction: Partial<TextFormAction>) => {
        const mergedAction = {
            ...action,
            ...newAction,
        } as TextFormAction;
        onChange(mergedAction);
    };

    const description =
        mode === "operation"
            ? localInstance.text_action_operation_description
            : localInstance.text_action_cleanup_description;

    return (
        <>
            <CpsFormItem
                label={localInstance.mode}
                description={description}
            >
                <Toggle
                    options={modeOptions}
                    value={mode}
                    onChange={(newMode) => {
                        handleActionChange({ mode: newMode });
                    }}
                />
            </CpsFormItem>

            {mode === "operation" ? (
                <div className="form--TextActionOperationPlaceholder">
                    {localInstance.text_action_operation_description}
                </div>
            ) : (
                <TextCleanupSetting
                    action={action}
                    onChange={(nextAction) => {
                        onChange(nextAction);
                    }}
                />
            )}
        </>
    );
}

