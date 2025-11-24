import { FormScript } from "./FormScript";

export class FormScriptComipler {

    static async compile(id: string, content: string, options?: {
        name?: string
    }): Promise<FormScript | null> {
        try {
            const extensionFn = new Function('exports',
                content + '\nreturn exports["default"];'
            );
            const extension = extensionFn({});
            if (options?.name && options.name.trim() !== "") {
                extension.name = options?.name;
            }
            if (!this.validateExtension(extension)) {
                console.warn(`invalid extension: ${id}, maybe missing exports.default or export.default not valid`);
                return null;
            }
            return {
                ...extension,
                tags: extension.tags || [],
                id: id
            };
        } catch (err) {
            if (err instanceof SyntaxError) {
                console.error(`FormFlow: Syntax error in script file "${id}":`, err.message);
                console.error(`FormFlow: This usually means you're using 'await' in a non-async function. Please make sure the function is marked as 'async'.`);
            } else {
                console.error(`FormFlow: Compile extension error "${id}":`, err);
            }
            return null;
        }
    }

    private static validateExtension(extension: any) {
        return (
            extension &&
            typeof extension === 'object' &&
            typeof extension.name === 'string' &&
            typeof extension.entry === 'function'
        );
    }
}