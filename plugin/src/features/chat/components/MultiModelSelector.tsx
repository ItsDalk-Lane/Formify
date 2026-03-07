import type { ProviderSettings } from 'src/features/tars/providers';
import type { MultiModelMode, LayoutMode, CompareGroup } from '../types/multiModel';
import { ModelSelector } from './ModelSelector';
import { CompareModelSelector } from './CompareModelSelector';

export interface MultiModelSelectorProps {
	providers: ProviderSettings[];
	selectedModelId: string;
	selectedModels: string[];
	multiModelMode: MultiModelMode;
	layoutMode: LayoutMode;
	compareGroups: CompareGroup[];
	activeCompareGroupId?: string;
	onSingleModelChange: (tag: string) => void;
	onModelToggle: (tag: string) => void;
	onModeChange: (mode: MultiModelMode) => void;
	onLayoutChange: (mode: LayoutMode) => void;
	onCompareGroupSelect: (groupId?: string) => void;
	onOpenGroupManager: () => void;
}

export const MultiModelSelector = ({
	providers,
	selectedModelId,
	selectedModels,
	multiModelMode,
	layoutMode,
	compareGroups,
	activeCompareGroupId,
	onSingleModelChange,
	onModelToggle,
	onModeChange,
	onLayoutChange,
	onCompareGroupSelect,
	onOpenGroupManager,
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
				</div>
			</div>
		</div>
	);
};
