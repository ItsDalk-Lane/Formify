import { cloneTarsSettings } from "src/features/tars";
import type { TarsSettings } from "src/features/tars";

export interface TarsFeatureConfig {
    settings: TarsSettings;
}

export interface PluginSettings {

    formFolder: string;

    scriptFolder: string;

    promptTemplateFolder: string;

    formCommands: FormCommandSettings;

    tars: TarsFeatureConfig;
}

export interface FormCommandSettings {
    [filePath: string]: {
        enabled: boolean;         // 命令是否启用
        userDisabled?: boolean;   // 用户是否手动禁用
        registeredAt?: number;    // 注册时间
    };
}

export const DEFAULT_SETTINGS: PluginSettings = {
    formFolder: "form/forms",
    scriptFolder: "form/scripts",
    promptTemplateFolder: "form/prompt-templates",
    formCommands: {},
    tars: {
        settings: cloneTarsSettings(),
    },
};
