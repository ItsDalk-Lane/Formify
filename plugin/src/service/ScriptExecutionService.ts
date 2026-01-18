import type { App } from "obsidian";
import * as vm from "vm";
import { FormScriptComipler } from "./extend/FormScriptComipler";
import { FormScriptRunner } from "./extend/FormScriptRunner";
import { getServiceContainer } from "./ServiceContainer";
import { localInstance } from "src/i18n/locals";

export type ScriptSource = "snippet" | "form-inline" | "form-expression";

export interface ScriptExecutionOptions {
    script?: string;
    code?: string;
    expression?: string;
    args?: Record<string, any>;
    timeout?: number;
    source?: ScriptSource;
    context?: Record<string, any>;
}

export interface ScriptExecutionResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    returnValue?: any;
    duration: number;
    error?: string;
}

export class ScriptExecutionService {
    constructor(private readonly app?: App) {}

    async executeScript(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
        const source = options.source ?? "snippet";
        if (source === "form-inline") {
            return await this.executeFormInline(options);
        }
        if (source === "form-expression") {
            return await this.executeFormExpression(options);
        }
        return await this.executeSnippet(options);
    }

    private async executeSnippet(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
        const code = String(options.script ?? options.code ?? "");
        const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : 5000;
        const scriptArgs = options.args ?? {};

        if (!code.trim()) {
            return {
                success: false,
                duration: 0,
                error: "script 不能为空。请提供要执行的脚本代码或脚本名称",
            };
        }

        const outputLines: string[] = [];
        const safeConsole = {
            log: (...items: unknown[]) => outputLines.push(items.map(String).join(" ")),
            info: (...items: unknown[]) => outputLines.push(items.map(String).join(" ")),
            warn: (...items: unknown[]) => outputLines.push(items.map(String).join(" ")),
            error: (...items: unknown[]) => outputLines.push(items.map(String).join(" ")),
        };

        const sandbox = {
            console: safeConsole,
            args: scriptArgs,
        };

        const start = Date.now();
        try {
            const context = vm.createContext(sandbox);
            const wrappedCode = `"use strict";\n(() => {\n${code}\n})()`;
            const script = new vm.Script(wrappedCode);
            const resultValue = script.runInContext(context, { timeout });
            const executionTime = Date.now() - start;
            return {
                success: true,
                returnValue: resultValue,
                stdout: outputLines.join("\n"),
                duration: executionTime,
            };
        } catch (error) {
            const executionTime = Date.now() - start;
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                returnValue: null,
                stdout: outputLines.join("\n"),
                duration: executionTime,
                error: `执行失败: ${message}`,
            };
        }
    }

    private async executeFormInline(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
        const start = Date.now();
        const app = this.app;
        if (!app) {
            return {
                success: false,
                duration: 0,
                error: localInstance.unknown_error,
            };
        }

        const code = String(options.script ?? options.code ?? "");
        if (!code.trim()) {
            return {
                success: false,
                duration: 0,
                error: "脚本内容不能为空",
            };
        }

        try {
            const extension = await FormScriptComipler.compile("inline", code, { name: "entry" });
            if (!extension) {
                return {
                    success: false,
                    duration: Date.now() - start,
                    error: "脚本编译失败",
                };
            }

            const contextOptions = {
                ...(options.context ?? {}),
                args: options.args ?? {},
            };
            const resultValue = await FormScriptRunner.runFunction(app, extension, contextOptions);
            return {
                success: true,
                returnValue: resultValue,
                duration: Date.now() - start,
            };
        } catch (error) {
            return {
                success: false,
                returnValue: null,
                duration: Date.now() - start,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async executeFormExpression(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
        const start = Date.now();
        const app = this.app;
        if (!app) {
            return {
                success: false,
                duration: 0,
                error: localInstance.unknown_error,
            };
        }

        const expression = String(options.expression ?? options.script ?? "");
        if (!expression.trim()) {
            return {
                success: false,
                duration: 0,
                error: "脚本表达式不能为空",
            };
        }

        try {
            const formScriptService = getServiceContainer().formScriptService;
            const contextOptions = {
                ...(options.context ?? {}),
                args: options.args ?? {},
            };
            const resultValue = await formScriptService.run(expression, contextOptions);
            return {
                success: true,
                returnValue: resultValue,
                duration: Date.now() - start,
            };
        } catch (error) {
            return {
                success: false,
                returnValue: null,
                duration: Date.now() - start,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
