export type SystemPromptSourceType = 'custom' | 'template';

export type AiFeatureId = 'ai_action' | 'tars_chat' | 'tab_completion' | 'selection_toolbar';

export interface SystemPromptItem {
	id: string;
	name: string;
	sourceType: SystemPromptSourceType;
	content?: string;
	templatePath?: string;
	enabled: boolean;
	excludeFeatures: AiFeatureId[];
	order: number;
	createdAt: number;
	updatedAt: number;
}

export interface SystemPromptsDataFile {
	version: number;
	prompts: SystemPromptItem[];
	lastModified: number;
}

export const SYSTEM_PROMPTS_DATA_VERSION = 1;
