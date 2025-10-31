import { cloneTarsSettings } from "src/features/tars";
import type { TarsSettings } from "src/features/tars";

export interface TarsFeatureConfig {
    enabled: boolean;
    settings: TarsSettings;
}

export interface PluginSettings {

    formFolder: string;

    scriptFolder: string;

    formIntegrations: FormIntegration;

    tars: TarsFeatureConfig;
}

export interface FormIntegration {
    [filePath: string]: {
        asCommand?: boolean;
    };
}


export const DEFAULT_SETTINGS: PluginSettings = {
    formFolder: "form/forms",
    scriptFolder: "form/scripts",
    formIntegrations: {},
    tars: {
        enabled: true,
        settings: cloneTarsSettings(),
    },
};
