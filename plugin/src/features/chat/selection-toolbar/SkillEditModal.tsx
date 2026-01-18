import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { App, Notice, TFile } from 'obsidian';
import { X, FileText, Heart } from 'lucide-react';
import type { Skill } from '../types/chat';
import type { ProviderSettings } from '../../tars/providers';
import { localInstance } from 'src/i18n/locals';
import { v4 as uuidv4 } from 'uuid';
import './SkillEditModal.css';

interface SkillEditModalProps {
	app: App;
	visible: boolean;
	skill?: Skill; // 如果是编辑模式则提供
	existingSkillNames: string[]; // 现有技能名称列表，用于验证重复
	promptTemplateFolder: string;
	providers: ProviderSettings[]; // 可用的AI模型列表
	onSave: (skill: Skill) => void;
	onClose: () => void;
}

export const SkillEditModal = ({
	app,
	visible,
	skill,
	existingSkillNames,
	promptTemplateFolder,
	providers,
	onSave,
	onClose
}: SkillEditModalProps) => {
	const isEditMode = !!skill;
	
	// 表单状态
	const [name, setName] = useState(skill?.name || '');
	const [prompt, setPrompt] = useState(skill?.prompt || '');
	const [modelTag, setModelTag] = useState(skill?.modelTag ?? '');
	const [showInToolbar, setShowInToolbar] = useState(skill?.showInToolbar ?? true);
	const [useDefaultSystemPrompt, setUseDefaultSystemPrompt] = useState(skill?.useDefaultSystemPrompt ?? true);
	const [errors, setErrors] = useState<{ name?: string; prompt?: string }>({});
	
	const nameInputRef = useRef<HTMLInputElement>(null);
	const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

	// 重置表单
	useEffect(() => {
		if (visible) {
			setName(skill?.name || '');
			setPrompt(skill?.prompt || '');
			setModelTag(skill?.modelTag ?? '');
			setShowInToolbar(skill?.showInToolbar ?? true);
			setUseDefaultSystemPrompt(skill?.useDefaultSystemPrompt ?? true);
			setErrors({});

			// 自动聚焦到名称输入框
			setTimeout(() => {
				nameInputRef.current?.focus();
			}, 100);
		}
	}, [visible, skill]);

	// 验证表单
	const validateForm = useCallback(() => {
		const newErrors: { name?: string; prompt?: string } = {};
		
		// 验证名称
		if (!name.trim()) {
			newErrors.name = localInstance.skill_edit_name_required || '技能名称不能为空';
		} else if (name.length > 20) {
			newErrors.name = localInstance.skill_edit_name_too_long || '技能名称不能超过20个字符';
		} else {
			// 检查名称重复（编辑模式下排除自己）
			const otherNames = isEditMode
				? existingSkillNames.filter(n => n !== skill?.name)
				: existingSkillNames;
			if (otherNames.includes(name.trim())) {
				newErrors.name = localInstance.skill_edit_name_duplicate || '技能名称已存在';
			}
		}
		
		// 验证提示词
		if (!prompt.trim()) {
			newErrors.prompt = localInstance.skill_edit_prompt_required || '提示词内容不能为空';
		}
		
		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	}, [name, prompt, existingSkillNames, isEditMode, skill]);

	// 处理保存
	const handleSave = useCallback(() => {
		if (!validateForm()) {
			return;
		}

		const now = Date.now();
		const savedSkill: Skill = {
			id: skill?.id || uuidv4(),
			name: name.trim(),
			prompt: prompt.trim(),
			promptSource: 'custom',
			modelTag: modelTag || undefined,
			showInToolbar,
			useDefaultSystemPrompt,
			order: skill?.order ?? existingSkillNames.length,
			createdAt: skill?.createdAt || now,
			updatedAt: now
		};

		onSave(savedSkill);
		new Notice(
			isEditMode
				? (localInstance.skill_edit_updated || '技能已更新')
				: (localInstance.skill_edit_created || '技能已创建')
		);
	}, [name, prompt, showInToolbar, useDefaultSystemPrompt, skill, existingSkillNames.length, validateForm, onSave, isEditMode]);

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
		<div className="skill-edit-modal-overlay" onClick={onClose}>
			<div className="skill-edit-modal" onClick={(e) => e.stopPropagation()}>
				{/* 头部 */}
				<div className="skill-edit-modal-header">
					<span className="skill-edit-modal-title">
						{isEditMode
							? (localInstance.skill_edit_title_edit || '编辑技能')
							: (localInstance.skill_edit_title_add || '添加技能')}
					</span>
					<button
						className="skill-edit-modal-close"
						onClick={onClose}
						title={localInstance.close || '关闭'}
					>
						<X size={18} />
					</button>
				</div>

				{/* 表单内容 */}
				<div className="skill-edit-modal-body">
					{/* 技能名称 */}
					<div className="skill-edit-field">
						<label className="skill-edit-label">
							{localInstance.skill_edit_name_label || '技能名称和图标'}
							<span className="skill-edit-required">*</span>
						</label>
						<div className="skill-edit-name-row">
							<input
								ref={nameInputRef}
								type="text"
								className={`skill-edit-input ${errors.name ? 'skill-edit-input-error' : ''}`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={localInstance.skill_edit_name_placeholder || '在这里命名你的技能...'}
								maxLength={20}
							/>
							<span className="skill-edit-name-counter">{name.length}/20</span>
							<button
								className="skill-edit-icon-btn"
								title={localInstance.skill_edit_select_icon || '选择图标'}
							>
								<Heart size={18} />
							</button>
						</div>
						{errors.name && (
							<span className="skill-edit-error">{errors.name}</span>
						)}
					</div>

					{/* 提示词内容 */}
					<div className="skill-edit-field">
						<label className="skill-edit-label">
							{localInstance.skill_edit_prompt_label || '提示词内容'}
							<span className="skill-edit-required">*</span>
						</label>
						<div className="skill-edit-prompt-hint">
							{localInstance.skill_edit_prompt_hint || '使用特殊符串 {selection}代表划词选中的文字。'}
							<button
								className="skill-edit-link-btn"
								onClick={handleInsertTemplate}
							>
								{localInstance.skill_edit_show_example || '示例'}
							</button>
						</div>
						<textarea
							ref={promptTextareaRef}
							className={`skill-edit-textarea ${errors.prompt ? 'skill-edit-input-error' : ''}`}
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder={localInstance.skill_edit_prompt_placeholder || '在此输入或粘贴你的提示词。'}
							rows={8}
						/>
						{errors.prompt && (
							<span className="skill-edit-error">{errors.prompt}</span>
						)}
					</div>

					{/* 使用默认系统提示词设置 */}
					<div className="skill-edit-field">
						<label className="skill-edit-label">
							{localInstance.skill_edit_use_default_system_prompt || '使用默认系统提示词'}
						</label>
						<div className="skill-edit-checkbox-row">
							<input
								type="checkbox"
								id="useDefaultSystemPrompt"
								checked={useDefaultSystemPrompt}
								onChange={(e) => setUseDefaultSystemPrompt(e.target.checked)}
								className="skill-edit-checkbox"
							/>
							<label htmlFor="useDefaultSystemPrompt" className="skill-edit-checkbox-label">
								{localInstance.skill_edit_use_default_system_prompt_hint || '启用后将使用全局系统提示词，禁用则仅使用自定义提示词内容'}
							</label>
						</div>
					</div>

					{/* AI模型选择 */}
					<div className="skill-edit-field">
						<label className="skill-edit-label">
							{localInstance.skill_edit_model_label || 'AI 模型'}
						</label>
						<select
							className="skill-edit-select"
							value={modelTag ?? ''}
							onChange={(e) => setModelTag(e.target.value)}
						>
							<option value="">
								{localInstance.skill_edit_model_default || '使用默认模型'}
							</option>
							<option value="__EXEC_TIME__">
								{localInstance.skill_edit_model_exec_time || '执行时选择模型'}
							</option>
							{providers.map(provider => (
								<option key={provider.tag} value={provider.tag}>
									{provider.tag}
								</option>
							))}
						</select>
						<div className="skill-edit-model-hint">
							{localInstance.skill_edit_model_hint || '选择执行此技能时使用的 AI 模型'}
						</div>
					</div>
				</div>

				{/* 底部操作栏 */}
				<div className="skill-edit-modal-footer">
					<button
						className="skill-edit-btn skill-edit-btn-secondary"
						onClick={onClose}
					>
						{localInstance.cancel || '取消'}
					</button>
					<button
						className="skill-edit-btn skill-edit-btn-primary"
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

export default SkillEditModal;
