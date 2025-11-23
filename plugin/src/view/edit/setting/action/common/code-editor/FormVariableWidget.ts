import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view"
import { RangeSetBuilder } from "@codemirror/state"
import type { VariableItem } from "src/hooks/useVariablesWithLoop";

/**
 * 根据变量元数据创建 CodeMirror 装饰扩展
 */
export function createFormVariableWidgetExtension(variables: VariableItem[]) {
    const variableMap = new Map<string, VariableItem>();
    variables.forEach((variable) => {
        if (variable.label) {
            variableMap.set(variable.label.toLowerCase(), variable);
        }
    });

    const cformVariable = ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        buildDecorations(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>();
            const content = view.state.doc.toString();
            const pattern = /\{\{(@?)([^}]+)\}\}/g;
            let match;

            while ((match = pattern.exec(content)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                const hasAt = match[1] === "@";
                const variableName = match[2].trim();
                const variableStart = start + 2 + (hasAt ? 1 : 0);
                const variableEnd = end - 2;

                const metadata = variableMap.get(variableName.toLowerCase());
                const blockClass = metadata
                    ? `form--CpsFormVariableBlock form--CpsFormVariableBlock--${metadata.type}`
                    : "form--CpsFormVariableBlock";

                builder.add(start, end, Decoration.mark({
                    class: blockClass,
                    attributes: metadata?.info ? { title: metadata.info } : undefined
                }));

                builder.add(start, start + 2 + (hasAt ? 1 : 0), Decoration.mark({
                    class: "form--CpsFormVariableBlockPrefix"
                }));

                builder.add(variableStart, variableEnd, Decoration.mark({
                    class: "form--CpsFormVariableBlockName"
                }));

                builder.add(variableEnd, end, Decoration.mark({
                    class: "form--CpsFormVariableBlockSuffix"
                }));
            }

            return builder.finish();
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }
    }, {
        decorations: instance => instance.decorations
    });

    const formVariableStyle = EditorView.baseTheme({
        ".form--CpsFormVariableBlock": {
            backgroundColor: "rgba(var(--color-blue-rgb, 58,109,249), 0.08)",
            color: "var(--text-normal)",
            border: "1px solid rgba(var(--color-blue-rgb, 58,109,249), 0.3)",
            borderRadius: "var(--radius-s)",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "0 4px",
            fontSize: "var(--font-ui-smaller)",
        },
        ".form--CpsFormVariableBlock--loop": {
            backgroundColor: "rgba(46, 204, 113, 0.12)",
            borderColor: "rgba(46, 204, 113, 0.4)"
        },
        ".form--CpsFormVariableBlock--variable": {
            backgroundColor: "rgba(58, 109, 249, 0.12)",
            borderColor: "rgba(58, 109, 249, 0.4)"
        },
        ".form--CpsFormVariableBlock--internal": {
            backgroundColor: "rgba(241, 196, 15, 0.15)",
            borderColor: "rgba(241, 196, 15, 0.5)"
        },
        ".form--CpsFormVariableBlockPrefix, .form--CpsFormVariableBlockSuffix": {
            opacity: 0.6
        },
        ".form--CpsFormVariableBlockName": {
            fontWeight: 600
        },
    });

    return [cformVariable, formVariableStyle];
}
