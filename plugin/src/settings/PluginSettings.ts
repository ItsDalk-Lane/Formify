import { cloneTarsSettings } from "src/features/tars";
import type { TarsSettings } from "src/features/tars";
import type { ChatSettings } from "src/features/chat";
import { DEFAULT_CHAT_SETTINGS } from "src/features/chat";

export interface TarsFeatureConfig {
    settings: TarsSettings;
}

export interface PluginSettings {

    formFolder: string;

    scriptFolder: string;

    promptTemplateFolder: string;

    tars: TarsFeatureConfig;

	chat: ChatSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    formFolder: "System/formify",
    scriptFolder: "System/scripts",
    promptTemplateFolder: "System/ai prompts",
    tars: {
        settings: cloneTarsSettings(),
    },
	chat: DEFAULT_CHAT_SETTINGS,
};
