/**
 * 基于 child_process.spawn 的 stdio 传输层
 *
 * 通过子进程的 stdin/stdout 进行 JSON-RPC 2.0 通信
 * Windows 兼容：使用 shell: true 确保命令解析
 */

import type { ChildProcess } from 'child_process'
import { DebugLogger } from 'src/utils/DebugLogger'
import type { ITransport, JsonRpcMessage } from './ITransport'

export interface StdioConfig {
	/** 启动命令（如 "npx"、"node"、"python"） */
	command: string
	/** 命令参数 */
	args: string[]
	/** 环境变量 */
	env?: Record<string, string>
	/** 工作目录 */
	cwd?: string
}

export class StdioTransport implements ITransport {
	private process: ChildProcess | null = null
	/** stdout 数据缓冲区，用于按行解析 */
	private buffer = ''

	onMessage: ((msg: JsonRpcMessage) => void) | null = null
	onClose: ((code: number | null) => void) | null = null
	onError: ((error: Error) => void) | null = null

	constructor(private readonly config: StdioConfig) {}

	async start(): Promise<void> {
		// 动态引入 child_process（Electron 环境可用）
		const { spawn } = await import('child_process')

		const env = {
			...process.env,
			...(this.config.env ?? {}),
		}

		this.process = spawn(this.config.command, this.config.args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
			env,
			cwd: this.config.cwd,
			windowsHide: true,
		})

		// stdout: 按行缓冲，解析 JSON-RPC 消息
		this.process.stdout?.on('data', (data: Buffer) => {
			this.buffer += data.toString('utf-8')
			this.processBuffer()
		})

		// stderr: 收集日志信息
		this.process.stderr?.on('data', (data: Buffer) => {
			const text = data.toString('utf-8').trim()
			if (text) {
				DebugLogger.warn(`[MCP:stdio:stderr] ${text}`)
			}
		})

		// 进程退出
		this.process.on('close', (code) => {
			DebugLogger.info(`[MCP:stdio] 进程退出，code=${code}`)
			this.process = null
			this.onClose?.(code)
		})

		// 进程错误（如命令不存在）
		this.process.on('error', (err) => {
			DebugLogger.error(`[MCP:stdio] 进程错误`, err)
			this.onError?.(err)
		})
	}

	send(message: JsonRpcMessage): void {
		if (!this.process?.stdin?.writable) {
			throw new Error('MCP 服务器进程未运行，无法发送消息')
		}

		const data = JSON.stringify(message) + '\n'
		this.process.stdin.write(data, 'utf-8')
	}

	async stop(): Promise<void> {
		if (!this.process) return

		const proc = this.process

		return new Promise<void>((resolve) => {
			const forceKillTimer = setTimeout(() => {
				try {
					proc.kill('SIGKILL')
				} catch {
					// 进程可能已经退出
				}
				resolve()
			}, 5000)

			proc.once('close', () => {
				clearTimeout(forceKillTimer)
				resolve()
			})

			try {
				proc.kill('SIGTERM')
			} catch {
				clearTimeout(forceKillTimer)
				resolve()
			}
		})
	}

	/** 获取子进程 PID */
	get pid(): number | undefined {
		return this.process?.pid
	}

	/** 按行解析缓冲区中的 JSON-RPC 消息 */
	private processBuffer(): void {
		const lines = this.buffer.split('\n')
		// 最后一个元素是不完整的行，保留到缓冲区
		this.buffer = lines.pop() ?? ''

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue

			try {
				const msg = JSON.parse(trimmed) as JsonRpcMessage
				this.onMessage?.(msg)
			} catch {
				DebugLogger.warn(`[MCP:stdio] 无法解析 JSON-RPC 消息: ${trimmed.substring(0, 200)}`)
			}
		}
	}
}
