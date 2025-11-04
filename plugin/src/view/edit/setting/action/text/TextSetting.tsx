import React, { useMemo } from "react";
import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import { TextActionMode, TextFormAction } from "src/model/action/TextFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { TextCleanupSetting } from "./cleanup/TextCleanupSetting";
import { TextOperationSetting } from "./operation/TextOperationSetting";
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

    const modeOptions: SelectOption2[] = useMemo(
        () => [
            {
                label: localInstance.text_action_operation,
                value: "operation",
            },
            {
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
                layout="horizontal"
            >
                <Select2
                    options={modeOptions}
                    value={mode}
                    onChange={(newMode) => {
                        handleActionChange({ mode: newMode as TextActionMode });
                    }}
                />
            </CpsFormItem>

            {mode === "operation" ? (
                <TextOperationSetting
                    action={action}
                    onChange={(nextAction) => {
                        onChange(nextAction);
                    }}
                />
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

