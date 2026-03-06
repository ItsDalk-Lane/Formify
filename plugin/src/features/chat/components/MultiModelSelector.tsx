import type { ProviderSettings } from 'src/features/tars/providers';
import type { MultiModelMode, LayoutMode, CompareGroup, CollaborationTemplate } from '../types/multiModel';
import { ModelSelector } from './ModelSelector';
import { CompareModelSelector } from './CompareModelSelector';
import { CollabTemplateSelector } from './CollabTemplateSelector';

export interface MultiModelSelectorProps {
	providers: ProviderSettings[];
	selectedModelId: string;
	selectedModels: string[];
	multiModelMode: MultiModelMode;
	layoutMode: LayoutMode;
	compareGroups: CompareGroup[];
	collaborationTemplates: CollaborationTemplate[];
	activeCompareGroupId?: string;
	activeCollaborationTemplateId?: string;
	onSingleModelChange: (tag: string) => void;
	onModelToggle: (tag: string) => void;
	onModeChange: (mode: MultiModelMode) => void;
	onLayoutChange: (mode: LayoutMode) => void;
	onCompareGroupSelect: (groupId?: string) => void;
	onCollaborationTemplateSelect: (templateId?: string) => void;
	onOpenGroupManager: () => void;
	onOpenTemplateManager: () => void;
}

export const MultiModelSelector = ({
	providers,
	selectedModelId,
	selectedModels,
	multiModelMode,
	layoutMode,
	compareGroups,
	collaborationTemplates,
	activeCompareGroupId,
	activeCollaborationTemplateId,
	onSingleModelChange,
	onModelToggle,
	onModeChange,
	onLayoutChange,
	onCompareGroupSelect,
	onCollaborationTemplateSelect,
	onOpenGroupManager,
	onOpenTemplateManager,
}: MultiModelSelectorProps) => {
	return (
		<div className="multi-model-selector" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
			{/* 模型/模板选择器 + 布局切换 */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
				{/* 模型/模板选择器 */}
				<div style={{ flex: 1, minWidth: 0 }}>
					{multiModelMode === 'single' && (
						<ModelSelector
							providers={providers}
							value={selectedModelId}
							onChange={onSingleModelChange}
						/>
					)}
					{multiModelMode === 'compare' && (
						<CompareModelSelector
							providers={providers}
							selectedModels={selectedModels}
							compareGroups={compareGroups}
							activeCompareGroupId={activeCompareGroupId}
							onModelToggle={onModelToggle}
							onCompareGroupSelect={onCompareGroupSelect}
							onOpenGroupManager={onOpenGroupManager}
						/>
					)}
					{multiModelMode === 'collaborate' && (
						<CollabTemplateSelector
							collaborationTemplates={collaborationTemplates}
							activeCollaborationTemplateId={activeCollaborationTemplateId}
							onCollaborationTemplateSelect={onCollaborationTemplateSelect}
							onOpenTemplateManager={onOpenTemplateManager}
						/>
					)}
				</div>
			</div>
		</div>
	);
};
