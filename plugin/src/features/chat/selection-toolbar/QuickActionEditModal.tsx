import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { App, Notice } from 'obsidian';
import { X, Heart } from 'lucide-react';
import type { QuickAction } from '../types/chat';
import type { ProviderSettings } from '../../tars/providers';
import { localInstance } from 'src/i18n/locals';
import { v4 as uuidv4 } from 'uuid';
import './QuickActionEditModal.css';

interface QuickActionEditModalProps {
	app: App;
	visible: boolean;
	quickAction?: QuickAction; // 如果是编辑模式则提供
	existingQuickActionNames: string[]; // 现有操作名称列表，用于验证重复
	promptTemplateFolder: string;
	providers: ProviderSettings[]; // 可用的AI模型列表
	onSave: (quickAction: QuickAction) => void;
	onClose: () => void;
}

export const QuickActionEditModal = ({
	app,
	visible,
	quickAction,
	existingQuickActionNames,
	promptTemplateFolder,
	providers,
	onSave,
	onClose
}: QuickActionEditModalProps) => {
	const isEditMode = !!quickAction;
	
	// 表单状态
	const [name, setName] = useState(quickAction?.name || '');
	const [prompt, setPrompt] = useState(quickAction?.prompt || '');
	const [modelTag, setModelTag] = useState(quickAction?.modelTag ?? '');
	const [showInToolbar, setShowInToolbar] = useState(quickAction?.showInToolbar ?? true);
	const [useDefaultSystemPrompt, setUseDefaultSystemPrompt] = useState(quickAction?.useDefaultSystemPrompt ?? true);
	const [errors, setErrors] = useState<{ name?: string; prompt?: string }>({});
	
	const nameInputRef = useRef<HTMLInputElement>(null);
	const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

	// 重置表单
	useEffect(() => {
		if (visible) {
			setName(quickAction?.name || '');
			setPrompt(quickAction?.prompt || '');
			setModelTag(quickAction?.modelTag ?? '');
			setShowInToolbar(quickAction?.showInToolbar ?? true);
			setUseDefaultSystemPrompt(quickAction?.useDefaultSystemPrompt ?? true);
			setErrors({});

			// 自动聚焦到名称输入框
			setTimeout(() => {
				nameInputRef.current?.focus();
			}, 100);
		}
	}, [visible, quickAction]);

	// 验证表单
	const validateForm = useCallback(() => {
		const newErrors: { name?: string; prompt?: string } = {};
		
		// 验证名称
		if (!name.trim()) {
			newErrors.name = localInstance.quick_action_edit_name_required || '操作名称不能为空';
		} else if (name.length > 20) {
			newErrors.name = localInstance.quick_action_edit_name_too_long || '操作名称不能超过20个字符';
		} else {
			// 检查名称重复（编辑模式下排除自己）
			const otherNames = isEditMode
				? existingQuickActionNames.filter(n => n !== quickAction?.name)
				: existingQuickActionNames;
			if (otherNames.includes(name.trim())) {
				newErrors.name = localInstance.quick_action_edit_name_duplicate || '操作名称已存在';
			}
		}
		
		// 验证提示词
		if (!prompt.trim()) {
			newErrors.prompt = localInstance.quick_action_edit_prompt_required || '提示词内容不能为空';
		}
		
		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	}, [name, prompt, existingQuickActionNames, isEditMode, quickAction]);

	// 处理保存
	const handleSave = useCallback(() => {
		if (!validateForm()) {
			return;
		}

		const now = Date.now();
		const savedQuickAction: QuickAction = {
			id: quickAction?.id || uuidv4(),
			name: name.trim(),
			prompt: prompt.trim(),
			promptSource: 'custom',
			modelTag: modelTag || undefined,
			showInToolbar,
			useDefaultSystemPrompt,
			order: quickAction?.order ?? existingQuickActionNames.length,
			createdAt: quickAction?.createdAt || now,
			updatedAt: now
		};

		onSave(savedQuickAction);
		new Notice(
			isEditMode
				? (localInstance.quick_action_edit_updated || '操作已更新')
				: (localInstance.quick_action_edit_created || '操作已创建')
		);
	}, [name, prompt, showInToolbar, useDefaultSystemPrompt, quickAction, existingQuickActionNames.length, validateForm, onSave, isEditMode]);

	// 插入模板引用
	const handleInsertTemplate = useCallback(async () => {
		// 获取提示词模板目录下的文件
		const files = app.vault.getMarkdownFiles().filter(f => 
			f.path.startsWith(promptTemplateFolder + '/') || f.path === promptTemplateFolder
		);
		
		if (files.length === 0) {
			new Notice(localInstance.ai_template_folder_empty || '模板文件夹为空');
			return;
		}
		
		// 简单选择第一个文件作为示例（实际应该弹出选择器）
		// 这里先插入占位符语法提示
		const templateSyntax = '{{template:模板文件名}}';
		
		if (promptTextareaRef.current) {
			const textarea = promptTextareaRef.current;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const newPrompt = prompt.substring(0, start) + templateSyntax + prompt.substring(end);
			setPrompt(newPrompt);
			
			// 选中模板文件名部分以便用户修改
			setTimeout(() => {
				textarea.focus();
				textarea.setSelectionRange(start + 11, start + 16);
			}, 0);
		} else {
			setPrompt(prompt + (prompt ? '\n' : '') + templateSyntax);
		}
	}, [app, promptTemplateFolder, prompt]);

	// 处理 ESC 键关闭
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};

		if (visible) {
			document.addEventListener('keydown', handleKeyDown);
			return () => document.removeEventListener('keydown', handleKeyDown);
		}
	}, [visible, onClose]);

	if (!visible) {
		return null;
	}

	const modalContent = (
		<div className="quick-action-edit-modal-overlay" onClick={onClose}>
			<div className="quick-action-edit-modal" onClick={(e) => e.stopPropagation()}>
				{/* 头部 */}
				<div className="quick-action-edit-modal-header">
					<span className="quick-action-edit-modal-title">
						{isEditMode
							? (localInstance.quick_action_edit_title_edit || '编辑操作')
							: (localInstance.quick_action_edit_title_add || '添加操作')}
					</span>
					<button
						className="quick-action-edit-modal-close"
						onClick={onClose}
						title={localInstance.close || '关闭'}
					>
						<X size={18} />
					</button>
				</div>

				{/* 表单内容 */}
				<div className="quick-action-edit-modal-body">
					{/* 操作名称 */}
					<div className="quick-action-edit-field">
						<label className="quick-action-edit-label">
							{localInstance.quick_action_edit_name_label || '操作名称和图标'}
							<span className="quick-action-edit-required">*</span>
						</label>
						<div className="quick-action-edit-name-row">
							<input
								ref={nameInputRef}
								type="text"
								className={`quick-action-edit-input ${errors.name ? 'quick-action-edit-input-error' : ''}`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={localInstance.quick_action_edit_name_placeholder || '在这里命名你的操作...'}
								maxLength={20}
							/>
							<span className="quick-action-edit-name-counter">{name.length}/20</span>
							<button
								className="quick-action-edit-icon-btn"
								title={localInstance.quick_action_edit_select_icon || '选择图标'}
							>
								<Heart size={18} />
							</button>
						</div>
						{errors.name && (
							<span className="quick-action-edit-error">{errors.name}</span>
						)}
					</div>

					{/* 提示词内容 */}
					<div className="quick-action-edit-field">
						<label className="quick-action-edit-label">
							{localInstance.quick_action_edit_prompt_label || '提示词内容'}
							<span className="quick-action-edit-required">*</span>
						</label>
						<div className="quick-action-edit-prompt-hint">
							{localInstance.quick_action_edit_prompt_hint || '使用特殊符串 {selection}代表划词选中的文字。'}
							<button
								className="quick-action-edit-link-btn"
								onClick={handleInsertTemplate}
							>
								{localInstance.quick_action_edit_show_example || '示例'}
							</button>
						</div>
						<textarea
							ref={promptTextareaRef}
							className={`quick-action-edit-textarea ${errors.prompt ? 'quick-action-edit-input-error' : ''}`}
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder={localInstance.quick_action_edit_prompt_placeholder || '在此输入或粘贴你的提示词。'}
							rows={8}
						/>
						{errors.prompt && (
							<span className="quick-action-edit-error">{errors.prompt}</span>
						)}
					</div>

					{/* 使用默认系统提示词设置 */}
					<div className="quick-action-edit-field">
						<label className="quick-action-edit-label">
							{localInstance.quick_action_edit_use_default_system_prompt || '使用默认系统提示词'}
						</label>
						<div className="quick-action-edit-checkbox-row">
							<input
								type="checkbox"
								id="useDefaultSystemPrompt"
								checked={useDefaultSystemPrompt}
								onChange={(e) => setUseDefaultSystemPrompt(e.target.checked)}
								className="quick-action-edit-checkbox"
							/>
							<label htmlFor="useDefaultSystemPrompt" className="quick-action-edit-checkbox-label">
								{localInstance.quick_action_edit_use_default_system_prompt_hint || '启用后将使用全局系统提示词，禁用则仅使用自定义提示词内容'}
							</label>
						</div>
					</div>

					{/* AI模型选择 */}
					<div className="quick-action-edit-field">
						<label className="quick-action-edit-label">
							{localInstance.quick_action_edit_model_label || 'AI 模型'}
						</label>
						<select
							className="quick-action-edit-select"
							value={modelTag ?? ''}
							onChange={(e) => setModelTag(e.target.value)}
						>
							<option value="">
								{localInstance.quick_action_edit_model_default || '使用默认模型'}
							</option>
							<option value="__EXEC_TIME__">
								{localInstance.quick_action_edit_model_exec_time || '执行时选择模型'}
							</option>
							{providers.map(provider => (
								<option key={provider.tag} value={provider.tag}>
									{provider.tag}
								</option>
							))}
						</select>
						<div className="quick-action-edit-model-hint">
							{localInstance.quick_action_edit_model_hint || '选择执行此操作时使用的 AI 模型'}
						</div>
					</div>
				</div>

				{/* 底部操作栏 */}
				<div className="quick-action-edit-modal-footer">
					<button
						className="quick-action-edit-btn quick-action-edit-btn-secondary"
						onClick={onClose}
					>
						{localInstance.cancel || '取消'}
					</button>
					<button
						className="quick-action-edit-btn quick-action-edit-btn-primary"
						onClick={handleSave}
					>
						{localInstance.save || '保存'}
					</button>
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
};

export default QuickActionEditModal;
