import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Save, ChevronUp, ChevronDown } from 'lucide-react';
import type { ProviderSettings } from 'src/features/tars/providers';
import type { CollaborationTemplate, CollaborationStep } from '../types/multiModel';
import { ChatService } from '../services/ChatService';
import { localInstance } from 'src/i18n/locals';

interface CollabTemplateManagerDialogProps {
	isOpen: boolean;
	onClose: () => void;
	service: ChatService;
	providers: ProviderSettings[];
}

function createEmptyTemplate(): CollaborationTemplate {
	return {
		id: '',
		name: '',
		description: '',
		steps: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDefault: false,
	};
}

function createEmptyStep(providers: ProviderSettings[]): CollaborationStep {
	return {
		modelTag: providers.length > 0 ? providers[0].tag : '',
		taskDescription: '',
		passContext: true,
	};
}

export const CollabTemplateManagerDialog = ({
	isOpen,
	onClose,
	service,
	providers,
}: CollabTemplateManagerDialogProps) => {
	const [templates, setTemplates] = useState<CollaborationTemplate[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editTemplate, setEditTemplate] = useState<CollaborationTemplate>(createEmptyTemplate());
	const [isNew, setIsNew] = useState(false);

	const loadTemplates = useCallback(async () => {
		const loaded = await service.loadCollaborationTemplates();
		setTemplates(loaded);
	}, [service]);

	useEffect(() => {
		if (isOpen) void loadTemplates();
	}, [isOpen, loadTemplates]);

	useEffect(() => {
		if (!isOpen) return;
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', handleEscape);
		return () => window.removeEventListener('keydown', handleEscape);
	}, [isOpen, onClose]);

	const handleSelect = (t: CollaborationTemplate) => {
		setSelectedId(t.id);
		setEditTemplate({ ...t, steps: t.steps.map((s) => ({ ...s })) });
		setIsNew(false);
	};

	const handleNew = () => {
		setSelectedId(null);
		setEditTemplate(createEmptyTemplate());
		setIsNew(true);
	};

	const handleSave = async () => {
		if (!editTemplate.name.trim()) return;
		const toSave: CollaborationTemplate = {
			...editTemplate,
			id: isNew ? '' : editTemplate.id,
			updatedAt: Date.now(),
		};
		const savedId = await service.saveCollaborationTemplate(toSave);
		if (savedId) {
			await loadTemplates();
			setSelectedId(savedId);
			setIsNew(false);
		}
	};

	const handleDelete = async () => {
		if (!selectedId) return;
		await service.deleteCollaborationTemplate(selectedId);
		await loadTemplates();
		setSelectedId(null);
		setEditTemplate(createEmptyTemplate());
		setIsNew(false);
	};

	const addStep = () => {
		setEditTemplate((prev) => ({
			...prev,
			steps: [...prev.steps, createEmptyStep(providers)],
		}));
	};

	const removeStep = (idx: number) => {
		setEditTemplate((prev) => ({
			...prev,
			steps: prev.steps.filter((_, i) => i !== idx),
		}));
	};

	const moveStep = (idx: number, dir: -1 | 1) => {
		setEditTemplate((prev) => {
			const steps = [...prev.steps];
			const target = idx + dir;
			if (target < 0 || target >= steps.length) return prev;
			[steps[idx], steps[target]] = [steps[target], steps[idx]];
			return { ...prev, steps };
		});
	};

	const updateStep = (idx: number, patch: Partial<CollaborationStep>) => {
		setEditTemplate((prev) => ({
			...prev,
			steps: prev.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
		}));
	};

	if (!isOpen) return null;

	return createPortal(
		<div
			className="tw-fixed tw-inset-0 tw-z-[1500] tw-flex tw-items-center tw-justify-center tw-bg-black/50 tw-p-4"
			onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div className="collab-template-dialog" style={{
				width: '100%', maxWidth: '780px', maxHeight: '80vh',
				borderRadius: 'var(--radius-m)', border: '1px solid var(--background-modifier-border)',
				backgroundColor: 'var(--background-primary)', display: 'flex', flexDirection: 'column',
				overflow: 'hidden',
			}}>
				{/* 标题栏 */}
				<div style={{
					display: 'flex', alignItems: 'center', justifyContent: 'space-between',
					padding: '12px 16px', borderBottom: '1px solid var(--background-modifier-border)',
				}}>
					<span style={{ fontWeight: 600, fontSize: 'var(--font-ui-medium)' }}>{localInstance.manage_collaboration_template || '管理协作模板'}</span>
					<button type="button" onClick={onClose} style={{
						background: 'none', border: 'none', cursor: 'pointer',
						color: 'var(--text-muted)', display: 'flex',
					}}>
						<X style={{ width: 18, height: 18 }} />
					</button>
				</div>

				{/* 主体 */}
				<div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
					{/* 左栏 */}
					<div style={{
						width: '200px', borderRight: '1px solid var(--background-modifier-border)',
						display: 'flex', flexDirection: 'column', overflowY: 'auto',
					}}>
						<div style={{ flex: 1, padding: '8px' }}>
							{templates.map((t) => (
								<div
									key={t.id}
									onClick={() => handleSelect(t)}
									style={{
										padding: '8px', cursor: 'pointer', borderRadius: 'var(--radius-s)',
										marginBottom: '4px', fontSize: 'var(--font-ui-small)',
										backgroundColor: selectedId === t.id ? 'var(--background-modifier-hover)' : 'transparent',
									}}
									onMouseEnter={(e) => {
										if (selectedId !== t.id) e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									}}
									onMouseLeave={(e) => {
										if (selectedId !== t.id) e.currentTarget.style.backgroundColor = 'transparent';
									}}
								>
									<div style={{ fontWeight: 500 }}>{t.name}</div>
									<div style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>
										{(localInstance.template_step || '步骤 {index}').replace('{index}', String(t.steps.length))}
									</div>
								</div>
							))}
						</div>
						<div style={{ padding: '8px', borderTop: '1px solid var(--background-modifier-border)' }}>
							<button
								type="button" onClick={handleNew}
								style={{
									width: '100%', padding: '6px', display: 'flex', alignItems: 'center',
									justifyContent: 'center', gap: '4px', fontSize: 'var(--font-ui-small)',
									background: 'transparent', border: '1px solid var(--background-modifier-border)',
									borderRadius: 'var(--radius-s)', cursor: 'pointer', color: 'var(--text-muted)',
								}}
							>
								<Plus style={{ width: 14, height: 14 }} /> {localInstance.new_collaboration_template || '新建协作模板'}
							</button>
						</div>
					</div>

					{/* 右栏 */}
					<div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
						{(selectedId || isNew) ? (
							<>
								<label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>{localInstance.collaboration_template || '协作模板'}</span>
									<input
										value={editTemplate.name}
										onChange={(e) => setEditTemplate((p) => ({ ...p, name: e.target.value }))}
										style={{
											padding: '6px 8px', fontSize: 'var(--font-ui-small)',
											borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
											background: 'var(--background-primary)', color: 'var(--text-normal)',
										}}
										placeholder={localInstance.collaboration_template || '协作模板'}
									/>
								</label>
								<label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>{localInstance.compare_group_description || '描述'}</span>
									<input
										value={editTemplate.description}
										onChange={(e) => setEditTemplate((p) => ({ ...p, description: e.target.value }))}
										style={{
											padding: '6px 8px', fontSize: 'var(--font-ui-small)',
											borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
											background: 'var(--background-primary)', color: 'var(--text-normal)',
										}}
										placeholder={localInstance.compare_group_description || '描述'}
									/>
								</label>

								{/* 步骤列表 */}
								<div>
									<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
										<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>
											{localInstance.collaboration_template || '协作模板'}（{editTemplate.steps.length}）
										</span>
										<button
											type="button" onClick={addStep}
											style={{
												padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '2px',
												fontSize: 'var(--font-ui-smaller)', background: 'transparent',
												border: '1px solid var(--background-modifier-border)',
												borderRadius: 'var(--radius-s)', cursor: 'pointer', color: 'var(--text-muted)',
											}}
										>
											<Plus style={{ width: 12, height: 12 }} /> {localInstance.add_step || '添加步骤'}
										</button>
									</div>

									<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
										{editTemplate.steps.map((step, idx) => (
											<div key={idx} style={{
												border: '1px solid var(--background-modifier-border)',
												borderRadius: 'var(--radius-s)', padding: '8px',
												display: 'flex', flexDirection: 'column', gap: '6px',
											}}>
												<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
													<span style={{
														display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
														width: '20px', height: '20px', borderRadius: '50%',
														backgroundColor: 'var(--interactive-accent)', color: 'var(--text-on-accent, #fff)',
														fontSize: '11px', fontWeight: 600, flexShrink: 0,
													}}>
														{idx + 1}
													</span>

													{/* 模型选择 */}
													<select
														value={step.modelTag}
														onChange={(e) => updateStep(idx, { modelTag: e.target.value })}
														style={{
															flex: 1, padding: '4px 6px', fontSize: 'var(--font-ui-smaller)',
															borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
															background: 'var(--background-primary)', color: 'var(--text-normal)',
														}}
													>
														{providers.map((p) => (
															<option key={p.tag} value={p.tag}>{p.tag}</option>
														))}
													</select>

													{/* 移动和删除按钮 */}
													<button
														type="button" onClick={() => moveStep(idx, -1)}
														disabled={idx === 0}
														style={{
															padding: '2px', background: 'none', border: 'none',
															cursor: idx === 0 ? 'default' : 'pointer',
															color: idx === 0 ? 'var(--text-faint)' : 'var(--text-muted)',
															display: 'flex', opacity: idx === 0 ? 0.3 : 1,
														}}
														title={localInstance.quick_action_drag_hint || '拖拽排序'}
													>
														<ChevronUp style={{ width: 14, height: 14 }} />
													</button>
													<button
														type="button" onClick={() => moveStep(idx, 1)}
														disabled={idx === editTemplate.steps.length - 1}
														style={{
															padding: '2px', background: 'none', border: 'none',
															cursor: idx === editTemplate.steps.length - 1 ? 'default' : 'pointer',
															color: idx === editTemplate.steps.length - 1 ? 'var(--text-faint)' : 'var(--text-muted)',
															display: 'flex', opacity: idx === editTemplate.steps.length - 1 ? 0.3 : 1,
														}}
														title={localInstance.quick_action_drag_hint || '拖拽排序'}
													>
														<ChevronDown style={{ width: 14, height: 14 }} />
													</button>
													<button
														type="button" onClick={() => removeStep(idx)}
														style={{
															padding: '2px', background: 'none', border: 'none',
															cursor: 'pointer', color: 'var(--text-error, #dc2626)', display: 'flex',
														}}
														title={localInstance.remove_step || '移除步骤'}
													>
														<Trash2 style={{ width: 14, height: 14 }} />
													</button>
												</div>

												{/* 任务描述 */}
												<input
													value={step.taskDescription}
													onChange={(e) => updateStep(idx, { taskDescription: e.target.value })}
													placeholder={localInstance.task_description || '任务描述'}
													style={{
														padding: '4px 8px', fontSize: 'var(--font-ui-smaller)',
														borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
														background: 'var(--background-primary)', color: 'var(--text-normal)',
													}}
												/>

												{/* 上下文传递开关 */}
												<label style={{
													display: 'flex', alignItems: 'center', gap: '6px',
													fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', cursor: 'pointer',
												}}>
													<input
														type="checkbox"
														checked={step.passContext}
														onChange={(e) => updateStep(idx, { passContext: e.target.checked })}
														style={{ margin: 0 }}
													/>
													{localInstance.pass_context || '传递上下文'}
												</label>
											</div>
										))}
									</div>
								</div>

								{/* 操作按钮 */}
								<div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
									<button
										type="button" onClick={handleSave}
										disabled={!editTemplate.name.trim()}
										className="chat-btn chat-btn--primary"
										style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
									>
										<Save style={{ width: 14, height: 14 }} /> {localInstance.save}
									</button>
									{!isNew && selectedId && (
										<button
											type="button" onClick={handleDelete}
											className="chat-btn chat-btn--danger"
											style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
										>
											<Trash2 style={{ width: 14, height: 14 }} /> {localInstance.delete_collaboration_template || '删除协作模板'}
										</button>
									)}
								</div>
							</>
						) : (
							<div style={{
								display: 'flex', alignItems: 'center', justifyContent: 'center',
								height: '100%', color: 'var(--text-muted)', fontSize: 'var(--font-ui-small)',
							}}>
								{localInstance.collaboration_template_empty_state || '选择一个模板进行编辑，或点击新建'}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
};
