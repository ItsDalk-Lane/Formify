import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { FilterService } from "src/service/filter/FilterService";
import { Filter, FilterType } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { ActionContext } from "src/service/action/IActionService";
import { FormState } from "src/service/FormState";
import { FormConfig } from "src/model/FormConfig";
import { App } from "obsidian";

const createTestContext = (): ActionContext => {
    const state: FormState = {
        idValues: {},
        values: {},
    };

    return {
        state,
        config: new FormConfig("test"),
        app: {} as App,
    };
};

describe("循环变量之间的比较测试", () => {
    beforeEach(() => {
        LoopVariableScope.clear();
    });

    afterEach(() => {
        LoopVariableScope.clear();
    });

    describe("基本变量比较", () => {
        it("应该能够比较 index 和 total", () => {
            // 设置循环变量
            const loopVars = {
                index: 2,
                total: 5,
                item: "test_item"
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 创建条件：index < total
            const condition: Filter = {
                id: "test-comparison-1",
                type: FilterType.filter,
                property: "index",
                operator: OperatorType.LessThan,
                value: "total", // 使用字符串表示total变量
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => {
                    if (!property) return undefined;
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }
                    return context.state.idValues[property];
                },
                (value) => {
                    // 如果value是字符串，尝试从循环变量中获取
                    if (typeof value === 'string' && value.trim()) {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                        return context.state.idValues[value.trim()];
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // 2 < 5 应该为true
        });

        it("应该能够比较 index 和 index（总是相等）", () => {
            const loopVars = {
                index: 3,
                total: 10
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 创建条件：index equals index
            const condition: Filter = {
                id: "test-comparison-2",
                type: FilterType.filter,
                property: "index",
                operator: OperatorType.Equals,
                value: "index",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // index 应该等于自己
        });

        it("应该能够比较 iteration 和 total", () => {
            const loopVars = {
                index: 4,
                total: 5,
                iteration: 5
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 创建条件：iteration equals total
            const condition: Filter = {
                id: "test-comparison-3",
                type: FilterType.filter,
                property: "iteration",
                operator: OperatorType.Equals,
                value: "total",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // 5 equals 5
        });

        it("应该能够比较 item 和字符串值", () => {
            const loopVars = {
                index: 0,
                item: "special_item",
                total: 3
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 创建条件：item equals "special_item"
            const condition: Filter = {
                id: "test-comparison-4",
                type: FilterType.filter,
                property: "item",
                operator: OperatorType.Equals,
                value: "special_item", // 直接字符串值
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // item equals "special_item"
        });

        it("应该能够处理不存在的循环变量", () => {
            const loopVars = {
                index: 1,
                total: 3
                // 故意不包含nonexistent变量
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            // 创建条件：index equals nonexistent
            const condition: Filter = {
                id: "test-comparison-5",
                type: FilterType.filter,
                property: "index",
                operator: OperatorType.Equals,
                value: "nonexistent", // 不存在的变量
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                        return context.state.idValues[value.trim()];
                    }
                    return value;
                }
            );

            expect(result).toBe(false); // 1 不等于 undefined，应该是false
        });
    });

    describe("数值比较运算符", () => {
        it("应该支持大于运算符", () => {
            const loopVars = {
                index: 7,
                total: 10
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            const condition: Filter = {
                id: "test-greater",
                type: FilterType.filter,
                property: "total",
                operator: OperatorType.GreaterThan,
                value: "index",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // 10 > 7
        });

        it("应该支持小于等于运算符", () => {
            const loopVars = {
                index: 2,
                total: 2
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            const condition: Filter = {
                id: "test-less-equal",
                type: FilterType.filter,
                property: "index",
                operator: OperatorType.LessThanOrEqual,
                value: "total",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // 2 <= 2
        });
    });

    describe("字符串相等比较", () => {
        it("应该支持字符串变量相等比较", () => {
            const loopVars = {
                item: "hello",
                status: "hello"
            };
            LoopVariableScope.push(loopVars);

            const context = createTestContext();

            const condition: Filter = {
                id: "test-string-equals",
                type: FilterType.filter,
                property: "item",
                operator: OperatorType.Equals,
                value: "status",
                conditions: []
            };

            const result = FilterService.match(
                condition,
                (property) => property ? LoopVariableScope.getValue(property) : undefined,
                (value) => {
                    if (typeof value === 'string') {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    return value;
                }
            );

            expect(result).toBe(true); // "hello" equals "hello"
        });
    });
});