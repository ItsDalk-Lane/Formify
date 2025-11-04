import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import Toggle, { ToggleOption } from "src/component/toggle/Toggle";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { DeleteContentConfig } from "src/model/action/TextFormAction";
import { TargetMode } from "src/model/enums/TargetMode";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { ContentDeleteRange } from "src/model/enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "src/model/enums/HeadingContentDeleteRange";
import { TargetModeSelect } from "../common/TargetModeSelect";
import { VaultPathSuggestInput } from "../common/VaultPathSuggestInput";

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

    const deleteTypeOptions: ToggleOption<ContentDeleteType>[] = useMemo(
        () => [
            {
                id: ContentDeleteType.ENTIRE_CONTENT,
                value: ContentDeleteType.ENTIRE_CONTENT,
                label: localInstance.text_delete_content_type_entire,
            },
            {
                id: ContentDeleteType.HEADING_CONTENT,
                value: ContentDeleteType.HEADING_CONTENT,
                label: localInstance.text_delete_content_type_heading,
            },
        ],
        []
    );

    const contentRangeOptions: ToggleOption<ContentDeleteRange>[] = useMemo(
        () => [
            {
                id: ContentDeleteRange.ALL,
                value: ContentDeleteRange.ALL,
                label: localInstance.text_delete_content_range_all,
            },
            {
                id: ContentDeleteRange.BODY_ONLY,
                value: ContentDeleteRange.BODY_ONLY,
                label: localInstance.text_delete_content_range_body,
            },
        ],
        []
    );

    const headingRangeOptions: ToggleOption<HeadingContentDeleteRange>[] = useMemo(
        () => [
            {
                id: HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
                value: HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
                label: localInstance.text_heading_delete_range_to_same_or_higher,
            },
            {
                id: HeadingContentDeleteRange.ALL_CHILDREN,
                value: HeadingContentDeleteRange.ALL_CHILDREN,
                label: localInstance.text_heading_delete_range_all_children,
            },
            {
                id: HeadingContentDeleteRange.BODY_ONLY,
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
                    <div className="form--TextTargetFileList">
                        {targetFiles.map((file, index) => (
                            <div className="form--TextTargetFileItem" key={index}>
                                <VaultPathSuggestInput
                                    value={file}
                                    placeholder={localInstance.text_target_files_placeholder}
                                    onChange={(value) => {
                                        const newFiles = [...targetFiles];
                                        newFiles[index] = value;
                                        handleConfigChange({ targetFiles: newFiles });
                                    }}
                                />
                                <button
                                    className="clickable-icon"
                                    onClick={() => {
                                        const newFiles = targetFiles.filter((_, i) => i !== index);
                                        handleConfigChange({ targetFiles: newFiles });
                                    }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        <button
                            className="form--AddButton"
                            onClick={() => {
                                handleConfigChange({ targetFiles: [...targetFiles, ""] });
                            }}
                        >
                            <Plus size={16} /> {localInstance.add}
                        </button>
                    </div>
                </CpsFormItem>
            )}

            <CpsFormItem
                label={localInstance.text_delete_content_type_label}
                description={localInstance.text_delete_content_type_description}
            >
                <Toggle
                    options={deleteTypeOptions}
                    value={config.contentDeleteType}
                    onChange={(value) => {
                        handleConfigChange({ contentDeleteType: value });
                    }}
                />
            </CpsFormItem>

            {config.contentDeleteType === ContentDeleteType.ENTIRE_CONTENT && (
                <CpsFormItem
                    label={localInstance.text_delete_content_range_label}
                    description={localInstance.text_delete_content_range_description}
                >
                    <Toggle
                        options={contentRangeOptions}
                        value={config.contentDeleteRange ?? ContentDeleteRange.ALL}
                        onChange={(value) => {
                            handleConfigChange({ contentDeleteRange: value });
                        }}
                    />
                </CpsFormItem>
            )}

            {config.contentDeleteType === ContentDeleteType.HEADING_CONTENT && (
                <>
                    <CpsFormItem
                        label={localInstance.text_heading_title_label}
                        description={localInstance.text_heading_title_description}
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
                    >
                        <Toggle
                            options={headingRangeOptions}
                            value={config.headingContentDeleteRange ?? HeadingContentDeleteRange.TO_SAME_OR_HIGHER}
                            onChange={(value) => {
                                handleConfigChange({ headingContentDeleteRange: value });
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

