import { LoopFormAction } from "src/model/action/LoopFormAction";
import { LoopType } from "src/model/enums/LoopType";
import { ActionContext } from "src/service/action/IActionService";
import { FormTemplateProcessEngine } from "src/service/engine/FormTemplateProcessEngine";
import { DebugLogger } from "./DebugLogger";

export class LoopDataResolver {
    /**
     * 根据循环类型解析迭代数据
     */
    static async resolveIterations(
        action: LoopFormAction,
        context: ActionContext
    ): Promise<any[]> {
        switch (action.loopType) {
            case LoopType.LIST:
                return await this.resolveListDataSource(action.listDataSource, context);
            case LoopType.COUNT:
                return this.generateCountIterations(
                    action.countStart ?? 0,
                    action.countEnd ?? 0,
                    action.countStep ?? 1
                );
            case LoopType.CONDITION:
            case LoopType.PAGINATION:
                // 条件/分页循环不预生成迭代数组，由执行阶段根据条件控制
                return [];
            default:
                return [];
        }
    }

    /**
     * 解析列表数据源
     */
    static async resolveListDataSource(
        dataSource: string | undefined,
        context: ActionContext
    ): Promise<any[]> {
        if (!dataSource) {
            return [];
        }

        const directValue = this.getValueFromStateByPath(dataSource, context);
        if (Array.isArray(directValue)) {
            return directValue;
        }

        const templateValue = await this.resolveTemplateString(dataSource, context);

        if (Array.isArray(templateValue)) {
            return templateValue;
        }

        const trimmed = typeof templateValue === "string" ? templateValue.trim() : "";
        if (!trimmed) {
            return [];
        }

        const boundValue = this.getValueFromStateByPath(trimmed, context);
        if (Array.isArray(boundValue)) {
            return boundValue;
        }

        if (typeof boundValue === "object" && boundValue !== null) {
            return Array.isArray(boundValue) ? boundValue : Object.values(boundValue);
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            // ignore json parsing errors
        }

        if (trimmed.includes("\n")) {
            return trimmed
                .split("\n")
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
        }

        if (trimmed.includes(",")) {
            return trimmed
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
        }

        return [trimmed];
    }

    /**
     * 计算条件表达式
     */
    static async evaluateCondition(
        expression: string | undefined,
        context: ActionContext
    ): Promise<boolean> {
        if (!expression) {
            return false;
        }

        const templated = await this.resolveTemplateString(expression, context);
        const trimmed = typeof templated === "string" ? templated.trim() : templated;

        if (typeof trimmed === "boolean") {
            return trimmed;
        }

        if (typeof trimmed === "number") {
            return trimmed !== 0;
        }

        if (typeof trimmed !== "string") {
            return Boolean(trimmed);
        }

        const boundValue = this.getValueFromStateByPath(trimmed, context);
        if (typeof boundValue === "boolean") {
            return boundValue;
        }

        try {
            const evaluator = new Function(
                "context",
                "state",
                "values",
                `return Boolean(${trimmed});`
            );
            return evaluator(context, context.state, context.state?.values ?? {});
        } catch (error) {
            DebugLogger.warn("[LoopDataResolver] 条件表达式解析失败:", trimmed, error);
            return false;
        }
    }

    /**
     * 生成计数循环序列
     */
    static generateCountIterations(start: number, end: number, step: number): number[] {
        if (step === 0) {
            throw new Error("Loop step cannot be 0");
        }

        const direction = start <= end ? Math.abs(step) : -Math.abs(step);
        const iterations: number[] = [];

        if (direction > 0) {
            for (let current = start; current <= end; current += direction) {
                iterations.push(current);
            }
        } else {
            for (let current = start; current >= end; current += direction) {
                iterations.push(current);
            }
        }

        return iterations;
    }

    private static async resolveTemplateString(
        value: any,
        context: ActionContext
    ): Promise<any> {
        if (typeof value !== "string" || value.trim() === "") {
            return value;
        }

        if (!value.includes("{{")) {
            return value;
        }

        const engine = new FormTemplateProcessEngine();
        return await engine.process(value, context.state, context.app);
    }

    private static getValueFromStateByPath(path: string, context: ActionContext): any {
        if (!path) {
            return undefined;
        }
        const trimmed = path.trim();
        if (!trimmed) {
            return undefined;
        }

        const directValue =
            context.state?.values?.[trimmed] ?? context.state?.idValues?.[trimmed];
        if (directValue !== undefined) {
            return directValue;
        }

        if (!trimmed.includes(".")) {
            return undefined;
        }

        const segments = trimmed.split(".").filter((segment) => segment.length > 0);
        if (segments.length === 0) {
            return undefined;
        }

        const fromValues = this.getValueBySegments(context.state?.values, segments);
        if (fromValues !== undefined) {
            return fromValues;
        }

        return this.getValueBySegments(context as any, segments);
    }

    private static getValueBySegments(target: any, segments: string[]): any {
        if (!target) {
            return undefined;
        }
        let current = target;
        for (const segment of segments) {
            if (current === undefined || current === null) {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    }
}


