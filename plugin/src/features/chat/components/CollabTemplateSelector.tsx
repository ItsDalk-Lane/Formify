import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ArrowRight, Link2, Settings } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { CollaborationTemplate } from '../types/multiModel';
import { localInstance } from 'src/i18n/locals';

interface CollabTemplateSelectorProps {
	collaborationTemplates: CollaborationTemplate[];
	activeCollaborationTemplateId?: string;
	onCollaborationTemplateSelect: (templateId?: string) => void;
	onOpenTemplateManager: () => void;
}

export const CollabTemplateSelector = ({
	collaborationTemplates,
	activeCollaborationTemplateId,
	onCollaborationTemplateSelect,
	onOpenTemplateManager,
}: CollabTemplateSelectorProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const activeTemplate = collaborationTemplates.find((t) => t.id === activeCollaborationTemplateId);

	const handleClickOutside = useCallback((e: MouseEvent) => {
		const target = e.target as Node;
		if (!dropdownRef.current?.contains(target) && !listRef.current?.contains(target)) {
			setIsOpen(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [isOpen, handleClickOutside]);

	const getDropdownPosition = useCallback(() => {
		if (!dropdownRef.current) return { left: 0, top: 0 };
		const rect = dropdownRef.current.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		const maxH = 400;
		if (spaceBelow < maxH && rect.top > spaceBelow) {
			return { left: rect.left, top: rect.top - Math.min(maxH, rect.top - 8) };
		}
		return { left: rect.left, top: rect.bottom + 2 };
	}, []);

	const displayText = activeTemplate ? activeTemplate.name : (localInstance.select_collaboration_template || '选择协作模板');

	return (
		<div ref={dropdownRef} style={{ position: 'relative' }}>
			<button
				type="button"
				onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(!isOpen); }}
				style={{
					display: 'flex', alignItems: 'center', gap: '0.5rem',
					padding: '6px 10px', borderRadius: 'var(--radius-s)',
					backgroundColor: 'transparent', border: 'none', cursor: 'pointer',
					fontSize: 'var(--font-ui-small)', minWidth: '160px', justifyContent: 'space-between',
				}}
			>
				<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{displayText}
				</span>
				<ChevronDown style={{ width: 14, height: 14, flexShrink: 0 }} />
			</button>

			{isOpen && createPortal(
				<div
					ref={listRef}
					style={{
						position: 'fixed', ...getDropdownPosition(),
						minWidth: '300px', maxWidth: '400px', maxHeight: '400px',
						zIndex: 1305, overflowY: 'auto',
						borderRadius: 'var(--radius-m)',
						border: '1px solid var(--background-modifier-border)',
						background: 'var(--background-primary)',
						boxShadow: 'var(--shadow-s)', padding: '0.25rem',
					}}
				>
					{collaborationTemplates.length === 0 ? (
						<div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-ui-small)' }}>
							{localInstance.no_collaboration_templates || '暂无配置，点击新建'}
						</div>
					) : (
						collaborationTemplates.map((template) => {
							const isActive = template.id === activeCollaborationTemplateId;
							return (
								<div
									key={template.id}
									style={{
										padding: '8px 10px', cursor: 'pointer',
										borderRadius: 'var(--radius-s)', marginBottom: '2px',
										backgroundColor: isActive ? 'var(--background-modifier-hover)' : 'transparent',
									}}
									onClick={() => { onCollaborationTemplateSelect(template.id); setIsOpen(false); }}
									onMouseEnter={(e) => {
										if (!isActive) e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									}}
									onMouseLeave={(e) => {
										if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
									}}
								>
									<div style={{ fontSize: 'var(--font-ui-small)', fontWeight: 500 }}>
										{template.name}
									</div>
									{template.description && (
										<div style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', marginTop: '2px' }}>
											{template.description}
										</div>
									)}
									<div style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-faint)', marginTop: '4px' }}>
										{(localInstance.template_step || '步骤 {index}').replace('{index}', String(template.steps.length))}
									</div>
								</div>
							);
						})
					)}

					{/* 管理按钮 */}
					<div style={{
						padding: '6px 10px', borderTop: '1px solid var(--background-modifier-border)', marginTop: '4px',
					}}>
						<button
							type="button" onClick={() => { onOpenTemplateManager(); setIsOpen(false); }}
							style={{
								width: '100%', padding: '4px 8px', fontSize: 'var(--font-ui-smaller)',
								background: 'transparent', border: '1px solid var(--background-modifier-border)',
								borderRadius: 'var(--radius-s)', cursor: 'pointer', color: 'var(--text-muted)',
								display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
							}}
						>
							<Settings style={{ width: 12, height: 12 }} />
							{localInstance.manage_collaboration_template || '管理协作模板'}
						</button>
					</div>
				</div>,
				document.body
			)}

			{/* 步骤预览（模板已选中时展开） */}
			{activeTemplate && activeTemplate.steps.length > 0 && (
				<div className="collab-step-preview" style={{
					marginTop: '4px', padding: '4px 0',
					fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)',
				}}>
					{activeTemplate.steps.map((step, idx) => (
						<div key={idx} style={{
							display: 'flex', alignItems: 'center', gap: '4px',
							padding: '2px 8px',
						}}>
							<span style={{
								display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
								width: '16px', height: '16px', borderRadius: '50%',
								backgroundColor: 'var(--background-modifier-hover)',
								fontSize: '10px', fontWeight: 600, flexShrink: 0,
							}}>
								{idx + 1}
							</span>
							<span style={{ fontWeight: 500, maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{step.modelTag}
							</span>
							{idx < activeTemplate.steps.length - 1 && (
								<ArrowRight style={{ width: 10, height: 10, flexShrink: 0, opacity: 0.5 }} />
							)}
							<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>
								{step.taskDescription}
							</span>
							{step.passContext && (
								<Link2 style={{ width: 10, height: 10, flexShrink: 0, opacity: 0.5 }} title={localInstance.pass_context || '传递上下文'} />
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
};
