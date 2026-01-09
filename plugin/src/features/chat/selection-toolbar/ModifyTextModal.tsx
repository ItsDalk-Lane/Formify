import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ProviderSettings } from 'src/features/tars/providers';
import { ModelSelector } from '../components/ModelSelector';
import { localInstance } from 'src/i18n/locals';
import './ModifyTextModal.css';

interface AnchorCoords {
	top: number;
	left: number;
	right: number;
	bottom: number;
}

interface ModifyTextModalProps {
	visible: boolean;
	providers: ProviderSettings[];
	selectedModelTag: string;
	anchorCoords?: AnchorCoords;
	onChangeModel: (tag: string) => void;
	onSend: (instruction: string) => void;
	onClose: () => void;
}

export const ModifyTextModal = ({
	visible,
	providers,
	selectedModelTag,
	anchorCoords,
	onChangeModel,
	onSend,
	onClose
}: ModifyTextModalProps) => {
	const [instruction, setInstruction] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!visible) {
			return;
		}
		setInstruction('');
		setTimeout(() => {
			textareaRef.current?.focus();
		}, 50);
	}, [visible]);

	const [forceUpdate, setForceUpdate] = useState(0);
	useEffect(() => {
		if (!visible) {
			return;
		}
		const handle = () => setForceUpdate((v) => v + 1);
		window.addEventListener('resize', handle);
		window.addEventListener('scroll', handle, true);
		return () => {
			window.removeEventListener('resize', handle);
			window.removeEventListener('scroll', handle, true);
		};
	}, [visible]);

	const modalPosition = useMemo(() => {
		void forceUpdate;
		const estimatedWidth = 420;
		const estimatedHeight = 260;
		const padding = 8;

		const fallback = {
			left: Math.max(padding, Math.min(window.innerWidth - estimatedWidth - padding, (window.innerWidth - estimatedWidth) / 2)),
			top: Math.max(padding, Math.min(window.innerHeight - estimatedHeight - padding, (window.innerHeight - estimatedHeight) / 2))
		};

		if (!anchorCoords) {
			return fallback;
		}

		const preferBelowTop = anchorCoords.bottom + 8;
		const preferAboveTop = anchorCoords.top - estimatedHeight - 8;
		const canPlaceBelow = window.innerHeight - anchorCoords.bottom >= estimatedHeight + 16;
		const top = canPlaceBelow ? preferBelowTop : Math.max(padding, preferAboveTop);

		const left = Math.max(
			padding,
			Math.min(window.innerWidth - estimatedWidth - padding, anchorCoords.left)
		);

		return { left, top };
	}, [anchorCoords, forceUpdate]);

	const handleSend = useCallback(() => {
		if (!providers.length || !selectedModelTag) {
			return;
		}
		const trimmed = instruction.trim();
		if (!trimmed) {
			return;
		}
		onSend(trimmed);
	}, [instruction, onSend, providers.length, selectedModelTag]);

	useEffect(() => {
		if (!visible) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [visible, onClose]);

	if (!visible) {
		return null;
	}

	const modalContent = (
		<div className="modify-text-modal-overlay" onClick={onClose}>
			<div
				className="modify-text-modal"
				style={{ left: modalPosition.left, top: modalPosition.top }}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="modify-text-modal-header">
					<span className="modify-text-modal-title">修改</span>
					<button
						className="modify-text-modal-close"
						onClick={onClose}
						title={localInstance.close || '关闭'}
					>
						<X size={18} />
					</button>
				</div>

				<div className="modify-text-modal-body">
					<div className="modify-text-modal-field">
						<label className="modify-text-modal-label">模型</label>
						<ModelSelector providers={providers} value={selectedModelTag} onChange={onChangeModel} />
					</div>

					<div className="modify-text-modal-field">
						<label className="modify-text-modal-label">指令</label>
						<textarea
							ref={textareaRef}
							className="modify-text-modal-textarea"
							value={instruction}
							onChange={(e) => setInstruction(e.target.value)}
							rows={6}
							placeholder={'例如：请将这段文字改写为更正式的语气'}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
									e.preventDefault();
									e.stopPropagation();
									handleSend();
									return;
								}
								if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
									e.preventDefault();
									e.stopPropagation();
									handleSend();
								}
							}}
						/>
					</div>
				</div>

				<div className="modify-text-modal-footer">
					<button className="modify-text-modal-btn modify-text-modal-btn-secondary" onClick={onClose}>
						{localInstance.cancel || '取消'}
					</button>
					<button
						className="modify-text-modal-btn modify-text-modal-btn-primary"
						onClick={handleSend}
						disabled={!providers.length || !selectedModelTag || !instruction.trim()}
					>
						发送
					</button>
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
};

export default ModifyTextModal;
