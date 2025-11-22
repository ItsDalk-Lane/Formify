export class LoopVariableScope {
    private static scopeStack: Record<string, any>[] = [];

    static push(variables: Record<string, any>): void {
        this.scopeStack.push(variables);
    }

    static pop(): void {
        this.scopeStack.pop();
    }

    static current(): Record<string, any> | undefined {
        if (this.scopeStack.length === 0) {
            return undefined;
        }
        return this.scopeStack[this.scopeStack.length - 1];
    }

    static getValue(key: string): any {
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
            const scope = this.scopeStack[i];
            if (Object.prototype.hasOwnProperty.call(scope, key)) {
                return scope[key];
            }
        }
        return undefined;
    }
}

