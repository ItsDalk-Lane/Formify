import React, { useMemo } from "react";
import { localInstance } from "src/i18n/locals";
import { TextFormAction, TextCleanupConfig, ClearFormatConfig, DeleteFileConfig, DeleteContentConfig } from "src/model/action/TextFormAction";
import { TextCleanupType } from "src/model/enums/TextCleanupType";
import { TargetMode } from "src/model/enums/TargetMode";
import { DeleteType } from "src/model/enums/DeleteType";
import { FolderDeleteOption } from "src/model/enums/FolderDeleteOption";
import { ContentDeleteType } from "src/model/enums/ContentDeleteType";
import { ContentDeleteRange } from "src/model/enums/ContentDeleteRange";
import { HeadingContentDeleteRange } from "src/model/enums/HeadingContentDeleteRange";
import Toggle, { ToggleOption } from "src/component/toggle/Toggle";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { ClearFormatSetting } from "./ClearFormatSetting";
import { DeleteFileSetting } from "./DeleteFileSetting";
import { DeleteContentSetting } from "./DeleteContentSetting";

type TextCleanupSettingProps = {
    action: TextFormAction;
    onChange: (action: TextFormAction) => void;
};

const defaultClearFormatConfig = (): ClearFormatConfig => ({
    targetMode: TargetMode.CURRENT,
    targetFiles: [],
    clearAll: true,
    basicFormats: [],
    linkMediaFormats: [],
    structureFormats: [],
    advancedFormats: [],
    needConfirm: false,
});

const defaultDeleteFileConfig = (): DeleteFileConfig => ({
    targetMode: TargetMode.CURRENT,
    targetPaths: [],
    deleteType: DeleteType.FILE,
    folderDeleteOption: FolderDeleteOption.RECURSIVE,
    needConfirm: true,
});

const defaultDeleteContentConfig = (): DeleteContentConfig => ({
    targetMode: TargetMode.CURRENT,
    targetFiles: [],
    contentDeleteType: ContentDeleteType.ENTIRE_CONTENT,
    contentDeleteRange: ContentDeleteRange.ALL,
    headingContentDeleteRange: HeadingContentDeleteRange.TO_SAME_OR_HIGHER,
    needConfirm: true,
});

const ensureCleanupConfig = (config?: TextCleanupConfig): TextCleanupConfig => ({
    type: config?.type ?? TextCleanupType.CLEAR_FORMAT,
    clearFormatConfig: {
        ...defaultClearFormatConfig(),
        ...(config?.clearFormatConfig ?? {}),
    },
    deleteFileConfig: {
        ...defaultDeleteFileConfig(),
        ...(config?.deleteFileConfig ?? {}),
    },
    deleteContentConfig: {
        ...defaultDeleteContentConfig(),
        ...(config?.deleteContentConfig ?? {}),
    },
});

export function TextCleanupSetting(props: TextCleanupSettingProps) {
    const { action, onChange } = props;

    const cleanupConfig = useMemo(
        () => ensureCleanupConfig(action.textCleanupConfig),
        [action.textCleanupConfig]
    );

    const cleanupType = cleanupConfig.type ?? TextCleanupType.CLEAR_FORMAT;

    const options: ToggleOption<TextCleanupType>[] = useMemo(
        () => [
            {
                id: TextCleanupType.CLEAR_FORMAT,
                value: TextCleanupType.CLEAR_FORMAT,
                label: localInstance.text_action_cleanup_feature_clear_format,
            },
            {
                id: TextCleanupType.DELETE_FILE,
                value: TextCleanupType.DELETE_FILE,
                label: localInstance.text_action_cleanup_feature_delete_file,
            },
            {
                id: TextCleanupType.DELETE_CONTENT,
                value: TextCleanupType.DELETE_CONTENT,
                label: localInstance.text_action_cleanup_feature_delete_content,
            },
        ],
        []
    );

    const updateCleanupConfig = (config: TextCleanupConfig) => {
        onChange({
            ...action,
            textCleanupConfig: config,
        });
    };

    const handleTypeChange = (type: TextCleanupType) => {
        updateCleanupConfig({
            ...cleanupConfig,
            type,
        });
    };

    return (
        <div className="form--TextCleanupSetting">
            <CpsFormItem
                label={localInstance.text_action_cleanup}
                description={localInstance.text_action_cleanup_description}
            >
                <Toggle
                    options={options}
                    value={cleanupType}
                    onChange={handleTypeChange}
                />
            </CpsFormItem>

            {cleanupType === TextCleanupType.CLEAR_FORMAT && (
                <ClearFormatSetting
                    config={cleanupConfig.clearFormatConfig ?? defaultClearFormatConfig()}
                    onChange={(clearFormatConfig) => {
                        updateCleanupConfig({
                            ...cleanupConfig,
                            type: TextCleanupType.CLEAR_FORMAT,
                            clearFormatConfig,
                        });
                    }}
                />
            )}

            {cleanupType === TextCleanupType.DELETE_FILE && (
                <DeleteFileSetting
                    config={cleanupConfig.deleteFileConfig ?? defaultDeleteFileConfig()}
                    onChange={(deleteFileConfig) => {
                        updateCleanupConfig({
                            ...cleanupConfig,
                            type: TextCleanupType.DELETE_FILE,
                            deleteFileConfig,
                        });
                    }}
                />
            )}

            {cleanupType === TextCleanupType.DELETE_CONTENT && (
                <DeleteContentSetting
                    config={cleanupConfig.deleteContentConfig ?? defaultDeleteContentConfig()}
                    onChange={(deleteContentConfig) => {
                        updateCleanupConfig({
                            ...cleanupConfig,
                            type: TextCleanupType.DELETE_CONTENT,
                            deleteContentConfig,
                        });
                    }}
                />
            )}
        </div>
    );
}

