import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Select2, SelectOption2 } from "src/component/select2/Select";
import ToggleControl from "src/view/shared/control/ToggleControl";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { localInstance } from "src/i18n/locals";
import { MoveFileConfig } from "src/model/action/TextFormAction";
import { TargetMode } from "src/model/enums/TargetMode";
import { DeleteType } from "src/model/enums/DeleteType";
import { FileConflictResolution } from "src/model/enums/FileConflictResolution";
import { TargetModeSelect } from "../common/TargetModeSelect";
import { VaultPathSuggestInput } from "../common/VaultPathSuggestInput";

type MoveFileSettingProps = {
    config: MoveFileConfig;
    onChange: (config: MoveFileConfig) => void;
};

export function MoveFileSetting(props: MoveFileSettingProps) {
    const { config, onChange } = props;
    const targetPaths = config.targetPaths ?? [];

    const handleConfigChange = (patch: Partial<MoveFileConfig>) => {
        onChange({
            ...config,
            ...patch,
        });
    };

    const moveTypeOptions: SelectOption2[] = useMemo(
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

    const conflictResolutionOptions: SelectOption2[] = useMemo(
        () => [
            {
                value: FileConflictResolution.SKIP,
                label: localInstance.file_conflict_resolution_skip,
            },
            {
                value: FileConflictResolution.AUTO_RENAME,
                label: localInstance.file_conflict_resolution_auto_rename,
            },
            {
                value: FileConflictResolution.OVERWRITE,
                label: localInstance.file_conflict_resolution_overwrite,
            },
        ],
        []
    );

    return (
        <div className="form--MoveFileSetting">
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
                    label={localInstance.text_move_type_label}
                    description={localInstance.text_move_type_description}
                    layout="horizontal"
                >
                    <Select2
                        options={moveTypeOptions}
                        value={config.moveType}
                        onChange={(value) => {
                            handleConfigChange({ moveType: value as DeleteType });
                        }}
                    />
                </CpsFormItem>
            )}

            {config.targetMode === TargetMode.SPECIFIED && (
                <CpsFormItem
                    label={localInstance.text_move_target_paths_label}
                    description={localInstance.text_move_target_paths_description}
                >
                    <div className="form--TextTargetFileList">
                        {targetPaths.map((path, index) => (
                            <div className="form--TextTargetFileItem" key={index}>
                                <VaultPathSuggestInput
                                    value={path}
                                    placeholder={localInstance.text_move_target_paths_placeholder}
                                    foldersOnly={config.moveType === DeleteType.FOLDER}
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

            <CpsFormItem
                label={localInstance.text_move_destination_folder_label}
                description={localInstance.text_move_destination_folder_description}
            >
                <VaultPathSuggestInput
                    value={config.destinationFolderPath || ""}
                    placeholder={localInstance.text_move_destination_folder_placeholder}
                    foldersOnly={true}
                    onChange={(value) => {
                        handleConfigChange({ destinationFolderPath: value });
                    }}
                />
            </CpsFormItem>

            <CpsFormItem
                label={localInstance.file_conflict_resolution}
                description={localInstance.text_move_conflict_resolution_description}
                layout="horizontal"
            >
                <Select2
                    options={conflictResolutionOptions}
                    value={config.conflictResolution ?? FileConflictResolution.SKIP}
                    onChange={(value) => {
                        handleConfigChange({ conflictResolution: value as FileConflictResolution });
                    }}
                />
            </CpsFormItem>

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
                        placeholder={localInstance.text_move_file_confirm_placeholder}
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
