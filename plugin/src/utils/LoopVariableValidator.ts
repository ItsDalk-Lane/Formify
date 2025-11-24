const IDENTIFIER_REGEXP = /^[A-Za-z_\$][A-Za-z0-9_\$]*$/;

export class LoopVariableValidator {
    static isValid(name?: string | null): boolean {
        if (!name) {
            return false;
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        return IDENTIFIER_REGEXP.test(trimmed);
    }

    static sanitize(name: string, fallback: string): string {
        if (this.isValid(name)) {
            return name.trim();
        }
        return fallback;
    }
}





