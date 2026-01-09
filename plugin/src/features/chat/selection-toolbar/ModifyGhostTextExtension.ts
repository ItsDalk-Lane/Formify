import { Extension, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

interface ModifyGhostState {
	isShowing: boolean;
	isLoading: boolean;
	text: string;
	pos: number;
	replaceFrom: number;
	replaceTo: number;
}

const defaultModifyGhostState: ModifyGhostState = {
	isShowing: false,
	isLoading: false,
	text: '',
	pos: 0,
	replaceFrom: 0,
	replaceTo: 0
};

export const setModifyGhostEffect = StateEffect.define<{
	text: string;
	pos: number;
	replaceFrom: number;
	replaceTo: number;
	isLoading?: boolean;
}>();

export const clearModifyGhostEffect = StateEffect.define<void>();

export const modifyGhostStateField = StateField.define<ModifyGhostState>({
	create(): ModifyGhostState {
		return { ...defaultModifyGhostState };
	},
	update(state, tr): ModifyGhostState {
		for (const effect of tr.effects) {
			if (effect.is(setModifyGhostEffect)) {
				return {
					isShowing: true,
					isLoading: effect.value.isLoading ?? false,
					text: effect.value.text,
					pos: effect.value.pos,
					replaceFrom: effect.value.replaceFrom,
					replaceTo: effect.value.replaceTo
				};
			}
			if (effect.is(clearModifyGhostEffect)) {
				return { ...defaultModifyGhostState };
			}
		}

		return state;
	}
});

export function getModifyGhostState(state: EditorView['state']): ModifyGhostState {
	return state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
}

class ModifyGhostTextWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}

	eq(other: ModifyGhostTextWidget): boolean {
		return this.text === other.text;
	}

	toDOM(): HTMLElement {
		const container = document.createElement('span');
		container.className = 'tars-ghost-text';
		container.setAttribute('aria-hidden', 'true');

		const lines = this.text.split('\n');
		lines.forEach((line, index) => {
			if (index > 0) {
				container.appendChild(document.createElement('br'));
			}
			container.appendChild(document.createTextNode(line));
		});

		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

const modifyGhostPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
				return;
			}
			const oldState = update.startState.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
			const newState = update.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
			if (
				oldState.isShowing !== newState.isShowing ||
				oldState.text !== newState.text ||
				oldState.pos !== newState.pos
			) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		private buildDecorations(view: EditorView): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();
			const state = view.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
			if (state.isShowing && state.text) {
				const widget = Decoration.widget({
					widget: new ModifyGhostTextWidget(state.text),
					side: 1
				});
				builder.add(state.pos, state.pos, widget);
			}
			return builder.finish();
		}
	},
	{ decorations: (instance) => instance.decorations }
);

const modifyGhostStyle = EditorView.baseTheme({
	'.tars-ghost-text': {
		color: 'var(--text-muted)',
		opacity: '0.6',
		fontStyle: 'italic',
		pointerEvents: 'none',
		userSelect: 'none',
		whiteSpace: 'pre-wrap'
	}
});

const modifyGhostKeymap = keymap.of([
	{
		key: 'Enter',
		run: (view: EditorView) => {
			const state = view.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
			if (!state.isShowing || !state.text || state.isLoading) {
				return false;
			}

			const docLen = view.state.doc.length;
			let from = Math.max(0, Math.min(state.replaceFrom, docLen));
			let to = Math.max(0, Math.min(state.replaceTo, docLen));
			if (to < from) {
				const temp = from;
				from = to;
				to = temp;
			}
			view.dispatch({
				changes: { from, to, insert: state.text },
				selection: { anchor: from + state.text.length },
				effects: clearModifyGhostEffect.of(undefined)
			});
			return true;
		}
	}
]);

const cancelOnAnyAction = EditorView.domEventHandlers({
	keydown: (event: KeyboardEvent, view: EditorView) => {
		const state = view.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
		if (!state.isShowing) {
			return false;
		}
		if (event.key === 'Enter') {
			return false;
		}
		view.dispatch({ effects: clearModifyGhostEffect.of(undefined) });
		return false;
	},
	mousedown: (_event: MouseEvent, view: EditorView) => {
		const state = view.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
		if (!state.isShowing) {
			return false;
		}
		view.dispatch({ effects: clearModifyGhostEffect.of(undefined) });
		return false;
	},
	blur: (_event: FocusEvent, view: EditorView) => {
		const state = view.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
		if (!state.isShowing) {
			return false;
		}
		view.dispatch({ effects: clearModifyGhostEffect.of(undefined) });
		return false;
	}
});

const cancelOnTransactions = EditorView.updateListener.of((update) => {
	if (!update.docChanged && !update.selectionSet) {
		return;
	}
	const state = update.state.field(modifyGhostStateField, false) ?? defaultModifyGhostState;
	if (!state.isShowing) {
		return;
	}
	// 忽略内部事务（用于聚焦/折叠选区，确保光标可见）
	for (const tr of update.transactions) {
		const userEvent = tr.annotation(Transaction.userEvent);
		if (userEvent === 'modify-ghost-internal') {
			return;
		}
	}

	// 兜底策略：任何用户事务都视为“其他操作”，直接取消。
	update.view.dispatch({ effects: clearModifyGhostEffect.of(undefined) });
});

export function createModifyGhostTextExtension(): Extension[] {
	return [
		modifyGhostStateField,
		modifyGhostPlugin,
		modifyGhostStyle,
		Prec.highest(modifyGhostKeymap),
		Prec.highest(cancelOnAnyAction),
		Prec.highest(cancelOnTransactions)
	];
}
