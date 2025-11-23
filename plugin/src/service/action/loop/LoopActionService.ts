import { IFormAction } from "src/model/action/IFormAction";
import { LoopFormAction, PaginationLoopConfig } from "src/model/action/LoopFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { LoopType } from "src/model/enums/LoopType";
import { ActionGroup } from "src/model/ActionGroup";
import { LoopDataResolver } from "src/utils/LoopDataResolver";
import { LoopVariableValidator } from "src/utils/LoopVariableValidator";
import { ErrorHandlingStrategy } from "src/model/enums/ErrorHandlingStrategy";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { DebugLogger } from "src/utils/DebugLogger";
import {
    ActionChain,
    ActionContext,
    IActionService,
    LoopContext,
} from "../IActionService";
import {
    LoopBreakError,
    LoopContinueError,
    LoopMaxIterationError,
    LoopTimeoutError,
} from "./LoopControlError";

type IterationResult = "continue" | "break";

export default class LoopActionService implements IActionService {
    accept(action: IFormAction): boolean {
        return action.type === FormActionType.LOOP;
    }

    async run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<void> {
        const loopAction = action as LoopFormAction;
        const actionGroup = this.resolveActionGroup(loopAction, context);

        if (!actionGroup) {
            DebugLogger.warn("[LoopAction] 未找到嵌套动作，跳过执行", loopAction.id);
            await chain.next(context);
            return;
        }

        const loopStartTime = Date.now();

        switch (loopAction.loopType) {
            case LoopType.LIST: {
                const items = await LoopDataResolver.resolveListDataSource(
                    loopAction.listDataSource,
                    context
                );
                await this.executeIterableLoop(items, loopAction, actionGroup, context, loopStartTime);
                break;
            }
            case LoopType.COUNT: {
                const iterations = LoopDataResolver.generateCountIterations(
                    loopAction.countStart ?? 0,
                    loopAction.countEnd ?? 0,
                    loopAction.countStep ?? 1
                );
                await this.executeIterableLoop(iterations, loopAction, actionGroup, context, loopStartTime);
                break;
            }
            case LoopType.CONDITION:
                await this.executeConditionLoop(loopAction, actionGroup, context, loopStartTime);
                break;
            case LoopType.PAGINATION:
                await this.executePaginationLoop(loopAction, actionGroup, context, loopStartTime);
                break;
            default:
                DebugLogger.warn("[LoopAction] 未知循环类型: ", loopAction.loopType);
                break;
        }

        await chain.next(context);
    }

    private resolveActionGroup(action: LoopFormAction, context: ActionContext): ActionGroup | undefined {
        if (!action.actionGroupId) {
            return undefined;
        }
        return context.config.actionGroups?.find((group) => group.id === action.actionGroupId);
    }

    private async executeIterableLoop(
        items: any[],
        loopAction: LoopFormAction,
        actionGroup: ActionGroup,
        context: ActionContext,
        loopStartTime: number
    ): Promise<void> {
        const total = items.length;
        for (let index = 0; index < items.length; index++) {
            this.ensureNotAborted(context);
            this.ensureLoopTimeout(loopAction, loopStartTime);
            this.ensureMaxIterations(loopAction, index);

            const result = await this.executeSingleIteration(
                {
                    value: items[index],
                    index,
                    total,
                },
                loopAction,
                actionGroup,
                context
            );

            if (result === "break") {
                break;
            }
        }
    }

    private async executeConditionLoop(
        loopAction: LoopFormAction,
        actionGroup: ActionGroup,
        context: ActionContext,
        loopStartTime: number
    ): Promise<void> {
        if (!loopAction.conditionExpression) {
            DebugLogger.warn("[LoopAction] 条件循环缺少条件表达式");
            return;
        }

        let index = 0;
        while (true) {
            this.ensureNotAborted(context);
            this.ensureLoopTimeout(loopAction, loopStartTime);
            this.ensureMaxIterations(loopAction, index);

            const shouldContinue = await LoopDataResolver.evaluateCondition(
                loopAction.conditionExpression,
                context
            );
            if (!shouldContinue) {
                break;
            }

            const result = await this.executeSingleIteration(
                {
                    value: index,
                    index,
                    total: undefined,
                },
                loopAction,
                actionGroup,
                context
            );

            index++;
            if (result === "break") {
                break;
            }
        }
    }

    private async executePaginationLoop(
        loopAction: LoopFormAction,
        actionGroup: ActionGroup,
        context: ActionContext,
        loopStartTime: number
    ): Promise<void> {
        const pagination = loopAction.paginationConfig;
        if (!pagination) {
            DebugLogger.warn("[LoopAction] 分页循环缺少配置");
            return;
        }

        let pageIndex = 0;
        let currentPage = loopAction.countStart ?? 1;
        const maxPages = pagination.maxPages ?? loopAction.maxIterations;

        while (true) {
            this.ensureNotAborted(context);
            this.ensureLoopTimeout(loopAction, loopStartTime);
            this.ensureMaxIterations(loopAction, pageIndex);

            const extraVariables: Record<string, any> = {
                currentPage,
            };

            if (pagination.currentPageVariable) {
                extraVariables[pagination.currentPageVariable] = currentPage;
            }
            if (pagination.pageSizeVariable && loopAction.countStep !== undefined) {
                extraVariables[pagination.pageSizeVariable] = Math.abs(loopAction.countStep);
            }
            if (pagination.totalPageVariable) {
                extraVariables[pagination.totalPageVariable] = maxPages;
            }

            const result = await this.executeSingleIteration(
                {
                    value: currentPage,
                    index: pageIndex,
                    total: maxPages,
                    extraVariables,
                },
                loopAction,
                actionGroup,
                context
            );

            pageIndex++;
            currentPage++;

            if (result === "break") {
                break;
            }

            if (pagination.requestInterval && pagination.requestInterval > 0) {
                await this.delay(pagination.requestInterval);
            }

            const hasNext = await LoopDataResolver.evaluateCondition(
                pagination.hasNextPageCondition,
                context
            );
            if (!hasNext) {
                break;
            }
        }
    }

