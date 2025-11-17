import { cloneTarsSettings } from "src/features/tars";
import type { TarsSettings } from "src/features/tars";

export interface TarsFeatureConfig {
    settings: TarsSettings;
}

export interface PluginSettings {

    formFolder: string;

    scriptFolder: string;

    promptTemplateFolder: string;

    tars: TarsFeatureConfig;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    formFolder: "System/formify",
    scriptFolder: "System/scripts",
    promptTemplateFolder: "System/ai prompts",
    tars: {
        settings: cloneTarsSettings(),
    },
};
