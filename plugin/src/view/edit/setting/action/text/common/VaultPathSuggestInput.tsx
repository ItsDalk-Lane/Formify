import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { useObsidianApp } from "src/context/obsidianAppContext";
import ComboboxSuggestion, { Option } from "src/component/combobox/ComboboxSuggestion";
import { localInstance } from "src/i18n/locals";

function useVaultPathOptions(): Option[] {
    const app = useObsidianApp();

    return useMemo(() => {
        const options: Option[] = [];

        const traverse = (folder: TFolder) => {
            const folderPath = folder.path === "/" ? folder.name : folder.path;
            if (folderPath) {
                options.push({
                    value: folderPath,
                    label: folderPath,
                    description: localInstance.folder,
                });
            }

            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    traverse(child);
                } else if (child instanceof TFile) {
                    options.push({
                        value: child.path,
                        label: child.path,
                        description: child.extension || "file",
                    });
                }
            }
        };

        traverse(app.vault.getRoot());
        return options;
    }, [app]);
}

function useVaultFolderOptions(): Option[] {
    const app = useObsidianApp();

    return useMemo(() => {
        const options: Option[] = [];

        const traverse = (folder: TFolder) => {
            const folderPath = folder.path === "/" ? folder.name : folder.path;
            if (folderPath) {
                options.push({
                    value: folderPath,
                    label: folderPath,
                    description: localInstance.folder,
                });
            }

            for (const child of folder.children) {
                if (child instanceof TFolder) {
                    traverse(child);
                }
            }
        };

        traverse(app.vault.getRoot());
        return options;
    }, [app]);
}

export function VaultPathSuggestInput(props: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    foldersOnly?: boolean;
}) {
    const allOptions = useVaultPathOptions();
    const folderOptions = useVaultFolderOptions();
    const options = props.foldersOnly ? folderOptions : allOptions;

    return (
        <ComboboxSuggestion
            value={props.value}
            options={options}
            placeholder={props.placeholder}
            onChange={(value) => {
                props.onChange(value ?? "");
            }}
        />
    );
}

