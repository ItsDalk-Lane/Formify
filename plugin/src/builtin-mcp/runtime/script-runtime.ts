import { DEFAULT_SCRIPT_TIMEOUT_MS } from '../constants';

type AsyncFunctionType = new (
	...args: string[]
) => (...fnArgs: unknown[]) => Promise<unknown>;

const AsyncFunctionCtor = Object.getPrototypeOf(
	async function () {
		// noop
	}
).constructor as AsyncFunctionType;

const blockedPatterns: RegExp[] = [
	/\brequire\s*\(/i,
	/\bimport\s+/i,
	/\bprocess\b/i,
	/\bglobalThis\b/i,
	/\bwindow\b/i,
	/\bdocument\b/i,
	/\bFunction\s*\(/i,
	/\beval\s*\(/i,
	/\bXMLHttpRequest\b/i,
	/\bfetch\s*\(/i,
	/\bWebSocket\b/i,
	/\bwhile\s*\(\s*true\s*\)/i,
	/\bfor\s*\(\s*;\s*;\s*\)/i,
];

export interface ScriptRuntimeDependencies {
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
	momentFactory: (...args: unknown[]) => unknown;
}

interface ActiveRun {
	timer: ReturnType<typeof setTimeout>;
	reject: (error: Error) => void;
}

export class ScriptRuntime {
	private readonly activeRuns = new Map<number, ActiveRun>();
	private nextRunId = 1;
	private disposed = false;

	constructor(
		private readonly dependencies: ScriptRuntimeDependencies,
		private readonly defaultTimeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS
	) {}

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new Error('脚本运行时已关闭');
		}
	}

	private validateScript(script: string): void {
		const source = String(script ?? '').trim();
		if (!source) {
			throw new Error('script 不能为空');
		}

		for (const pattern of blockedPatterns) {
			if (pattern.test(source)) {
				throw new Error(`脚本包含不允许的语法: ${pattern}`);
			}
		}
	}

	async execute(script: string, timeoutMs?: number): Promise<unknown> {
		this.assertNotDisposed();
		this.validateScript(script);

		const timeout = Number.isFinite(timeoutMs)
			? Math.max(1, Number(timeoutMs))
			: this.defaultTimeoutMs;
		const runId = this.nextRunId++;

		return await new Promise<unknown>((resolve, reject) => {
			let settled = false;
			const complete = (handler: () => void): void => {
				if (settled) return;
				settled = true;
				const active = this.activeRuns.get(runId);
				if (active) {
					clearTimeout(active.timer);
					this.activeRuns.delete(runId);
				}
				handler();
			};

			const timer = setTimeout(() => {
				complete(() => reject(new Error(`脚本执行超时 (${timeout}ms)`)));
			}, timeout);

			this.activeRuns.set(runId, {
				timer,
				reject: (error: Error) => complete(() => reject(error)),
			});

			const callTool = async (
				name: string,
				args: Record<string, unknown> = {}
			): Promise<unknown> => {
				this.assertNotDisposed();
				const toolName = String(name ?? '').trim();
				if (!toolName) {
					throw new Error('call_tool 的 name 不能为空');
				}
				return await this.dependencies.callTool(toolName, args ?? {});
			};

			const moment = (...args: unknown[]): unknown => {
				return this.dependencies.momentFactory(...args);
			};

			try {
				const fn = new AsyncFunctionCtor('call_tool', 'moment', script);
				Promise.resolve(fn(callTool, moment))
					.then((result) => complete(() => resolve(result)))
					.catch((error: unknown) => {
						const message =
							error instanceof Error ? error.message : String(error);
						complete(() => reject(new Error(message)));
					});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				complete(() => reject(new Error(message)));
			}
		});
	}

	reset(): void {
		this.disposed = true;
		for (const [runId, active] of this.activeRuns) {
			clearTimeout(active.timer);
			active.reject(new Error('脚本运行时已停止'));
			this.activeRuns.delete(runId);
		}
	}
}
