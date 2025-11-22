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

    /**
     * 清除所有作用域（主要用于测试）
     */
    static clear(): void {
        this.scopeStack = [];
    }

    /**
     * 获取当前作用域栈的深度（用于测试）
     */
    static getDepth(): number {
        return this.scopeStack.length;
    }
}

