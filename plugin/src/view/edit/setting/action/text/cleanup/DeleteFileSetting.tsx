import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { DeleteFileConfig } from "src/model/action/TextFormAction";
import { TargetMode } from "src/model/enums/TargetMode";
import { DeleteType } from "src/model/enums/DeleteType";
import { FolderDeleteOption } from "src/model/enums/FolderDeleteOption";
import { TargetModeSelect } from "../common/TargetModeSelect";
import { VaultPathSuggestInput } from "../common/VaultPathSuggestInput";

type DeleteFileSettingProps = {
    config: DeleteFileConfig;
    onChange: (config: DeleteFileConfig) => void;
};

export function DeleteFileSetting(props: DeleteFileSettingProps) {
    const { config, onChange } = props;

    const targetPaths = config.targetPaths ?? [];

    const handleConfigChange = (patch: Partial<DeleteFileConfig>) => {
        onChange({
            ...config,
            ...patch,
        });
    };

    const deleteTypeOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: DeleteType.FILE,
                label: localInstance.text_delete_type_file,
            },
            {
                value: DeleteType.FOLDER,
                label: localInstance.text_delete_type_folder,
            },
        ],
        []
    );

    const folderDeleteOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: FolderDeleteOption.RECURSIVE,
                label: localInstance.text_folder_delete_recursive,
            },
            {
                value: FolderDeleteOption.FILES_ONLY,
                label: localInstance.text_folder_delete_files_only,
            },
            {
                value: FolderDeleteOption.FOLDERS_ONLY,
                label: localInstance.text_folder_delete_folders_only,
            },
        ],
        []
    );

    return (
        <div className="form--DeleteFileSetting">
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

            {/* 当目标模式为指定文件时，先显示删除类型 */}
            {config.targetMode === TargetMode.SPECIFIED && (
                <CpsFormItem
                    label={localInstance.text_delete_type_label}
                    description={localInstance.text_delete_type_description}
                    layout="horizontal"
                >
                    <Select2
                        options={deleteTypeOptions}
                        value={config.deleteType}
                        onChange={(value) => {
                            handleConfigChange({ deleteType: value as DeleteType });
                        }}
                    />
                </CpsFormItem>
            )}

            {config.targetMode === TargetMode.SPECIFIED && (
                <CpsFormItem
                    label={localInstance.text_target_paths_label}
                    description={localInstance.text_target_paths_description}
                >
                    <div className="form--TextTargetFileList">
                        {targetPaths.map((path, index) => (
                            <div className="form--TextTargetFileItem" key={index}>
                                <VaultPathSuggestInput
                                    value={path}
                                    placeholder={localInstance.text_target_paths_placeholder}
                                    foldersOnly={config.deleteType === DeleteType.FOLDER}
                                    onChange={(value) => {
                                        const newPaths = [...targetPaths];
                                        newPaths[index] = value;
                                        handleConfigChange({ targetPaths: newPaths });
                                    }}
                                />
                                <button
                                    className="clickable-icon"
                                    onClick={() => {
                                        const newPaths = targetPaths.filter((_, i) => i !== index);
                                        handleConfigChange({ targetPaths: newPaths });
                                    }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        <button
                            className="form--AddButton"
                            onClick={() => {
                                handleConfigChange({ targetPaths: [...targetPaths, ""] });
                            }}
                        >
                            <Plus size={16} /> {localInstance.add}
                        </button>
                    </div>
                </CpsFormItem>
            )}

            {config.targetMode === TargetMode.SPECIFIED && config.deleteType === DeleteType.FOLDER && (
                <CpsFormItem
                    label={localInstance.text_folder_delete_option_label}
                    description={localInstance.text_folder_delete_option_description}
                    layout="horizontal"
                >
                    <Select2
                        options={folderDeleteOptions}
                        value={config.folderDeleteOption ?? FolderDeleteOption.RECURSIVE}
                        onChange={(value) => {
                            handleConfigChange({ folderDeleteOption: value as FolderDeleteOption });
                        }}
                    />
                </CpsFormItem>
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
                        placeholder={localInstance.text_delete_file_confirm_placeholder}
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