    private async executeSingleIteration(
        payload: {
            value: any;
            index: number;
            total?: number;
            extraVariables?: Record<string, any>;
        },
        loopAction: LoopFormAction,
        actionGroup: ActionGroup,
        context: ActionContext
    ): Promise<IterationResult> {
        if (loopAction.showProgress) {
            DebugLogger.debug(
                `[LoopAction] 执行进度 ${payload.index + 1}/${payload.total ?? "?"}`
            );
        }

        const loopContext = this.createLoopContext(loopAction, payload, context.loopContext);
        const iterationContext: ActionContext = {
            ...context,
            loopContext,
        };

        // 创建循环变量元数据
        const variableMeta = LoopVariableScope.createStandardVariableMeta(loopContext.variables);
        LoopVariableScope.push(loopContext.variables, variableMeta);
        try {
            await this.runActionGroupWithStrategy(loopAction, actionGroup, iterationContext);
        } catch (error) {
            if (error instanceof LoopBreakError) {
                return "break";
            }
            if (error instanceof LoopContinueError) {
                return "continue";
            }
            throw error;
        } finally {
            LoopVariableScope.pop();
        }

        if (loopContext.breakRequested) {
            return "break";
        }
        if (loopContext.continueRequested) {
            return "continue";
        }

        return "continue";
    }

    private async runActionGroupWithStrategy(
        loopAction: LoopFormAction,
        actionGroup: ActionGroup,
        iterationContext: ActionContext
    ): Promise<void> {
        const strategy = this.resolveErrorStrategy(loopAction, actionGroup);
        const maxRetry = strategy === ErrorHandlingStrategy.RETRY ? loopAction.retryCount ?? 0 : 0;
        let attempt = 0;

        while (true) {
            const subChain = new ActionChain(actionGroup.actions ?? []);
            const iterationStart = Date.now();

            try {
                await subChain.next(iterationContext);

                if (loopAction.singleIterationTimeout) {
                    const duration = Date.now() - iterationStart;
                    if (duration > loopAction.singleIterationTimeout) {
                        throw new LoopTimeoutError(loopAction.singleIterationTimeout);
                    }
                }

                return;
            } catch (error) {
                if (error instanceof LoopBreakError || error instanceof LoopContinueError) {
                    throw error;
                }

                if (strategy === ErrorHandlingStrategy.CONTINUE) {
                    DebugLogger.warn("[LoopAction] 遇到错误，按配置跳过当前迭代", error);
                    return;
                }

                if (strategy === ErrorHandlingStrategy.RETRY && attempt < maxRetry) {
                    attempt++;
                    if (loopAction.retryDelay && loopAction.retryDelay > 0) {
                        await this.delay(loopAction.retryDelay);
                    }
                    DebugLogger.warn(
                        `[LoopAction] 发生错误，重试 ${attempt}/${maxRetry}`,
                        error
                    );
                    continue;
                }

                throw error;
            }
        }
    }

    private resolveErrorStrategy(
        loopAction: LoopFormAction,
        actionGroup: ActionGroup
    ): ErrorHandlingStrategy {
        return (
            actionGroup.errorHandlingStrategy ??
            loopAction.errorHandlingStrategy ??
            ErrorHandlingStrategy.STOP
        );
    }

    private createLoopContext(
        loopAction: LoopFormAction,
        payload: {
            value: any;
            index: number;
            total?: number;
            extraVariables?: Record<string, any>;
        },
        parent?: LoopContext
    ): LoopContext {
        const variables = this.createLoopVariables(loopAction, payload);
        if (payload.extraVariables) {
            Object.assign(variables, payload.extraVariables);
        }

        return {
            variables,
            depth: (parent?.depth ?? 0) + 1,
            canBreak: true,
            canContinue: true,
            breakRequested: false,
            continueRequested: false,
            parent,
        };
    }

    private createLoopVariables(
        loopAction: LoopFormAction,
        payload: {
            value: any;
            index: number;
            total?: number;
        }
    ): Record<string, any> {
        const itemKey = LoopVariableValidator.sanitize(loopAction.itemVariableName, "item");
        const indexKey = LoopVariableValidator.sanitize(loopAction.indexVariableName, "index");
        const totalKey = LoopVariableValidator.sanitize(loopAction.totalVariableName, "total");

        const variables: Record<string, any> = {
            item: payload.value,
            index: payload.index,
            total: payload.total,
            iteration: payload.index,
        };

        variables[itemKey] = payload.value;
        variables[indexKey] = payload.index;
        if (payload.total !== undefined) {
            variables[totalKey] = payload.total;
        }

        return variables;
    }

    private ensureMaxIterations(loopAction: LoopFormAction, currentIndex: number): void {
        if (loopAction.maxIterations && currentIndex >= loopAction.maxIterations) {
            throw new LoopMaxIterationError(loopAction.maxIterations);
        }
    }

    private ensureLoopTimeout(loopAction: LoopFormAction, loopStartTime: number): void {
        if (!loopAction.timeout) {
            return;
        }
        const duration = Date.now() - loopStartTime;
        if (duration > loopAction.timeout) {
            throw new LoopTimeoutError(loopAction.timeout);
        }
    }

    private ensureNotAborted(context: ActionContext): void {
        if (context.abortSignal?.aborted) {
            throw new Error("Loop execution aborted");
        }
    }

    private async delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
}


