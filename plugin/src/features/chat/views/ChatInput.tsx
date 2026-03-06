import { CornerDownLeft, StopCircle, X, FileText, Folder, Palette, Zap, Highlighter, RotateCw } from 'lucide-react';
import { FormEvent, useEffect, useState, useRef, Fragment, useMemo, lazy, Suspense } from 'react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import type { CompareGroup, CollaborationTemplate } from '../types/multiModel';
import { MultiModelSelector } from '../components/MultiModelSelector';
import { TemplateSelector } from '../components/TemplateSelector';
import { ModelTag } from '../components/ModelTag';
import { App } from 'obsidian';
import { localInstance } from 'src/i18n/locals';
import { availableVendors } from 'src/features/tars/settings';

interface ChatInputProps {
	service: ChatService;
	state: ChatState;
	app: App;
}

const CompareGroupManagerDialog = lazy(async () => import('../components/CompareGroupManagerDialog').then((module) => ({
	default: module.CompareGroupManagerDialog
})));
const CollabTemplateManagerDialog = lazy(async () => import('../components/CollabTemplateManagerDialog').then((module) => ({
	default: module.CollabTemplateManagerDialog
})));

export const ChatInput = ({ service, state, app }: ChatInputProps) => {
	const [value, setValue] = useState(state.inputValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [maxHeight, setMaxHeight] = useState(80);

	const [isImageGenerationIntent, setIsImageGenerationIntent] = useState(false);
	const [compareGroups, setCompareGroups] = useState<CompareGroup[]>([]);
	const [collaborationTemplates, setCollaborationTemplates] = useState<CollaborationTemplate[]>([]);
	const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
	const [showGroupManager, setShowGroupManager] = useState(false);
	const [showTemplateManager, setShowTemplateManager] = useState(false);
	const isMultiModel = state.multiModelMode !== 'single';

	useEffect(() => {
		setIsImageGenerationIntent(service.detectImageGenerationIntent(value));
	}, [service, value]);

	useEffect(() => {
		const calculateMaxHeight = () => {
			const viewportHeight = window.innerHeight;
			setMaxHeight(Math.floor(viewportHeight / 4));
		};
		calculateMaxHeight();
		window.addEventListener('resize', calculateMaxHeight);
		return () => window.removeEventListener('resize', calculateMaxHeight);
	}, []);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = 'auto';
			const newHeight = Math.min(textarea.scrollHeight, maxHeight);
			textarea.style.height = `${newHeight}px`;
		}
	}, [value, maxHeight]);

	useEffect(() => {
		setValue(state.inputValue);
	}, [state.inputValue]);

	// 加载多模型配置
	useEffect(() => {
		const loadConfigs = async () => {
			setIsLoadingConfigs(true);
			const groups = await service.loadCompareGroups();
			setCompareGroups(groups);
			const templates = await service.loadCollaborationTemplates();
			setCollaborationTemplates(templates);
			setIsLoadingConfigs(false);
		};
		void loadConfigs();
		const unwatch = service.watchMultiModelConfigs?.(() => { void loadConfigs(); });
		return () => { unwatch?.(); };
	}, [service]);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (showGroupManager) {
					setShowGroupManager(false);
					return;
				}
				if (showTemplateManager) {
					setShowTemplateManager(false);
					return;
				}
			}

			if (!isMultiModel || (!event.ctrlKey && !event.metaKey)) {
				return;
			}

			if (event.key === '1') {
				event.preventDefault();
				service.setLayoutMode('horizontal');
			} else if (event.key === '2') {
				event.preventDefault();
				service.setLayoutMode('tabs');
			} else if (event.key === '3') {
				event.preventDefault();
				service.setLayoutMode('vertical');
			}
		};
		window.addEventListener('keydown', handleShortcut);
		return () => window.removeEventListener('keydown', handleShortcut);
	}, [isMultiModel, service, showGroupManager, showTemplateManager]);

	const handleSubmit = async (event?: FormEvent) => {
		event?.preventDefault();
		await service.sendMessage(value);
	};

	const handleRemoveImage = (image: string) => service.removeSelectedImage(image);
	const handleRemoveFile = (fileId: string) => service.removeSelectedFile(fileId);
	const handleRemoveFolder = (folderId: string) => service.removeSelectedFolder(folderId);
	const handleClearSelectedText = () => service.clearSelectedText();

	const handleTemplateSelect = async (templatePath: string) => {
		await service.selectPromptTemplate(templatePath);
		textareaRef.current?.focus();
	};
	const handleTemplateSelectorClose = () => service.setTemplateSelectorVisibility(false);
	const handleClearTemplate = () => service.clearSelectedPromptTemplate();

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSubmit();
		}
	};

	// 多模型生成进度统计
	const multiModelProgress = useMemo(() => {
		if (!state.parallelResponses || !isMultiModel) return null;
		const total = state.parallelResponses.responses.length;
		const completed = state.parallelResponses.responses.filter((r) => r.isComplete).length;
		const errors = state.parallelResponses.responses.filter((r) => r.isError).length;
		const generating = total - completed - errors;
		return { total, completed, errors, generating };
	}, [state.parallelResponses, isMultiModel]);

	const providers = service.getProviders();

	// 共享的模板/文本标签组件
	const renderInfoTags = () => (
		<>
			{state.selectedPromptTemplate && (
				<div className="selected-template tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs tw-mb-2">
					<Zap className="tw-size-3 tw-flex-shrink-0" />
					<span className="tw-max-w-40 tw-truncate" title={state.selectedPromptTemplate.name}>
						{localInstance.template_label || '模板'}: {state.selectedPromptTemplate.name}
					</span>
					<button
						type="button"
						className="tw-ml-1 tw-p-0 tw-text-purple-700 hover:tw-text-purple-900 tw-cursor-pointer"
						onClick={(e) => { e.stopPropagation(); handleClearTemplate(); }}
						title={localInstance.clear_template || '清除模板'}
					>
						<X className="tw-size-4" />
					</button>
				</div>
			)}
			{state.selectedText && (
				<div className="selected-text tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-orange-100 tw-text-orange-700 tw-rounded tw-text-xs tw-mb-2">
					<Highlighter className="tw-size-3 tw-flex-shrink-0" />
					<span className="tw-max-w-60 tw-truncate" title={state.selectedText}>
						{state.selectedText.length > 50 ? state.selectedText.substring(0, 50) + '...' : state.selectedText}
					</span>
					<button
						type="button"
						className="tw-ml-1 tw-p-0 tw-text-orange-700 hover:tw-text-orange-900 tw-cursor-pointer"
						onClick={(e) => { e.stopPropagation(); handleClearSelectedText(); }}
						title={localInstance.clear_selected_text || '清除选中文本'}
					>
						<X className="tw-size-4" />
					</button>
				</div>
			)}
		</>
	);

	// 共享的图片预览
	const renderImagePreview = () => (
		state.selectedImages.length > 0 ? (
			<div className="selected-images tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
				{state.selectedImages.map((image, index) => (
					<div key={image} className="image-preview-container tw-relative">
						<img src={image} alt={`selected-${index}`}
							className="selected-image-preview tw-w-16 tw-h-16 tw-object-cover tw-rounded tw-border tw-border-gray-300" />
						<button type="button"
							className="remove-image-button tw-absolute tw-top-0 tw-right-0 tw-bg-red-500 tw-text-white tw-rounded-full tw-w-4 tw-h-4 tw-flex tw-items-center tw-justify-center tw-text-xs tw-cursor-pointer hover:tw-bg-red-600"
							onClick={() => handleRemoveImage(image)}>
							<X className="tw-size-3" />
						</button>
					</div>
				))}
			</div>
		) : null
	);

	// 共享的文件标签
	const renderFileTags = () => (
		(state.selectedFiles.length > 0 || state.selectedFolders.length > 0) ? (
			<div className="selected-files tw-flex tw-flex-wrap tw-gap-2 tw-mb-2">
				{state.selectedFiles.map((file) => (
					<div key={file.id}
						className={`file-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-rounded tw-text-xs tw-relative group ${
							file.isAutoAdded ? 'tw-bg-green-100 tw-text-green-700' : 'tw-bg-gray-100 tw-text-gray-700'
						}`}>
						<FileText className="tw-size-3 tw-flex-shrink-0" />
						<span className="tw-max-w-40 tw-truncate" title={file.path}>
							{file.name}
							{file.isAutoAdded && <span className="ml-1 tw-px-1 tw-bg-green-600 tw-text-white tw-rounded tw-text-[10px]">活跃</span>}
							{file.extension === 'pdf' && <span className="ml-1 tw-px-1 tw-bg-blue-500 tw-text-white tw-rounded tw-text-[10px]">pdf</span>}
							{file.extension === 'canvas' && <span className="ml-1 tw-px-1 tw-bg-green-500 tw-text-white tw-rounded tw-text-[10px]">canvas</span>}
						</span>
						<button type="button" className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
							onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.id); }} title={localInstance.delete_file || '删除文件'}>
							<X className="tw-size-4" />
						</button>
					</div>
				))}
				{state.selectedFolders.map((folder) => (
					<div key={folder.id} className="folder-tag tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-blue-100 tw-text-blue-700 tw-rounded tw-text-xs tw-relative group">
						<Folder className="tw-size-3 tw-flex-shrink-0" />
						<span className="tw-max-w-40 tw-truncate" title={folder.path}>{folder.name || folder.path}</span>
						<button type="button" className="tw-ml-1 tw-p-0 tw-text-muted hover:tw-text-foreground tw-cursor-pointer"
							onClick={(e) => { e.stopPropagation(); handleRemoveFolder(folder.id); }} title={localInstance.delete_folder || '删除文件夹'}>
							<X className="tw-size-4" />
						</button>
					</div>
				))}
			</div>
		) : null
	);

	// 模型选择器区域
	const renderModelSelector = () => (
		isLoadingConfigs ? (
			<div className="parallel-response-skeleton" style={{ width: '180px', height: '26px' }} />
		) : (
		<MultiModelSelector
			providers={providers}
			selectedModelId={state.selectedModelId ?? ''}
			selectedModels={state.selectedModels}
			multiModelMode={state.multiModelMode}
			layoutMode={state.layoutMode}
			compareGroups={compareGroups}
			collaborationTemplates={collaborationTemplates}
			activeCompareGroupId={state.activeCompareGroupId}
			activeCollaborationTemplateId={state.activeCollaborationTemplateId}
			onSingleModelChange={(modelId) => service.setModel(modelId)}
			onModelToggle={(tag) => {
				if (state.selectedModels.includes(tag)) {
					service.removeSelectedModel(tag);
				} else {
					service.addSelectedModel(tag);
				}
			}}
			onModeChange={(mode) => service.setMultiModelMode(mode)}
			onLayoutChange={(mode) => service.setLayoutMode(mode)}
			onCompareGroupSelect={(groupId) => {
				service.setActiveCompareGroup(groupId);
				if (groupId) {
					const group = compareGroups.find((g) => g.id === groupId);
					if (group) service.setSelectedModels(group.modelTags);
				}
			}}
			onCollaborationTemplateSelect={(templateId) => service.setActiveCollaborationTemplate(templateId)}
			onOpenGroupManager={() => setShowGroupManager(true)}
			onOpenTemplateManager={() => setShowTemplateManager(true)}
		/>
		)
	);

	// 多模型已选模型提示（对比模式下显示在输入框上方）
	const renderSelectedModelsHint = () => {
		if (state.multiModelMode === 'compare' && state.selectedModels.length > 0) {
			return (
				<div className="tw-flex tw-flex-wrap tw-gap-1 tw-mb-1">
					{state.selectedModels.map((tag) => {
						const p = providers.find((prov) => prov.tag === tag);
						const vendorName = p ? availableVendors.find((v) => v.name === p.vendor)?.name : undefined;
						return (
							<ModelTag
								key={tag}
								modelTag={tag}
								vendor={vendorName}
								size="sm"
								onClick={() => service.removeSelectedModel(tag)}
							/>
						);
					})}
				</div>
			);
		}
		if (state.multiModelMode === 'compare' && state.selectedModels.length === 0) {
			return (
				<div className="tw-text-xs tw-text-muted tw-mb-1">
					{localInstance.no_models_selected || '请至少选择一个模型'}
				</div>
			);
		}
		if (state.multiModelMode === 'collaborate' && state.activeCollaborationTemplateId) {
			const tpl = collaborationTemplates.find((t) => t.id === state.activeCollaborationTemplateId);
			if (tpl) {
				return (
					<div className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-rounded tw-text-xs tw-mb-1"
						style={{ backgroundColor: 'var(--background-modifier-hover)', color: 'var(--text-muted)' }}>
						{(localInstance.collaboration_template_summary || '协作模板: {name}（{count} 步）')
							.replace('{name}', tpl.name)
							.replace('{count}', String(tpl.steps.length))}
					</div>
				);
			}
		}
		if (state.multiModelMode === 'collaborate') {
			return (
				<div className="tw-text-xs tw-text-muted tw-mb-1">
					{localInstance.select_or_create_collaboration_template || '请选择协作模板或创建新模板'}
				</div>
			);
		}
		return null;
	};

	return (
		<Fragment>
			<form className="chat-input tw-flex tw-w-full tw-flex-col tw-gap-2 tw-p-2" style={{
				border: '1px solid var(--background-modifier-border)',
				borderRadius: 'var(--radius-m)'
			}} onSubmit={handleSubmit}>
				{renderInfoTags()}

				{/* 多模型已选模型提示 */}
				{!state.isGenerating && isMultiModel && renderSelectedModelsHint()}

				{!state.isGenerating ? (
					<>
						<textarea
							ref={textareaRef}
							className="tw-w-full tw-resize-none tw-p-3 tw-text-sm"
							style={{
								border: 'none', outline: 'none', background: 'transparent',
								resize: 'none', minHeight: '80px', maxHeight: `${maxHeight}px`,
								borderRadius: '0', boxShadow: 'none', marginBottom: '0', overflowY: 'auto'
							}}
							value={value}
							onChange={(event) => { setValue(event.target.value); service.setInputValue(event.target.value); }}
							onKeyDown={handleKeyDown}
							placeholder={localInstance.input_description_here || '输入消息，按 Enter 发送，Shift+Enter 换行'}
						/>
						{renderImagePreview()}
						{renderFileTags()}
						<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
							<div className="tw-flex tw-items-center tw-gap-2" style={{ flex: 1, minWidth: 0 }}>
								{renderModelSelector()}
							</div>
							<div className="tw-flex tw-items-center tw-gap-2">
								<span
									onClick={(e) => { e.preventDefault(); handleSubmit(); }}
									className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center"
									aria-label={state.activeSession?.messages.some((msg) => msg.role !== 'system') ? 'Chat' : 'Save'}
								>
									<CornerDownLeft className="tw-size-4" />
									<span className="tw-ml-1 tw-text-xs">{state.activeSession?.messages.some((msg) => msg.role !== 'system') ? 'Chat' : 'Save'}</span>
								</span>
							</div>
						</div>
					</>
				) : (
					<>
						<textarea
							ref={textareaRef}
							className="tw-w-full tw-resize-none tw-p-3 tw-text-sm"
							style={{
								border: 'none', outline: 'none', background: 'transparent',
								resize: 'none', minHeight: '80px', maxHeight: `${maxHeight}px`,
								borderRadius: '0', boxShadow: 'none', marginBottom: '0', overflowY: 'auto'
							}}
							value={value}
							onChange={(event) => { setValue(event.target.value); service.setInputValue(event.target.value); }}
							onKeyDown={handleKeyDown}
							placeholder={localInstance.input_description_here || '输入消息，按 Enter 发送，Shift+Enter 换行'}
							disabled={state.isGenerating}
						/>
						{renderImagePreview()}
						{renderFileTags()}
						<div className="tw-flex tw-items-center tw-justify-between tw-mt-0">
							<div className="tw-flex tw-items-center tw-gap-2" style={{ flex: 1, minWidth: 0 }}>
								{renderModelSelector()}
							</div>
							<div className="tw-flex tw-items-center tw-gap-2">
								{/* 停止控制 */}
								{isMultiModel && multiModelProgress ? (
									<div className="multi-model-stop-bar tw-flex tw-items-center tw-gap-2">
										{multiModelProgress.generating > 0 && (
											<span className="tw-text-xs tw-text-muted">
												{(localInstance.generating_progress || '{completed}/{total} 生成中')
													.replace('{completed}', String(multiModelProgress.completed + multiModelProgress.errors))
													.replace('{total}', String(multiModelProgress.total))}
											</span>
										)}
										<span
											onClick={() => service.stopAllGeneration()}
											className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center"
											aria-label={localInstance.stop_all || '停止所有'}
										>
											<StopCircle className="tw-size-4" />
											<span className="tw-ml-1 tw-text-xs">{localInstance.stop_all || '停止所有'}</span>
										</span>
										{multiModelProgress.errors > 0 && (
											<span
												onClick={() => service.retryAllFailed()}
												className="tw-cursor-pointer tw-flex tw-items-center"
												style={{ color: 'var(--text-error, #dc2626)' }}
												aria-label={localInstance.retry_failed || '重试失败'}
											>
												<RotateCw style={{ width: 14, height: 14 }} />
												<span className="tw-ml-1 tw-text-xs">{localInstance.retry_failed || '重试失败'}({multiModelProgress.errors})</span>
											</span>
										)}
									</div>
								) : (
									<span
										onClick={() => service.stopGeneration()}
										className="tw-cursor-pointer tw-text-muted hover:tw-text-accent tw-flex tw-items-center"
										aria-label="Stop"
									>
										<StopCircle className="tw-size-4" />
										<span className="tw-ml-1 tw-text-xs">Stop</span>
									</span>
								)}

								{isImageGenerationIntent && (
									<div className="tw-flex tw-items-center tw-gap-1 tw-ml-2 tw-px-2 tw-py-1 tw-bg-purple-100 tw-text-purple-700 tw-rounded tw-text-xs">
										<Palette className="tw-size-3" />
										<span>{localInstance.image_generation_mode || '图片生成模式'}</span>
									</div>
								)}
							</div>
						</div>
					</>
				)}
			</form>

			{/* 模板选择器 */}
			<TemplateSelector
				visible={state.showTemplateSelector}
				onSelect={handleTemplateSelect}
				onClose={handleTemplateSelectorClose}
				inputValue={value}
			/>

			{/* 管理弹窗 */}
			<Suspense fallback={null}>
				{showGroupManager && (
					<CompareGroupManagerDialog
						isOpen={showGroupManager}
						onClose={() => setShowGroupManager(false)}
						service={service}
						providers={providers}
					/>
				)}
				{showTemplateManager && (
					<CollabTemplateManagerDialog
						isOpen={showTemplateManager}
						onClose={() => setShowTemplateManager(false)}
						service={service}
						providers={providers}
					/>
				)}
			</Suspense>
		</Fragment>
	);
};
