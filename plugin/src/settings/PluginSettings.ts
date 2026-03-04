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

    aiDataFolder: string;

    tars: TarsFeatureConfig;

	chat: ChatSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    formFolder: "System/formify",
    scriptFolder: "System/scripts",
    aiDataFolder: "System/AI Data",
    tars: {
        settings: cloneTarsSettings(),
    },
	chat: DEFAULT_CHAT_SETTINGS,
};
