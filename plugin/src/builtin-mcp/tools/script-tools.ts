import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, FileSystemAdapter, Platform } from 'obsidian';
import { z } from 'zod';
import {
	DEFAULT_SHELL_MAX_BUFFER,
	DEFAULT_SHELL_TIMEOUT_MS,
} from '../constants';
import { ScriptRuntime } from '../runtime/script-runtime';
import { registerBuiltinTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import { normalizeVaultPath } from './helpers';

const executeScriptSchema = z.object({
	script: z
		.string()
		.min(1)
		.max(12_000)
		.describe('要执行的受限 JavaScript 脚本；可用 API 为 call_tool(name,args) 与 moment()'),
});

const callShellSchema = z.object({
	command: z
		.string()
		.min(1)
		.max(4_000)
		.describe('要执行的本机 shell 命令'),
	cwd: z.string().optional().describe('工作目录，默认 Vault 根目录绝对路径'),
});

const callShellResultSchema = z.object({
	supported: z.boolean(),
	cwd: z.string(),
	stdout: z.string(),
	stderr: z.string(),
	exitCode: z.number().int(),
	timedOut: z.boolean(),
});

const resolveVaultBasePath = (app: App): string | null => {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}

	const maybeAdapter = adapter as unknown as {
		getBasePath?: () => string;
	};
	if (typeof maybeAdapter.getBasePath === 'function') {
		return maybeAdapter.getBasePath();
	}
	return null;
};

const resolveCwd = (basePath: string, cwd?: string): string => {
	const raw = String(cwd ?? '').trim();
	if (!raw) return basePath;
	if (raw.startsWith('/') || raw.match(/^[a-zA-Z]:\\/)) {
		return raw;
	}
	const relative = normalizeVaultPath(raw);
	if (!relative) return basePath;
	return `${basePath}/${relative}`;
};

export function registerScriptTools(
	server: McpServer,
	app: App,
	registry: BuiltinToolRegistry,
	scriptRuntime: ScriptRuntime
): void {
	registerBuiltinTool(
		server,
		registry,
		'run_script',
		{
			title: '执行受限脚本',
			description:
				'做什么：在受限脚本运行时中执行 JavaScript，用于多步工具编排、条件判断和结果拼装。\n什么时候用：需要连续调用多个工具、根据结果分支处理，或把多个工具结果组合成一个答案时使用。\n不要在什么场景用：不要用于执行本机命令、访问系统资源或直接读写操作系统文件；这类场景请使用 run_shell 或专用文件工具。\n返回什么：脚本执行结果；脚本内只可使用 call_tool(name,args) 与 moment()。\n失败后下一步怎么做：如果需要执行本机命令，请改用 run_shell；如果只是调用单个工具，不要继续重试 run_script。',
			inputSchema: executeScriptSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ script }) => {
			return await scriptRuntime.execute(script);
		}
	);

	registerBuiltinTool(
		server,
		registry,
		'run_shell',
		{
			title: '执行本机 Shell',
			description:
				'做什么：执行本机 shell 命令（仅桌面端支持）。\n什么时候用：确实需要调用 OS/CLI 命令、脚本文件或外部程序时使用。\n不要在什么场景用：不要用于工具编排、条件分支或文件读取抽象；这类场景请使用 run_script 或对应的文件工具。\n返回什么：supported、cwd、stdout、stderr、exitCode、timedOut。\n失败后下一步怎么做：如果只是想让多个工具协作，请改用 run_script；如果命令依赖桌面环境，请确认当前平台支持。',
			inputSchema: callShellSchema,
			outputSchema: callShellResultSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ command, cwd }) => {
			if (!Platform.isDesktopApp && !Platform.isDesktop) {
				return {
					supported: false,
					cwd: '',
					stdout: '',
					stderr: '',
					exitCode: -1,
					timedOut: false,
				};
			}

			const basePath = resolveVaultBasePath(app);
			if (!basePath) {
				throw new Error('无法获取 Vault 根目录绝对路径');
			}
			const resolvedCwd = resolveCwd(basePath, cwd);

			const { exec } =
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				(require('child_process') as typeof import('child_process'));

			return await new Promise<{
				supported: boolean;
				cwd: string;
				stdout: string;
				stderr: string;
				exitCode: number;
			}>((resolve) => {
				exec(
					command,
					{
						cwd: resolvedCwd,
						timeout: DEFAULT_SHELL_TIMEOUT_MS,
						maxBuffer: DEFAULT_SHELL_MAX_BUFFER,
					},
					(error, stdout, stderr) => {
						resolve({
							supported: true,
							cwd: resolvedCwd,
							stdout: stdout ?? '',
							stderr: stderr ?? '',
							exitCode:
								error && typeof error.code === 'number'
									? error.code
									: 0,
							timedOut: Boolean(
								error
								&& typeof error === 'object'
								&& 'killed' in error
								&& (error as { killed?: boolean }).killed
							),
						});
					}
				);
			});
		}
	);
}
