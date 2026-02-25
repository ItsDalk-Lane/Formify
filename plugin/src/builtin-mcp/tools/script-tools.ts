import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App, FileSystemAdapter, Platform } from 'obsidian';
import { z } from 'zod';
import {
	DEFAULT_SHELL_MAX_BUFFER,
	DEFAULT_SHELL_TIMEOUT_MS,
} from '../constants';
import { ScriptRuntime } from '../runtime/script-runtime';
import { registerTextTool } from '../runtime/register-tool';
import { BuiltinToolRegistry } from '../runtime/tool-registry';
import { normalizeVaultPath } from './helpers';

const executeScriptSchema = z.object({
	script: z.string().min(1).describe('要执行的 JavaScript 脚本'),
});

const callShellSchema = z.object({
	command: z.string().min(1).describe('要执行的 shell 命令'),
	cwd: z.string().optional().describe('工作目录，默认 Vault 根目录绝对路径'),
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
	registerTextTool(
		server,
		registry,
		'execute_script',
		'在沙箱中执行 JavaScript。可用 API: call_tool(name,args)、moment()。',
		executeScriptSchema,
		async ({ script }) => {
			return await scriptRuntime.execute(script);
		}
	);

	registerTextTool(
		server,
		registry,
		'call_shell',
		'执行 shell 命令（仅桌面端支持）。',
		callShellSchema,
		async ({ command, cwd }) => {
			if (!Platform.isDesktopApp && !Platform.isDesktop) {
				return {
					supported: false,
					message: 'call_shell 仅支持桌面端',
					stdout: '',
					stderr: '',
					exitCode: -1,
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
						});
					}
				);
			});
		}
	);
}
