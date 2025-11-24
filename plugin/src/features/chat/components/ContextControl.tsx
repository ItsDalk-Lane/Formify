import { FormEvent, useState } from 'react';

interface ContextControlProps {
	contextNotes: string[];
	onAdd: (note: string) => void;
	onRemove: (note: string) => void;
}

export const ContextControl = ({ contextNotes, onAdd, onRemove }: ContextControlProps) => {
	const [draft, setDraft] = useState('');

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		onAdd(draft);
		setDraft('');
	};

	return (
		<div className="context-control tw-flex tw-w-full tw-flex-col tw-gap-2">
			<div className="tw-flex tw-flex-wrap tw-gap-1">
				{contextNotes.map((note) => (
					<span key={note} className="context-pill">
						{note}
						<button type="button" onClick={() => onRemove(note)} aria-label="移除上下文">
							×
						</button>
					</span>
				))}
			</div>
			<form className="tw-flex tw-gap-2" onSubmit={handleSubmit}>
				<input
					className="chat-input__pill-input"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="添加上下文笔记（回车确认）"
				/>
				<button type="submit" className="chat-btn">
					添加
				</button>
			</form>
		</div>
	);
};

