/**
 * MCP 传输层接口和 JSON-RPC 2.0 类型定义
 */

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
	jsonrpc: '2.0'
	id: number
	method: string
	params?: Record<string, unknown>
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: number
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

/** JSON-RPC 2.0 通知（无 id，无响应） */
export interface JsonRpcNotification {
	jsonrpc: '2.0'
	method: string
	params?: Record<string, unknown>
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

/** 判断消息是否为响应 */
export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
	return 'id' in msg && !('method' in msg)
}

/** 判断消息是否为请求 */
export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
	return 'id' in msg && 'method' in msg
}

/** 判断消息是否为通知 */
export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
	return !('id' in msg) && 'method' in msg
}

/** 传输层接口 */
export interface ITransport {
	/** 启动传输层（建立连接/启动进程） */
	start(): Promise<void>
	/** 发送 JSON-RPC 消息 */
	send(message: JsonRpcMessage): void
	/** 停止传输层（关闭连接/终止进程） */
	stop(): Promise<void>
	/** 消息接收回调 */
	onMessage: ((msg: JsonRpcMessage) => void) | null
	/** 连接关闭回调 */
	onClose: ((code: number | null) => void) | null
	/** 错误回调 */
	onError: ((error: Error) => void) | null
}
