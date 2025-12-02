/**
 * 循环变量元数据
 */
export interface LoopVariableMeta {
    name: string; // 变量名
    description?: string; // 变量描述
    isStandard?: boolean; // 是否为标准循环变量（item, index, total）
}

/**
 * 循环作用域信息
 */
export interface LoopScopeInfo {
    variables: Record<string, any>;
    meta?: LoopVariableMeta[]; // 变量元数据
}

export class LoopVariableScope {
    private static scopeStack: LoopScopeInfo[] = [];

    static push(variables: Record<string, any>, meta?: LoopVariableMeta[]): void {
        this.scopeStack.push({
            variables,
            meta
        });
    }

    static pop(): void {
        this.scopeStack.pop();
    }

    static current(): Record<string, any> | undefined {
        if (this.scopeStack.length === 0) {
            return undefined;
        }
        return this.scopeStack[this.scopeStack.length - 1].variables;
    }

    static getValue(key: string): any {
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
            const scope = this.scopeStack[i];
            if (Object.prototype.hasOwnProperty.call(scope.variables, key)) {
                return scope.variables[key];
            }
        }
        return undefined;
    }

    /**
     * 检查是否在循环作用域内
     */
    static isInsideLoop(): boolean {
        return this.scopeStack.length > 0;
    }

    /**
     * 获取当前循环作用域的变量元数据
     */
    static getCurrentMeta(): LoopVariableMeta[] {
        if (this.scopeStack.length === 0) {
            return [];
        }
        const currentScope = this.scopeStack[this.scopeStack.length - 1];
        return currentScope.meta || [];
    }

    /**
     * 获取所有可用的循环变量（用于UI显示）
     */
    static getAvailableVariables(): LoopVariableMeta[] {
        const allVars: LoopVariableMeta[] = [];

        // 从顶层到底层收集所有变量，确保外层循环变量可见
        for (let i = 0; i < this.scopeStack.length; i++) {
            const scope = this.scopeStack[i];
            if (scope.meta) {
                for (const meta of scope.meta) {
                    // 避免重复，内层循环变量优先
                    if (!allVars.find(v => v.name === meta.name)) {
                        allVars.push(meta);
                    }
                }
            } else {
                // 如果没有元数据，从variables中提取并创建基本元数据
                Object.keys(scope.variables).forEach(varName => {
                    if (!allVars.find(v => v.name === varName)) {
                        allVars.push({
                            name: varName,
                            isStandard: ['item', 'index', 'total', 'iteration'].includes(varName)
                        });
                    }
                });
            }
        }

        return allVars;
    }

    /**
     * 获取循环变量的描述信息
     */
    static getVariableDescription(varName: string): string {
        const standardDescriptions: Record<string, string> = {
            'item': '当前循环元素（用户自定义变量名）',
            'index': '当前循环索引（用户自定义变量名，从0开始）',
            'total': '循环总次数（用户自定义变量名）',
            'iteration': '当前迭代次数（系统内置，从1开始）',
            'currentPage': '当前页码（分页循环，系统内置）',
            'pageSize': '每页大小（分页循环，系统内置）',
            'totalPage': '总页数（分页循环，系统内置）'
        };

        return standardDescriptions[varName] || '循环变量';
    }

    /**
     * 创建标准循环变量的元数据
     */
    static createStandardVariableMeta(variables: Record<string, any>): LoopVariableMeta[] {
        const meta: LoopVariableMeta[] = [];

        Object.keys(variables).forEach(varName => {
            meta.push({
                name: varName,
                description: this.getVariableDescription(varName),
                isStandard: ['item', 'index', 'total', 'iteration', 'currentPage', 'pageSize', 'totalPage'].includes(varName)
            });
        });

        return meta;
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









