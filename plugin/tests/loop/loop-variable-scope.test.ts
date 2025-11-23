import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { FilterService } from "src/service/filter/FilterService";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { LoopDataResolver } from "src/utils/LoopDataResolver";
import { ActionContext } from "src/service/action/IActionService";
import { FormState } from "src/service/FormState";
import { FormConfig } from "src/model/FormConfig";
import { App } from "obsidian";

const createTestContext = (): ActionContext => {
    const state: FormState = {
        idValues: {
            globalVar: "global_value",
            sharedVar: "global_shared"
        },
        values: {
            testArray: ["item1", "item2", "item3"]
        },
    };

    return {
        state,
        config: new FormConfig("test"),
        app: {} as App,
    };
};

describe("循环变量作用域隔离测试", () => {
    beforeEach(() => {
        LoopVariableScope.clear();
    });

    afterEach(() => {
        LoopVariableScope.clear();
    });

    describe("作用域管理", () => {
        it("应该在循环结束后正确清理变量", () => {
            // 开始时应该没有循环变量
            expect(LoopVariableScope.isInsideLoop()).toBe(false);
            expect(LoopVariableScope.current()).toBeUndefined();

            // 推入循环变量
            const loopVars = { index: 1, item: "test" };
            LoopVariableScope.push(loopVars);

            expect(LoopVariableScope.isInsideLoop()).toBe(true);
            expect(LoopVariableScope.getValue("index")).toBe(1);

            // 弹出后应该清理
            LoopVariableScope.pop();
            expect(LoopVariableScope.isInsideLoop()).toBe(false);
            expect(LoopVariableScope.getValue("index")).toBeUndefined();
        });

        it("应该正确处理嵌套循环作用域", () => {
            // 外层循环
            const outerVars = {
                outerIndex: 0,
                outerItem: "outer",
                sharedVar: "outer_value" // 与全局变量同名
            };
            LoopVariableScope.push(outerVars);

            expect(LoopVariableScope.getValue("outerIndex")).toBe(0);
            expect(LoopVariableScope.getValue("sharedVar")).toBe("outer_value");

            // 内层循环
            const innerVars = {
                innerIndex: 1,
                innerItem: "inner",
                sharedVar: "inner_value", // 覆盖外层的同名变量
                outerIndex: 999 // 覆盖外层的同名变量
            };
            LoopVariableScope.push(innerVars);

            // 内层变量应该优先
            expect(LoopVariableScope.getValue("innerIndex")).toBe(1);
            expect(LoopVariableScope.getValue("sharedVar")).toBe("inner_value");
            expect(LoopVariableScope.getValue("outerIndex")).toBe(999);

            // 弹出内层
            LoopVariableScope.pop();

            // 外层变量应该恢复
            expect(LoopVariableScope.getValue("outerIndex")).toBe(0);
            expect(LoopVariableScope.getValue("sharedVar")).toBe("outer_value");
            expect(LoopVariableScope.getValue("innerIndex")).toBeUndefined();

            // 弹出外层
            LoopVariableScope.pop();
            expect(LoopVariableScope.getValue("outerIndex")).toBeUndefined();
            expect(LoopVariableScope.getValue("sharedVar")).toBeUndefined();
        });

        it("应该正确显示所有可用变量（不包括隐藏的）", () => {
            // 外层循环
            const outerVars = { outerIndex: 0, sharedVar: "outer" };
            LoopVariableScope.push(outerVars);

            // 内层循环
            const innerVars = { innerIndex: 1, sharedVar: "inner" };
            LoopVariableScope.push(innerVars);

            const availableVars = LoopVariableScope.getAvailableVariables();

            // 应该包含所有变量名，但内层的优先
            const varNames = availableVars.map(v => v.name);
            expect(varNames).toContain("innerIndex");
            expect(varNames).toContain("outerIndex");
            expect(varNames).toContain("sharedVar");

            // sharedVar的值应该来自内层
            expect(LoopVariableScope.getValue("sharedVar")).toBe("inner");
        });
    });

    describe("条件判断中的变量隔离", () => {
        it("动作条件应该优先使用循环变量", () => {
            // 设置循环变量，与全局变量同名
            const loopVars = {
                globalVar: "loop_value",
                sharedVar: "loop_shared"
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            const condition: Filter = {
                id: "test",
                type: FilterType.filter,
                property: "globalVar",
                operator: OperatorType.Equals,
                value: "loop_value",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => {
                    if (!property) return undefined;
                    // 模拟ActionChain的逻辑
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }
                    return context.state.idValues[property];
                },
                (value) => value
            );

            expect(result).toBe(true); // 应该匹配循环变量的值
        });

        it("循环结束后应该恢复全局变量访问", () => {
            // 不在循环中
            expect(LoopVariableScope.isInsideLoop()).toBe(false);

            const context = createTestContext();

            const condition: Filter = {
                id: "test",
                type: FilterType.filter,
                property: "globalVar",
                operator: OperatorType.Equals,
                value: "global_value",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => {
                    if (!property) return undefined;
                    // 模拟ActionChain的逻辑
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }
                    return context.state.idValues[property];
                },
                (value) => value
            );

            expect(result).toBe(true); // 应该匹配全局变量的值
        });

        it("条件表达式中的循环变量应该正确作用域隔离", async () => {
            // 外层循环
            const outerVars = { index: 0, level: "outer" };
            LoopVariableScope.push(outerVars);

            const context = createTestContext();

            // 使用外层循环变量
            const result1 = await LoopDataResolver.evaluateCondition(
                "loopVars.level === 'outer'",
                context
            );
            expect(result1).toBe(true);

            // 内层循环
            const innerVars = { index: 1, level: "inner" };
            LoopVariableScope.push(innerVars);

            // 现在应该使用内层变量
            const result2 = await LoopDataResolver.evaluateCondition(
                "loopVars.level === 'inner'",
                context
            );
            expect(result2).toBe(true);

            // 弹出内层，恢复外层
            LoopVariableScope.pop();

            const result3 = await LoopDataResolver.evaluateCondition(
                "loopVars.level === 'outer'",
                context
            );
            expect(result3).toBe(true);

            LoopVariableScope.pop(); // 清理
        });
    });

    describe("变量冲突检测和预防", () => {
        it("应该检测循环变量与系统保留变量的冲突", () => {
            // 尝试使用系统保留变量名
            const conflictVars = {
                // 这些可能会与系统保留变量冲突
                prototype: "should_not_conflict",
                constructor: "should_not_conflict",
                __proto__: "should_not_conflict"
            };

            // 系统应该允许这些但要有警告机制（这里我们只是测试不会破坏系统）
            LoopVariableScope.push(conflictVars);

            expect(LoopVariableScope.getValue("prototype")).toBe("should_not_conflict");
            expect(LoopVariableScope.getValue("constructor")).toBe("should_not_conflict");

            LoopVariableScope.pop();
        });

        it("应该防止循环变量污染全局对象", () => {
            const originalWindow = (global as any).window;

            // 设置循环变量
            const loopVars = {
                testGlobalVar: "test_value",
               污染测试: "中文测试" // 测试中文字符
            };
            LoopVariableScope.push(loopVars);

            // 确保循环变量不会污染全局对象
            expect((global as any).testGlobalVar).toBeUndefined();
            expect((global as any).污染测试).toBeUndefined();

            LoopVariableScope.pop();

            // 恢复原始window对象（如果存在）
            if (originalWindow) {
                (global as any).window = originalWindow;
            }
        });
    });

    describe("内存泄漏防护", () => {
        it("应该在多次循环后正确清理内存", () => {
            const initialDepth = LoopVariableScope.getDepth();
            expect(initialDepth).toBe(0);

            // 模拟多次循环
            for (let i = 0; i < 10; i++) {
                const vars = {
                    index: i,
                    data: new Array(1000).fill(0).map((_, j) => ({ id: j, value: `item_${i}_${j}` }))
                };
                LoopVariableScope.push(vars);

                // 验证变量可以访问
                expect(LoopVariableScope.getValue("index")).toBe(i);

                // 弹出
                LoopVariableScope.pop();
            }

            // 最终应该完全清理
            expect(LoopVariableScope.getDepth()).toBe(0);
            expect(LoopVariableScope.isInsideLoop()).toBe(false);
            expect(LoopVariableScope.current()).toBeUndefined();
        });

        it("clear()方法应该完全重置作用域", () => {
            // 创建多层嵌套
            LoopVariableScope.push({ level: 1 });
            LoopVariableScope.push({ level: 2 });
            LoopVariableScope.push({ level: 3 });

            expect(LoopVariableScope.getDepth()).toBe(3);

            // 使用clear方法
            LoopVariableScope.clear();

            expect(LoopVariableScope.getDepth()).toBe(0);
            expect(LoopVariableScope.isInsideLoop()).toBe(false);
            expect(LoopVariableScope.getValue("level")).toBeUndefined();
        });
    });
});