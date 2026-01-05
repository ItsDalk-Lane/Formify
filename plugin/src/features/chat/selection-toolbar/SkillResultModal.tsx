import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { App, Notice, MarkdownRenderer, Component, MarkdownView } from 'obsidian';
import { X, Copy, Replace, Plus, RefreshCw, Check } from 'lucide-react';
import type { Skill } from '../types/chat';
import { localInstance } from 'src/i18n/locals';
import './SkillResultModal.css';

interface SkillResultModalProps {
	app: App;
	visible: boolean;
	skill: Skill;
	selection: string;
	result: string;
	isLoading: boolean;
	error?: string;
	onClose: () => void;
	onRegenerate: () => void;
	onInsert: (mode: 'replace' | 'append' | 'insert') => void;
	onCopy: () => void;
}

export const SkillResultModal = ({
	app,
	visible,
	skill,
	selection,
	result,
	isLoading,
	error,
	onClose,
	onRegenerate,
	onInsert,
	onCopy
}: SkillResultModalProps) => {
	const [copySuccess, setCopySuccess] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef<Component | null>(null);

	// 处理复制
	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(result);
			setCopySuccess(true);
			new Notice(localInstance.copy_success || '复制成功');
			setTimeout(() => setCopySuccess(false), 2000);
			onCopy();
		} catch (e) {
			new Notice(localInstance.copy_failed || '复制失败');
		}
	}, [result, onCopy]);

	// 处理替换选中文本
	const handleReplace = useCallback(() => {
		onInsert('replace');
	}, [onInsert]);

	// 处理追加到选中文本后
	const handleAppend = useCallback(() => {
		onInsert('append');
	}, [onInsert]);

	// 处理插入到光标位置
	const handleInsertAtCursor = useCallback(() => {
		onInsert('insert');
	}, [onInsert]);

	// 渲染 Markdown 内容（流式输出时也实时渲染）
	useEffect(() => {
		if (!contentRef.current || !result) {
			return;
		}

		// 清空之前的内容
		contentRef.current.innerHTML = '';

		// 创建组件实例用于渲染
		if (!componentRef.current) {
			componentRef.current = new Component();
			componentRef.current.load();
		}

		// 使用 Obsidian 的 Markdown 渲染器
		MarkdownRenderer.render(
			app,
			result,
			contentRef.current,
			'',
			componentRef.current
		);

		// 仅在组件卸载时清理
	}, [app, result]);

	// 组件卸载时清理
	useEffect(() => {
		return () => {
			if (componentRef.current) {
				componentRef.current.unload();
				componentRef.current = null;
			}
		};
	}, []);

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
		<div className="skill-result-modal-overlay" onClick={onClose}>
			<div className="skill-result-modal" onClick={(e) => e.stopPropagation()}>
				{/* 头部 */}
				<div className="skill-result-modal-header">
					<div className="skill-result-modal-title">
						<span className="skill-result-modal-skill-name">{skill.name}</span>
						{isLoading && (
							<span className="skill-result-modal-loading">
								{localInstance.handling || '处理中...'}
							</span>
						)}
					</div>
					<button
						className="skill-result-modal-close"
						onClick={onClose}
						title={localInstance.close || '关闭'}
					>
						<X size={18} />
					</button>
				</div>

				{/* 内容区域 */}
				<div className="skill-result-modal-body">
					{error ? (
						<div className="skill-result-modal-error">
							<span className="skill-result-modal-error-icon">⚠️</span>
							<span>{error}</span>
						</div>
					) : (isLoading && !result) ? (
						<div className="skill-result-modal-loading-content">
							<div className="skill-result-modal-spinner" />
							<span>{localInstance.ai_executing || 'AI处理中...'}</span>
						</div>
					) : (
						<>
							<div
								ref={contentRef}
								className="skill-result-modal-content markdown-preview-view"
							/>
							{isLoading && (
								<div className="skill-result-modal-streaming-indicator">
									<span className="skill-result-modal-streaming-dot" />
									<span>{localInstance.ai_streaming_generating || '生成中...'}</span>
								</div>
							)}
						</>
					)}
				</div>

				{/* 底部操作栏 */}
				<div className="skill-result-modal-footer">
					<div className="skill-result-modal-actions-left">
						<button
							className="skill-result-modal-btn"
							onClick={onRegenerate}
							disabled={isLoading}
							title={localInstance.skill_result_regenerate || '重新生成'}
						>
							<RefreshCw size={14} />
							<span>{localInstance.skill_result_regenerate || '重新生成'}</span>
						</button>
					</div>
					
					<div className="skill-result-modal-actions-right">
						<button
							className="skill-result-modal-btn"
							onClick={handleCopy}
							disabled={isLoading || !result}
							title={localInstance.copy || '复制'}
						>
							{copySuccess ? <Check size={14} /> : <Copy size={14} />}
							<span>{copySuccess ? (localInstance.copy_success || '已复制') : (localInstance.copy || '复制')}</span>
						</button>
						
						<button
							className="skill-result-modal-btn"
							onClick={handleAppend}
							disabled={isLoading || !result}
							title={localInstance.skill_result_append || '追加到选中内容'}
						>
							<Plus size={14} />
							<span>{localInstance.skill_result_append || '追加'}</span>
						</button>
						
						<button
							className="skill-result-modal-btn skill-result-modal-btn-primary"
							onClick={handleReplace}
							disabled={isLoading || !result}
							title={localInstance.skill_result_replace || '替换选中文本'}
						>
							<Replace size={14} />
							<span>{localInstance.skill_result_replace || '替换'}</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
};

export default SkillResultModal;
