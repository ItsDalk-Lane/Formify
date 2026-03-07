export type MultiModelMode = 'single' | 'compare';

export type LayoutMode = 'horizontal' | 'tabs' | 'vertical';

export interface CompareGroup {
	id: string;
	name: string;
	description: string;
	modelTags: string[];
	createdAt: number;
	updatedAt: number;
	isDefault: boolean;
}

export interface ParallelResponseEntry {
	modelTag: string;
	modelName: string;
	content: string;
	isComplete: boolean;
	isError: boolean;
	error?: string;
	errorMessage?: string;
	messageId?: string;
}

export interface ParallelResponseGroup {
	groupId: string;
	userMessageId: string;
	responses: ParallelResponseEntry[];
}
