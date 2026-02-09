import React, { useMemo } from "react";
import { localInstance } from "src/i18n/locals";
import { MultipleComboboxSuggestion, Option } from "src/component/combobox/MultipleComboboxSuggestion";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { ClearFormatConfig } from "src/model/action/TextFormAction";
import { TargetMode } from "src/model/enums/TargetMode";
import { TargetModeSelect } from "../common/TargetModeSelect";
import { TargetFileListInput } from "../../common/TargetFileListInput";

type ClearFormatSettingProps = {
    config: ClearFormatConfig;
    onChange: (config: ClearFormatConfig) => void;
};

const basicFormatOptions = (): Option[] => [
    {
        value: "bold",
        label: localInstance.text_format_option_bold,
        description: localInstance.text_format_option_bold_desc,
    },
    {
        value: "italic",
        label: localInstance.text_format_option_italic,
        description: localInstance.text_format_option_italic_desc,
    },
    {
        value: "strike",
        label: localInstance.text_format_option_strike,
        description: localInstance.text_format_option_strike_desc,
    },
    {
        value: "highlight",
        label: localInstance.text_format_option_highlight,
        description: localInstance.text_format_option_highlight_desc,
    },
    {
        value: "inlineCode",
        label: localInstance.text_format_option_inline_code,
        description: localInstance.text_format_option_inline_code_desc,
    },
];

const linkMediaOptions = (): Option[] => [
    {
        value: "link",
        label: localInstance.text_format_option_link,
        description: localInstance.text_format_option_link_desc,
    },
    {
        value: "image",
        label: localInstance.text_format_option_image,
        description: localInstance.text_format_option_image_desc,
    },
];

const structureOptions = (): Option[] => [
    {
        value: "heading",
        label: localInstance.text_format_option_heading,
        description: localInstance.text_format_option_heading_desc,
    },
    {
        value: "quote",
        label: localInstance.text_format_option_quote,
        description: localInstance.text_format_option_quote_desc,
    },
    {
        value: "list",
        label: localInstance.text_format_option_list,
        description: localInstance.text_format_option_list_desc,
    },
    {
        value: "table",
        label: localInstance.text_format_option_table,
        description: localInstance.text_format_option_table_desc,
    },
];

const advancedOptions = (): Option[] => [
    {
        value: "comment",
        label: localInstance.text_format_option_comment,
        description: localInstance.text_format_option_comment_desc,
    },
    {
        value: "footnote",
        label: localInstance.text_format_option_footnote,
        description: localInstance.text_format_option_footnote_desc,
    },
    {
        value: "math",
        label: localInstance.text_format_option_math,
        description: localInstance.text_format_option_math_desc,
    },
    {
        value: "frontmatter",
        label: localInstance.text_format_option_frontmatter,
        description: localInstance.text_format_option_frontmatter_desc,
    },
];

