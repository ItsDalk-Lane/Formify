import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ToolDefinition } from '../types/tools';

interface ToolDefinitionDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onCreate: (tool: ToolDefinition) => void;
}

const defaultParameters = {
	type: 'object',
	properties: {
		input: { type: 'string', description: '输入参数' }
	},
	required: ['input']
} as const;

export const ToolDefinitionDialog = ({ isOpen, onClose, onCreate }: ToolDefinitionDialogProps) => {
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [parametersJson, setParametersJson] = useState(JSON.stringify(defaultParameters, null, 2));
	const [error, setError] = useState<string | null>(null);

	const canSubmit = useMemo(() => {
		return name.trim().length > 0 && description.trim().length > 0;
	}, [name, description]);

	if (!isOpen) return null;

	return createPortal(
		<div
			className="tw-fixed tw-inset-0 tw-z-[1500] tw-flex tw-items-center tw-justify-center tw-bg-black/50 tw-p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="tw-w-full tw-max-w-[640px] tw-rounded tw-border tw-border-border tw-bg-background tw-p-4">
				<div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
					<div className="tw-text-sm tw-font-semibold">创建工具</div>
					<button type="button" onClick={onClose} className="tw-text-muted hover:tw-text-foreground">
						<X className="tw-size-4" />
					</button>
				</div>

				<div className="tw-grid tw-gap-3">
					<label className="tw-grid tw-gap-1">
						<span className="tw-text-xs tw-text-muted">名称（tool name）</span>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="tw-border tw-border-border tw-rounded tw-px-2 tw-py-1 tw-bg-transparent"
							placeholder="例如：write_file"
						/>
					</label>

					<label className="tw-grid tw-gap-1">
						<span className="tw-text-xs tw-text-muted">描述</span>
						<input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="tw-border tw-border-border tw-rounded tw-px-2 tw-py-1 tw-bg-transparent"
							placeholder="工具会做什么"
						/>
					</label>

					<label className="tw-grid tw-gap-1">
						<span className="tw-text-xs tw-text-muted">参数 Schema（JSON）</span>
						<textarea
							value={parametersJson}
							onChange={(e) => setParametersJson(e.target.value)}
							rows={10}
							className="tw-border tw-border-border tw-rounded tw-px-2 tw-py-1 tw-bg-transparent tw-font-mono tw-text-xs"
						/>
					</label>

					{error && <div className="tw-text-xs tw-text-error">{error}</div>}

					<div className="tw-flex tw-justify-end tw-gap-2">
						<button
							type="button"
							className="tw-px-3 tw-py-1 tw-rounded tw-border tw-border-border"
							onClick={onClose}
						>
							取消
						</button>
						<button
							type="button"
							disabled={!canSubmit}
							className="tw-px-3 tw-py-1 tw-rounded tw-border tw-border-border tw-bg-accent tw-text-on-accent disabled:tw-opacity-50"
							onClick={() => {
								try {
									setError(null);
									const schema = JSON.parse(parametersJson);
									const now = Date.now();
									onCreate({
										id: name.trim(),
										name: name.trim(),
										description: description.trim(),
										enabled: true,
										parameters: schema,
										createdAt: now,
										updatedAt: now
									} as ToolDefinition);
									onClose();
								} catch (e) {
									setError(e instanceof Error ? e.message : String(e));
								}
							}}
						>
							创建
						</button>
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
};
