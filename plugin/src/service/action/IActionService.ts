import { App } from "obsidian";
import { IFormAction } from "../../model/action/IFormAction";
import { FormConfig } from "../../model/FormConfig";
import { FormState } from "../FormState";
import CreateFileActionService from "./create-file/CreateFileActionService";
import GenerateFormActionService from "./generate-form/GenerateFormActionService";
import InsertTextActionService from "./insert-text/InsertTextActionService";
import RunScriptActionService from "./run-script/RunScriptActionService";
import SuggestModalActionService from "./suggest-modal/SuggestModalActionService";
import UpdateFrontmatterActionService from "./update-frontmatter/UpdateFrontmatterActionService";
import WaitActionService from "./wait/WaitActionService";
import { hasConditions } from "./util/hasConditions";
import { FilterService } from "../filter/FilterService";
import { RunCommandActionService } from "./run-command/RunCommandActionService";
import { ButtonActionService } from "./button/ButtonActionService";
import { TextActionService } from "./text/TextActionService";
import AIActionService from "./ai/AIActionService";
import LoopActionService from "./loop/LoopActionService";
import { BreakActionService } from "./loop/BreakActionService";
import { ContinueActionService } from "./loop/ContinueActionService";
import { LoopVariableScope } from "../../utils/LoopVariableScope";
import type { ExtendedConditionContext } from "../filter/ExtendedConditionEvaluator";
import { ConditionVariableResolver } from "../../utils/ConditionVariableResolver";

export interface IActionService {

    accept(action: IFormAction, context: ActionContext): boolean;

    run(action: IFormAction, context: ActionContext, chain: ActionChain): Promise<any>;
}

export interface LoopContext {
    variables: Record<string, any>;
    depth: number;
    canBreak: boolean;
    canContinue: boolean;
    breakRequested?: boolean;
    continueRequested?: boolean;
    parent?: LoopContext;
}

export interface ActionContext {
    state: FormState;
    config: FormConfig;
    app: App;
    abortSignal?: AbortSignal;  // 用于中断表单执行的信号
    loopContext?: LoopContext;
}

export class ActionChain {
    index = 0;
    actions: IFormAction[] = [];

    private actionServices: IActionService[] = [
        new CreateFileActionService(),
        new InsertTextActionService(),
        new RunScriptActionService(),
        new SuggestModalActionService(),
        new UpdateFrontmatterActionService(),
        new RunCommandActionService(),
        new GenerateFormActionService(),
        new WaitActionService(),
        new ButtonActionService(),
        new TextActionService(),
        new AIActionService(),
        new LoopActionService(),
        new BreakActionService(),
        new ContinueActionService(),
    ]

    constructor(actions: IFormAction[]) {
        this.actions = actions;
    }

    validate(context: ActionContext) {
        // ensure all action can match a service to run
        for (const action of this.actions) {
            const actionService = this.actionServices.find(service => service.accept(action, context));
            if (!actionService) {
                throw new Error(`No action service found for action type ${action.type}`);
            }
        }
    }

    async next(context: ActionContext): Promise<void> {
        // 检查是否已中断
        if (context.abortSignal?.aborted) {
            return Promise.resolve();
        }
        
        if (this.index >= this.actions.length) {
            return Promise.resolve();
        }

        const action = this.actions[this.index];
        this.index++;
        
        // 执行前再次检查
        if (context.abortSignal?.aborted) {
            return Promise.resolve();
        }

        // 检查条件
        if (action.condition) {
            // 创建扩展条件评估上下文
            const extendedContext: ExtendedConditionContext = {
                app: context.app,
                currentFile: context.app.workspace.getActiveFile(),
                formConfig: context.config,
                formValues: context.state.idValues,
            };
            
            const result = FilterService.match(
                action.condition,
                (property) => {
                    if (!property) {
                        return undefined;
                    }

                    // 优先从循环变量作用域获取变量值
                    const loopValue = LoopVariableScope.getValue(property);
                    if (loopValue !== undefined) {
                        return loopValue;
                    }

                    // 然后从表单状态获取变量值
                    return context.state.idValues[property];
                },
                (value) => {
                    // 如果value是字符串，尝试从循环变量中获取（完整匹配）
                    if (typeof value === 'string' && value.trim()) {
                        const loopValue = LoopVariableScope.getValue(value.trim());
                        if (loopValue !== undefined) {
                            return loopValue;
                        }
                    }
                    // 使用变量解析器解析条件值中的变量引用
                    return ConditionVariableResolver.resolve(value, {
                        formConfig: context.config,
                        formValues: context.state.idValues,
                    });
                },
                context.config.fields,  // 传递字段定义数组
                extendedContext  // 传递扩展条件上下文
            );
            
            if (!result) {
                // 条件不匹配，直接跳到下一个
                return this.next(context);
            }
        }

        // 条件匹配或无条件，执行当前动作
        const service = this.actionServices.find(s => s.accept(action, context));
        if (!service) {
            throw new Error(`No action service found for action type ${action.type}`);
        }
        
        await service.run(action, context, this);

        // 继续执行下一个动作
        return this.next(context);
    }
}
