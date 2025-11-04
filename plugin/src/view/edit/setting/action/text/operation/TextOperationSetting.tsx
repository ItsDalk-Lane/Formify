import React, { useMemo } from "react";
import { localInstance } from "src/i18n/locals";
import { TextFormAction, TextOperationConfig } from "src/model/action/TextFormAction";
import { TextOperationType } from "src/model/enums/TextOperationType";
import { TargetMode } from "src/model/enums/TargetMode";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import CpsFormItem from "src/view/shared/CpsFormItem";

type TextOperationSettingProps = {
    action: TextFormAction;
    onChange: (action: TextFormAction) => void;
};

const defaultOperationConfig = (): TextOperationConfig => ({
    type: TextOperationType.COPY_RICH_TEXT,
    targetMode: TargetMode.CURRENT,
    targetFiles: [],
    exportPath: "",
    openAfterExport: false,
});

const ensureOperationConfig = (config?: TextOperationConfig): TextOperationConfig => ({
    ...defaultOperationConfig(),
    ...(config ?? {}),
});

export function TextOperationSetting(props: TextOperationSettingProps) {
    const { action, onChange } = props;

    const operationConfig = useMemo(
        () => ensureOperationConfig(action.textOperationConfig),
        [action.textOperationConfig]
    );

    const operationType = operationConfig.type ?? TextOperationType.COPY_RICH_TEXT;

    const typeOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: TextOperationType.COPY_RICH_TEXT,
                label: localInstance.text_operation_type_copy_rich_text,
            },
            {
                value: TextOperationType.COPY_MARKDOWN,
                label: localInstance.text_operation_type_copy_markdown,
            },
            {
                value: TextOperationType.COPY_PLAIN_TEXT,
                label: localInstance.text_operation_type_copy_plain_text,
            },
            {
                value: TextOperationType.ADD_SPACES_BETWEEN_CJK_AND_ENGLISH,
                label: localInstance.text_operation_type_add_spaces_between_cjk_and_english,
            },
            {
                value: TextOperationType.EXPORT_HTML,
                label: localInstance.text_operation_type_export_html,
            },
        ],
        []
    );

    const handleOperationChange = (changes: Partial<TextOperationConfig>) => {
        const updatedConfig: TextOperationConfig = {
            ...operationConfig,
            ...changes,
        };
        onChange({
            ...action,
            textOperationConfig: updatedConfig,
        });
    };

    return (
        <div className="form--TextOperationSetting">
            <CpsFormItem
                label={localInstance.text_operation_type_label}
                description={localInstance.text_operation_type_description}
                layout="horizontal"
            >
                <Select2
                    options={typeOptions}
                    value={operationType}
                    onChange={(type) => handleOperationChange({ type: type as TextOperationType })}
                />
            </CpsFormItem>

            {operationType === TextOperationType.EXPORT_HTML && (
                <>
                    <CpsFormItem
                        label={localInstance.text_operation_export_path_label}
                        description={localInstance.text_operation_export_path_description}
                        layout="horizontal"
                    >
                        <input
                            type="text"
                            value={operationConfig.exportPath || ""}
                            placeholder={localInstance.text_operation_export_path_placeholder}
                            onChange={(e) => handleOperationChange({ exportPath: e.target.value })}
                        />
                    </CpsFormItem>

                    <CpsFormItem
                        label={localInstance.text_operation_open_after_export_label}
                        description={localInstance.text_operation_open_after_export_description}
                        layout="horizontal"
                    >
                        <input
                            type="checkbox"
                            checked={operationConfig.openAfterExport}
                            onChange={(e) => handleOperationChange({ openAfterExport: e.target.checked })}
                        />
                    </CpsFormItem>
                </>
            )}
        </div>
    );
}
