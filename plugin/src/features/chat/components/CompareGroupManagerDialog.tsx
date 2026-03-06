import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Save } from 'lucide-react';
import type { ProviderSettings } from 'src/features/tars/providers';
import { getCapabilityDisplayText } from 'src/features/tars/providers/utils';
import { availableVendors } from 'src/features/tars/settings';
import type { CompareGroup } from '../types/multiModel';
import { ChatService } from '../services/ChatService';
import { localInstance } from 'src/i18n/locals';

interface CompareGroupManagerDialogProps {
	isOpen: boolean;
	onClose: () => void;
	service: ChatService;
	providers: ProviderSettings[];
}

function createEmptyGroup(): CompareGroup {
	return {
		id: '',
		name: '',
		description: '',
		modelTags: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		isDefault: false,
	};
}

export const CompareGroupManagerDialog = ({
	isOpen,
	onClose,
	service,
	providers,
}: CompareGroupManagerDialogProps) => {
	const [groups, setGroups] = useState<CompareGroup[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editGroup, setEditGroup] = useState<CompareGroup>(createEmptyGroup());
	const [isNew, setIsNew] = useState(false);

	const loadGroups = useCallback(async () => {
		const loaded = await service.loadCompareGroups();
		setGroups(loaded);
	}, [service]);

	useEffect(() => {
		if (isOpen) void loadGroups();
	}, [isOpen, loadGroups]);

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

	const handleSelectGroup = (group: CompareGroup) => {
		setSelectedId(group.id);
		setEditGroup({ ...group, modelTags: [...group.modelTags] });
		setIsNew(false);
	};

	const handleNew = () => {
		const newGroup = createEmptyGroup();
		setSelectedId(null);
		setEditGroup(newGroup);
		setIsNew(true);
	};

	const handleSave = async () => {
		if (!editGroup.name.trim()) return;
		const toSave: CompareGroup = {
			...editGroup,
			id: isNew ? '' : editGroup.id,
			updatedAt: Date.now(),
		};
		const savedId = await service.saveCompareGroup(toSave);
		if (savedId) {
			await loadGroups();
			setSelectedId(savedId);
			setIsNew(false);
		}
	};

	const handleDelete = async () => {
		if (!selectedId) return;
		await service.deleteCompareGroup(selectedId);
		await loadGroups();
		setSelectedId(null);
		setEditGroup(createEmptyGroup());
		setIsNew(false);
	};

	const toggleModel = (tag: string) => {
		setEditGroup((prev) => {
			const tags = prev.modelTags.includes(tag)
				? prev.modelTags.filter((t) => t !== tag)
				: [...prev.modelTags, tag];
			return { ...prev, modelTags: tags };
		});
	};

	if (!isOpen) return null;

	return createPortal(
		<div
			className="tw-fixed tw-inset-0 tw-z-[1500] tw-flex tw-items-center tw-justify-center tw-bg-black/50 tw-p-4"
			onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div className="compare-group-dialog" style={{
				width: '100%', maxWidth: '700px', maxHeight: '80vh',
				borderRadius: 'var(--radius-m)', border: '1px solid var(--background-modifier-border)',
				backgroundColor: 'var(--background-primary)', display: 'flex', flexDirection: 'column',
				overflow: 'hidden',
			}}>
				{/* 标题栏 */}
				<div style={{
					display: 'flex', alignItems: 'center', justifyContent: 'space-between',
					padding: '12px 16px', borderBottom: '1px solid var(--background-modifier-border)',
				}}>
					<span style={{ fontWeight: 600, fontSize: 'var(--font-ui-medium)' }}>{localInstance.manage_compare_group || '管理对比组'}</span>
					<button type="button" onClick={onClose} style={{
						background: 'none', border: 'none', cursor: 'pointer',
						color: 'var(--text-muted)', display: 'flex',
					}}>
						<X style={{ width: 18, height: 18 }} />
					</button>
				</div>

				{/* 主体 */}
				<div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
					{/* 左栏 - 列表 */}
					<div style={{
						width: '200px', borderRight: '1px solid var(--background-modifier-border)',
						display: 'flex', flexDirection: 'column', overflowY: 'auto',
					}}>
						<div style={{ flex: 1, padding: '8px' }}>
							{groups.map((g) => (
								<div
									key={g.id}
									onClick={() => handleSelectGroup(g)}
									style={{
										padding: '8px', cursor: 'pointer', borderRadius: 'var(--radius-s)',
										marginBottom: '4px', fontSize: 'var(--font-ui-small)',
										backgroundColor: selectedId === g.id ? 'var(--background-modifier-hover)' : 'transparent',
									}}
									onMouseEnter={(e) => {
										if (selectedId !== g.id) e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
									}}
									onMouseLeave={(e) => {
										if (selectedId !== g.id) e.currentTarget.style.backgroundColor = 'transparent';
									}}
								>
									<div style={{ fontWeight: 500 }}>{g.name}</div>
									<div style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>
										{(localInstance.selected_models || '已选择 {count} 个模型').replace('{count}', String(g.modelTags.length))}
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
								<Plus style={{ width: 14, height: 14 }} /> {localInstance.new_compare_group || '新建对比组'}
							</button>
						</div>
					</div>

					{/* 右栏 - 编辑 */}
					<div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
						{(selectedId || isNew) ? (
							<>
								<label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>{localInstance.compare_group_name || '对比组名称'}</span>
									<input
										value={editGroup.name}
										onChange={(e) => setEditGroup((prev) => ({ ...prev, name: e.target.value }))}
										style={{
											padding: '6px 8px', fontSize: 'var(--font-ui-small)',
											borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
											background: 'var(--background-primary)', color: 'var(--text-normal)',
										}}
										placeholder={localInstance.compare_group_name || '对比组名称'}
									/>
								</label>
								<label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>{localInstance.compare_group_description || '描述'}</span>
									<input
										value={editGroup.description}
										onChange={(e) => setEditGroup((prev) => ({ ...prev, description: e.target.value }))}
										style={{
											padding: '6px 8px', fontSize: 'var(--font-ui-small)',
											borderRadius: 'var(--radius-s)', border: '1px solid var(--background-modifier-border)',
											background: 'var(--background-primary)', color: 'var(--text-normal)',
										}}
										placeholder={localInstance.compare_group_description || '描述'}
									/>
								</label>
								<div>
									<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
										{localInstance.compare_group_models || '包含模型'}（{editGroup.modelTags.length}）
									</span>
									<div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--background-modifier-border)', borderRadius: 'var(--radius-s)', padding: '4px' }}>
										{providers.map((p) => {
											const checked = editGroup.modelTags.includes(p.tag);
											const vendor = availableVendors.find((v) => v.name === p.vendor);
											const caps = vendor ? getCapabilityDisplayText(vendor, p.options) : '';
											return (
												<label
													key={p.tag}
													style={{
														display: 'flex', alignItems: 'center', gap: '8px',
														padding: '4px 8px', cursor: 'pointer', fontSize: 'var(--font-ui-small)',
														borderRadius: 'var(--radius-s)',
													}}
												>
													<input
														type="checkbox" checked={checked}
														onChange={() => toggleModel(p.tag)}
														style={{ margin: 0 }}
													/>
													<span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
														{p.tag}
													</span>
													{caps && <span style={{ fontSize: 'var(--font-ui-smaller)', opacity: 0.7 }}>{caps}</span>}
												</label>
											);
										})}
									</div>
								</div>
								{/* 操作按钮 */}
								<div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
									<button
										type="button" onClick={handleSave}
										disabled={!editGroup.name.trim()}
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
											<Trash2 style={{ width: 14, height: 14 }} /> {localInstance.delete_compare_group || '删除对比组'}
										</button>
									)}
								</div>
							</>
						) : (
							<div style={{
								display: 'flex', alignItems: 'center', justifyContent: 'center',
								height: '100%', color: 'var(--text-muted)', fontSize: 'var(--font-ui-small)',
							}}>
								{localInstance.compare_group_empty_state || '选择一个对比组进行编辑，或点击新建'}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
};
