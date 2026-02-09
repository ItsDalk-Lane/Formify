import React, { useMemo } from "react";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { DeleteContentConfig } from "src/model/action/TextFormAction";
import { TargetMode } from "src/model/enums/TargetMode";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { ContentDeleteRange } from "src/model/enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "src/model/enums/HeadingContentDeleteRange";
import { TargetModeSelect } from "../common/TargetModeSelect";
import { TargetFileListInput } from "../../common/TargetFileListInput";

type DeleteContentSettingProps = {
    config: DeleteContentConfig;
    onChange: (config: DeleteContentConfig) => void;
};

export function DeleteContentSetting(props: DeleteContentSettingProps) {
    const { config, onChange } = props;

    const targetFiles = config.targetFiles ?? [];

    const handleConfigChange = (patch: Partial<DeleteContentConfig>) => {
        onChange({
            ...config,
            ...patch,
        });
    };

    const deleteTypeOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: ContentDeleteType.ENTIRE_CONTENT,
                label: localInstance.text_delete_content_type_entire,
            },
            {
                value: ContentDeleteType.HEADING_CONTENT,
                label: localInstance.text_delete_content_type_heading,
            },
        ],
        []
    );

    const contentRangeOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: ContentDeleteRange.ALL,
                label: localInstance.text_delete_content_range_all,
            },
            {
                value: ContentDeleteRange.BODY_ONLY,
                label: localInstance.text_delete_content_range_body,
            },
        ],
        []
    );

    const headingRangeOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
                label: localInstance.text_heading_delete_range_to_same_or_higher,
            },
            {
                value: HeadingContentDeleteRange.ALL_CHILDREN,
                label: localInstance.text_heading_delete_range_all_children,
            },
            {
                value: HeadingContentDeleteRange.BODY_ONLY,
                label: localInstance.text_heading_delete_range_body_only,
            },
        ],
        []
    );

    return (
        <div className="form--DeleteContentSetting">
            <CpsFormItem
                label={localInstance.text_target_mode_label}
                description={localInstance.text_target_mode_description}
            >
                <TargetModeSelect
                    value={config.targetMode}
                    onChange={(value) => {
                        handleConfigChange({ targetMode: value });
                    }}
                />
            </CpsFormItem>

            {config.targetMode === TargetMode.SPECIFIED && (
                <CpsFormItem
                    label={localInstance.text_target_files_label}
                    description={localInstance.text_target_files_description}
                >
                    <TargetFileListInput
                        files={targetFiles}
                        mdOnly={false}
                        onChange={(files) => {
                            handleConfigChange({ targetFiles: files });
                        }}
                    />
                </CpsFormItem>
            )}

            <CpsFormItem
                label={localInstance.text_delete_content_type_label}
                description={localInstance.text_delete_content_type_description}
                layout="horizontal"
            >
                <Select2
                    options={deleteTypeOptions}
                    value={config.contentDeleteType}
                    onChange={(value) => {
                        handleConfigChange({ contentDeleteType: value as ContentDeleteType });
                    }}
                />
            </CpsFormItem>

            {config.contentDeleteType === ContentDeleteType.ENTIRE_CONTENT && (
                <CpsFormItem
                    label={localInstance.text_delete_content_range_label}
                    description={localInstance.text_delete_content_range_description}
                    layout="horizontal"
                >
                    <Select2
                        options={contentRangeOptions}
                        value={config.contentDeleteRange ?? ContentDeleteRange.ALL}
                        onChange={(value) => {
                            handleConfigChange({ contentDeleteRange: value as ContentDeleteRange });
                        }}
                    />
                </CpsFormItem>
            )}

            {config.contentDeleteType === ContentDeleteType.HEADING_CONTENT && (
                <>
                    <CpsFormItem
                        label={localInstance.text_heading_title_label}
                        description={localInstance.text_heading_title_description}
                        layout="horizontal"
                    >
                        <input
                            type="text"
                            value={config.headingTitle || ""}
                            placeholder={localInstance.text_heading_title_placeholder}
                            onChange={(event) => {
                                handleConfigChange({ headingTitle: event.target.value });
                            }}
                            style={{ width: "100%" }}
                        />
                    </CpsFormItem>

                    <CpsFormItem
                        label={localInstance.text_heading_delete_range_label}
                        description={localInstance.text_heading_delete_range_description}
                        layout="horizontal"
                    >
                        <Select2
                            options={headingRangeOptions}
                            value={config.headingContentDeleteRange ?? HeadingContentDeleteRange.TO_SAME_OR_HIGHER}
                            onChange={(value) => {
                                handleConfigChange({ headingContentDeleteRange: value as HeadingContentDeleteRange });
                            }}
                        />
                    </CpsFormItem>
                </>
            )}

            <CpsFormItem
                label={localInstance.text_need_confirm_label}
                description={localInstance.text_need_confirm_description}
            >
                <ToggleControl
                    value={config.needConfirm !== false}
                    onValueChange={(value) => {
                        handleConfigChange({ needConfirm: value });
                    }}
                />
            </CpsFormItem>

            {config.needConfirm !== false && (
                <CpsFormItem
                    label={localInstance.text_confirm_message_label}
                    description={localInstance.text_confirm_message_description}
                >
                    <input
                        type="text"
                        value={config.confirmMessage || ""}
                        placeholder={localInstance.text_delete_content_confirm_placeholder}
                        onChange={(event) => {
                            handleConfigChange({ confirmMessage: event.target.value });
                        }}
                        style={{ width: "100%" }}
                    />
                </CpsFormItem>
            )}
        </div>
    );
}

