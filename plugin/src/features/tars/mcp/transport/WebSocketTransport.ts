/**
 * 基于 WebSocket 的传输层
 *
 * 通过 WebSocket 连接进行 JSON-RPC 2.0 通信
 * 适用于远程 MCP 服务器
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import type { ITransport, JsonRpcMessage } from './ITransport'

export interface WebSocketConfig {
	/** WebSocket 服务器 URL */
	url: string
}

export class WebSocketTransport implements ITransport {
	private ws: WebSocket | null = null

	onMessage: ((msg: JsonRpcMessage) => void) | null = null
	onClose: ((code: number | null) => void) | null = null
	onError: ((error: Error) => void) | null = null

	constructor(private readonly config: WebSocketConfig) {}

	async start(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.config.url)
			} catch (err) {
				reject(new Error(`WebSocket 连接创建失败: ${err instanceof Error ? err.message : String(err)}`))
				return
			}

			const connectTimeout = setTimeout(() => {
				reject(new Error(`WebSocket 连接超时: ${this.config.url}`))
				this.ws?.close()
			}, 10000)

			this.ws.onopen = () => {
				clearTimeout(connectTimeout)
				DebugLogger.info(`[MCP:ws] 已连接到 ${this.config.url}`)
				resolve()
			}

			this.ws.onmessage = (event) => {
				const data = typeof event.data === 'string' ? event.data : ''
				if (!data) return

				try {
					const msg = JSON.parse(data) as JsonRpcMessage
					this.onMessage?.(msg)
				} catch {
					DebugLogger.warn(`[MCP:ws] 无法解析 JSON-RPC 消息: ${data.substring(0, 200)}`)
				}
			}

			this.ws.onclose = (event) => {
				clearTimeout(connectTimeout)
				DebugLogger.info(`[MCP:ws] 连接关闭，code=${event.code}`)
				this.ws = null
				this.onClose?.(event.code)
			}

			this.ws.onerror = (event) => {
				clearTimeout(connectTimeout)
				const error = new Error(`WebSocket 连接错误: ${this.config.url}`)
				DebugLogger.error(`[MCP:ws] 连接错误`, event)
				this.onError?.(error)
				// 首次连接时 onerror 在 onclose 之前触发
				if (this.ws?.readyState !== WebSocket.OPEN) {
					reject(error)
				}
			}
		})
	}

	send(message: JsonRpcMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket 未连接，无法发送消息')
		}

		const data = JSON.stringify(message)
		this.ws.send(data)
	}

	async stop(): Promise<void> {
		if (!this.ws) return

		return new Promise<void>((resolve) => {
			if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
				resolve()
				return
			}

			const closeTimeout = setTimeout(() => {
				resolve()
			}, 3000)

			this.ws.onclose = () => {
				clearTimeout(closeTimeout)
				this.ws = null
				resolve()
			}

			this.ws.close(1000, 'Client closing')
		})
	}
}
