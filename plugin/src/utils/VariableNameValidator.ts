import { INTERNAL_VARIABLE_NAMES, SYSTEM_RESERVED_LOOP_VARIABLES } from "src/service/variable/VariableConstants";
import { LoopVariableValidator } from "./LoopVariableValidator";

export class VariableNameValidator {
    private static reservedSet = new Set(
        [...INTERNAL_VARIABLE_NAMES, ...SYSTEM_RESERVED_LOOP_VARIABLES].map((name) =>
            name.toLowerCase()
        )
    );

    static normalize(name?: string): string | null {
        if (!name) {
            return null;
        }
        const trimmed = name.trim();
        return trimmed || null;
    }

    static isValidIdentifier(name?: string | null): boolean {
        return LoopVariableValidator.isValid(name);
    }

    static isReservedName(name?: string): boolean {
        if (!name) {
            return false;
        }
        const normalized = name.trim().toLowerCase();
        return this.reservedSet.has(normalized);
    }

    static suggestAlternativeName(baseName: string, existingNames: Iterable<string>): string {
        const normalizedBase = this.normalize(baseName) || "variable";
        const existingSet = new Set<string>();
        for (const name of existingNames) {
            const normalized = this.normalize(name);
            if (normalized) {
                existingSet.add(normalized);
            }
        }

        if (!existingSet.has(normalizedBase)) {
            return normalizedBase;
        }

        for (let index = 1; index < 10000; index++) {
            const candidate = `${normalizedBase}_${index}`;
            if (!existingSet.has(candidate)) {
                return candidate;
            }
        }

        return `${normalizedBase}_${Date.now()}`;
    }
}

