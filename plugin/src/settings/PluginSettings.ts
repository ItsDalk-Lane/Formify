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
    formFolder: "form/forms",
    scriptFolder: "form/scripts",
    promptTemplateFolder: "form/prompt-templates",
    tars: {
        settings: cloneTarsSettings(),
    },
};