export function ClearFormatSetting(props: ClearFormatSettingProps) {
    const { config, onChange } = props;

    const targetFiles = config.targetFiles ?? [];
    const basicFormats = config.basicFormats ?? [];
    const linkMediaFormats = config.linkMediaFormats ?? [];
    const structureFormats = config.structureFormats ?? [];
    const advancedFormats = config.advancedFormats ?? [];

    const handleConfigChange = (patch: Partial<ClearFormatConfig>) => {
        onChange({
            ...config,
            ...patch,
        });
    };

    const mergedBasicOptions = useMemo(basicFormatOptions, []);
    const mergedLinkMediaOptions = useMemo(linkMediaOptions, []);
    const mergedStructureOptions = useMemo(structureOptions, []);
    const mergedAdvancedOptions = useMemo(advancedOptions, []);

    return (
        <div className="form--ClearFormatSetting">
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
                        mdOnly={true}
                        onChange={(files) => {
                            handleConfigChange({ targetFiles: files });
                        }}
                    />
                </CpsFormItem>
            )}

            <CpsFormItem
                label={localInstance.text_clear_all_formats_label}
                description={localInstance.text_clear_all_formats_description}
            >
                <ToggleControl
                    value={config.clearAll === true}
                    onValueChange={(value) => {
                        handleConfigChange({ clearAll: value });
                    }}
                />
            </CpsFormItem>

            {config.clearAll !== true && (
                <>
                    <CpsFormItem
                        label={localInstance.text_basic_formats_label}
                        description={localInstance.text_basic_formats_description}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <MultipleComboboxSuggestion
                                    value={basicFormats}
                                    options={mergedBasicOptions}
                                    placeholder={localInstance.text_basic_formats_placeholder}
                                    onChange={(value) => {
                                        handleConfigChange({
                                            basicFormats: Array.isArray(value) ? value : [],
                                        });
                                    }}
                                />
                                <button
                                    type="button"
                                    className="mod-cta"
                                    style={{ flexShrink: 0, padding: "4px 12px", fontSize: "13px" }}
                                    onClick={() => {
                                        if (basicFormats.length === mergedBasicOptions.length) {
                                            handleConfigChange({ basicFormats: [] });
                                        } else {
                                            handleConfigChange({
                                                basicFormats: mergedBasicOptions.map((opt) => opt.value),
                                            });
                                        }
                                    }}
                                >
                                    {basicFormats.length === mergedBasicOptions.length ? "取消" : "全选"}
                                </button>
                            </div>
                        </div>
                    </CpsFormItem>

                    <CpsFormItem
                        label={localInstance.text_link_media_label}
                        description={localInstance.text_link_media_description}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <MultipleComboboxSuggestion
                                    value={linkMediaFormats}
                                    options={mergedLinkMediaOptions}
                                    placeholder={localInstance.text_link_media_placeholder}
                                    onChange={(value) => {
                                        handleConfigChange({
                                            linkMediaFormats: Array.isArray(value) ? value : [],
                                        });
                                    }}
                                />
                                <button
                                    type="button"
                                    className="mod-cta"
                                    style={{ flexShrink: 0, padding: "4px 12px", fontSize: "13px" }}
                                    onClick={() => {
                                        if (linkMediaFormats.length === mergedLinkMediaOptions.length) {
                                            handleConfigChange({ linkMediaFormats: [] });
                                        } else {
                                            handleConfigChange({
                                                linkMediaFormats: mergedLinkMediaOptions.map((opt) => opt.value),
                                            });
                                        }
                                    }}
                                >
                                    {linkMediaFormats.length === mergedLinkMediaOptions.length ? "取消" : "全选"}
                                </button>
                            </div>
                        </div>
                    </CpsFormItem>

                    <CpsFormItem
                        label={localInstance.text_structure_label}
                        description={localInstance.text_structure_description}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <MultipleComboboxSuggestion
                                    value={structureFormats}
                                    options={mergedStructureOptions}
                                    placeholder={localInstance.text_structure_placeholder}
                                    onChange={(value) => {
                                        handleConfigChange({
                                            structureFormats: Array.isArray(value) ? value : [],
                                        });
                                    }}
                                />
                                <button
                                    type="button"
                                    className="mod-cta"
                                    style={{ flexShrink: 0, padding: "4px 12px", fontSize: "13px" }}
                                    onClick={() => {
                                        if (structureFormats.length === mergedStructureOptions.length) {
                                            handleConfigChange({ structureFormats: [] });
                                        } else {
                                            handleConfigChange({
                                                structureFormats: mergedStructureOptions.map((opt) => opt.value),
                                            });
                                        }
                                    }}
                                >
                                    {structureFormats.length === mergedStructureOptions.length ? "取消" : "全选"}
                                </button>
                            </div>
                        </div>
                    </CpsFormItem>

                    <CpsFormItem
                        label={localInstance.text_advanced_label}
                        description={localInstance.text_advanced_description}
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <MultipleComboboxSuggestion
                                    value={advancedFormats}
                                    options={mergedAdvancedOptions}
                                    placeholder={localInstance.text_advanced_placeholder}
                                    onChange={(value) => {
                                        handleConfigChange({
                                            advancedFormats: Array.isArray(value) ? value : [],
                                        });
                                    }}
                                />
                                <button
                                    type="button"
                                    className="mod-cta"
                                    style={{ flexShrink: 0, padding: "4px 12px", fontSize: "13px" }}
                                    onClick={() => {
                                        if (advancedFormats.length === mergedAdvancedOptions.length) {
                                            handleConfigChange({ advancedFormats: [] });
                                        } else {
                                            handleConfigChange({
                                                advancedFormats: mergedAdvancedOptions.map((opt) => opt.value),
                                            });
                                        }
                                    }}
                                >
                                    {advancedFormats.length === mergedAdvancedOptions.length ? "取消" : "全选"}
                                </button>
                            </div>
                        </div>
                    </CpsFormItem>
                </>
            )}

            <CpsFormItem
                label={localInstance.text_need_confirm_label}
                description={localInstance.text_need_confirm_description}
            >
                <ToggleControl
                    value={config.needConfirm === true}
                    onValueChange={(value) => {
                        handleConfigChange({ needConfirm: value });
                    }}
                />
            </CpsFormItem>

            {config.needConfirm === true && (
                <CpsFormItem
                    label={localInstance.text_confirm_message_label}
                    description={localInstance.text_confirm_message_description}
                >
                    <input
                        type="text"
                        value={config.confirmMessage || ""}
                        placeholder={localInstance.text_clear_format_confirm_placeholder}
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

