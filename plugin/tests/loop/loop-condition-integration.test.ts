import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { FilterService } from "src/service/filter/FilterService";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { LoopType } from "src/model/enums/LoopType";
import { ErrorHandlingStrategy } from "src/model/enums/ErrorHandlingStrategy";
import { LoopDataResolver } from "src/utils/LoopDataResolver";
import { ActionContext } from "src/service/action/IActionService";
import { FormState } from "src/service/FormState";
import { FormConfig } from "src/model/FormConfig";
import { App } from "obsidian";

const createTestContext = (): ActionContext => {
    const state: FormState = {
        idValues: {
            globalVar: "global_value"
        },
        values: {
            users: [
                { name: "Alice", age: 25, active: true },
                { name: "Bob", age: 30, active: false },
                { name: "Charlie", age: 35, active: true }
            ]
        },
    };

    return {
        state,
        config: new FormConfig("test"),
        app: {} as App,
    };
};

describe("循环变量条件判断功能", () => {
    beforeEach(() => {
        // 清理作用域
        LoopVariableScope.clear();
    });

    afterEach(() => {
        // 清理作用域
        LoopVariableScope.clear();
    });

    describe("FilterService 集成测试", () => {
        it("应该能够使用循环变量进行简单条件判断", () => {
            // 设置循环变量
            const loopVars = {
                index: 1,
                item: "test_value",
                total: 3,
                iteration: 2
            };
            LoopVariableScope.push(loopVars);

            // 创建条件：index > 0
            const condition: Filter = {
                id: "test-1",
                type: FilterType.filter,
                property: "index",
                operator: OperatorType.GreaterThan,
                value: 0,
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => {
                    if (!property) return undefined;
                    // 优先从循环变量作用域获取
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }
                    return undefined;
                },
                (value) => value
            );

            expect(result).toBe(true);
        });

        it("应该能够使用嵌套的循环变量属性", () => {
            // 设置循环变量，包含对象
            const loopVars = {
                item: { name: "Alice", age: 25, active: true }
            };
            LoopVariableScope.push(loopVars);

            // 注意：FilterService 可能不支持嵌套属性访问，这是另一个问题
            // 这个测试主要验证基本的循环变量访问
            const condition: Filter = {
                id: "test-2",
                type: FilterType.filter,
                property: "item",
                operator: OperatorType.HasValue,
                value: null,
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => value
            );

            expect(result).toBe(true);
        });

        it("应该在循环变量和全局变量冲突时优先使用循环变量", () => {
            // 设置循环变量和全局变量同名
            const loopVars = {
                globalVar: "loop_value"
            };
            LoopVariableScope.push(loopVars);

            const condition: Filter = {
                id: "test-3",
                type: FilterType.filter,
                property: "globalVar",
                operator: OperatorType.Equals,
                value: "loop_value",
                conditions: []
            };

            const context = createTestContext();
            const result = FilterService.match(
                condition,
                (property) => {
                    if (!property) return undefined;
                    // 优先从循环变量作用域获取
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }
                    // 然后从表单状态获取
                    return context.state.idValues[property];
                },
                (value) => value
            );

            expect(result).toBe(true); // 应该匹配循环变量的值
        });

        it("应该支持嵌套循环作用域", () => {
            // 外层循环变量
            const outerLoopVars = {
                outerIndex: 1,
                outerItem: "outer_value"
            };
            LoopVariableScope.push(outerLoopVars);

            // 内层循环变量
            const innerLoopVars = {
                innerIndex: 0,
                innerItem: "inner_value",
                outerIndex: 999 // 覆盖外层的同名变量
            };
            LoopVariableScope.push(innerLoopVars);

            // 测试内层变量优先
            const innerCondition: Filter = {
                id: "test-inner",
                type: FilterType.filter,
                property: "innerIndex",
                operator: OperatorType.Equals,
                value: 0,
                conditions: []
            };

            const result1 = FilterService.match(
                innerCondition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => value
            );
            expect(result1).toBe(true);

            // 测试变量名冲突时内层优先
            const conflictCondition: Filter = {
                id: "test-conflict",
                type: FilterType.filter,
                property: "outerIndex",
                operator: OperatorType.Equals,
                value: 999,
                conditions: []
            };

            const result2 = FilterService.match(
                conflictCondition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => value
            );
            expect(result2).toBe(true); // 应该获取内层的 outerIndex

            // 弹出内层作用域
            LoopVariableScope.pop();

            // 测试外层变量恢复
            const outerCondition: Filter = {
                id: "test-outer",
                type: FilterType.filter,
                property: "outerIndex",
                operator: OperatorType.Equals,
                value: 1,
                conditions: []
            };

            const result3 = FilterService.match(
                outerCondition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => value
            );
            expect(result3).toBe(true); // 应该获取外层的 outerIndex
        });
    });

    describe("LoopDataResolver 条件表达式测试", () => {
        it("应该能够在条件表达式中使用循环变量", async () => {
            // 设置循环变量
            const loopVars = {
                index: 2,
                total: 5,
                item: { status: "active" }
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 测试简单变量引用 - 使用loopVars前缀访问循环变量
            const result1 = await LoopDataResolver.evaluateCondition("loopVars.index < loopVars.total", context);
            expect(result1).toBe(true);

            // 测试布尔表达式
            const result2 = await LoopDataResolver.evaluateCondition("loopVars.index >= 0 && loopVars.index < loopVars.total", context);
            expect(result2).toBe(true);

            // 测试模板变量解析
            const result3 = await LoopDataResolver.evaluateCondition("{{index}} > 1", context);
            expect(result3).toBe(true);
        });

        it("应该支持嵌套循环中的条件表达式", async () => {
            // 外层循环
            const outerLoopVars = {
                index: 0,
                item: "outer_item"
            };
            LoopVariableScope.push(outerLoopVars);

            // 内层循环
            const innerLoopVars = {
                index: 1,
                item: "inner_item"
            };
            LoopVariableScope.push(innerLoopVars);

            const context = createTestContext();

            // 应该使用内层的 index
            const result = await LoopDataResolver.evaluateCondition("loopVars.index === 1", context);
            expect(result).toBe(true);

            LoopVariableScope.pop(); // 弹出内层

            // 现在应该使用外层的 index
            const result2 = await LoopDataResolver.evaluateCondition("loopVars.index === 0", context);
            expect(result2).toBe(true);
        });
    });

    describe("不同循环类型的兼容性测试", () => {
        it("LIST循环应该正确设置循环变量", () => {
            const loopAction: LoopFormAction = {
                id: "test-list",
                type: "loop" as any,
                loopType: LoopType.LIST,
                listDataSource: "names",
                itemVariableName: "currentUser",
                indexVariableName: "currentIndex",
                totalVariableName: "totalCount",
                maxIterations: 1000,
                errorHandlingStrategy: ErrorHandlingStrategy.STOP
            };

            const context = createTestContext();

            // 模拟循环变量创建（这部分逻辑在LoopActionService中）
            const mockLoopVars = {
                item: "Alice",
                index: 0,
                total: 3,
                iteration: 1,
                currentUser: "Alice", // 用户自定义变量名
                currentIndex: 0,
                totalCount: 3
            };

            LoopVariableScope.push(mockLoopVars);

            // 验证可以访问标准循环变量
            expect(LoopVariableScope.getValue("index")).toBe(0);
            expect(LoopVariableScope.getValue("item")).toBe("Alice");
            expect(LoopVariableScope.getValue("total")).toBe(3);
            expect(LoopVariableScope.getValue("iteration")).toBe(1);

            // 验证可以访问用户自定义变量名
            expect(LoopVariableScope.getValue("currentUser")).toBe("Alice");
            expect(LoopVariableScope.getValue("currentIndex")).toBe(0);
            expect(LoopVariableScope.getValue("totalCount")).toBe(3);
        });

        it("COUNT循环应该正确设置数字变量", () => {
            const loopAction: LoopFormAction = {
                id: "test-count",
                type: "loop" as any,
                loopType: LoopType.COUNT,
                countStart: 0,
                countEnd: 3,
                countStep: 1,
                itemVariableName: "item",
                indexVariableName: "index",
                totalVariableName: "total",
                maxIterations: 1000,
                errorHandlingStrategy: ErrorHandlingStrategy.STOP
            };

            // 模拟计数循环变量
            const mockCountLoopVars = {
                item: 2,
                index: 2,
                total: 4,
                iteration: 3
            };

            LoopVariableScope.push(mockCountLoopVars);

            // 验证数字类型正确
            expect(typeof LoopVariableScope.getValue("item")).toBe("number");
            expect(LoopVariableScope.getValue("item")).toBe(2);
            expect(LoopVariableScope.getValue("iteration")).toBe(3);
        });

        it("CONDITION循环应该支持动态条件判断", async () => {
            const loopAction: LoopFormAction = {
                id: "test-condition",
                type: "loop" as any,
                loopType: LoopType.CONDITION,
                conditionExpression: "loopVars.iteration < 5",
                itemVariableName: "item",
                indexVariableName: "index",
                totalVariableName: "total",
                maxIterations: 1000,
                errorHandlingStrategy: ErrorHandlingStrategy.STOP
            };

            // 模拟条件循环的迭代过程
            for (let i = 0; i < 3; i++) {
                const mockConditionVars = {
                    index: i,
                    iteration: i + 1
                };

                LoopVariableScope.push(mockConditionVars);

                const context = createTestContext();
                const shouldContinue = await LoopDataResolver.evaluateCondition(
                    loopAction.conditionExpression!,
                    context
                );

                expect(shouldContinue).toBe(i + 1 < 5);

                LoopVariableScope.pop();
            }
        });
    });
});