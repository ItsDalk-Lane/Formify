/**
 * MCP 健康检测服务
 *
 * 对 MCP 服务器执行连接测试，验证服务器是否正常运行
 * 仅在用户主动触发时执行
 */

import { DebugLogger } from 'src/utils/DebugLogger'
import { McpProcessManager } from './McpProcessManager'
import type { McpHealthResult, McpServerConfig } from './types'

export class McpHealthChecker {
	constructor(private readonly processManager: McpProcessManager) {}

	/**
	 * 对指定服务器列表执行健康检测
	 *
	 * 逐个检测每个服务器，返回所有检测结果
	 */
	async check(servers: McpServerConfig[]): Promise<McpHealthResult[]> {
		const results: McpHealthResult[] = []

		for (const server of servers) {
			const result = await this.checkOne(server)
			results.push(result)
		}

		return results
	}

	/** 对单个服务器执行健康检测 */
	async checkOne(server: McpServerConfig): Promise<McpHealthResult> {
		const startTime = Date.now()

		try {
			// 尝试连接并获取工具列表
			const client = await this.processManager.ensureConnected(server)
			const tools = client.tools

			const result: McpHealthResult = {
				serverId: server.id,
				serverName: server.name,
				success: true,
				toolCount: tools.length,
				responseTimeMs: Date.now() - startTime,
			}

			DebugLogger.info(
				`[MCP] 健康检测通过: ${server.name}`,
				`工具数=${tools.length}`,
				`耗时=${result.responseTimeMs}ms`,
			)

			return result
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err)

			const result: McpHealthResult = {
				serverId: server.id,
				serverName: server.name,
				success: false,
				toolCount: 0,
				responseTimeMs: Date.now() - startTime,
				error: errorMsg,
			}

			DebugLogger.error(`[MCP] 健康检测失败: ${server.name}`, err)
			return result
		}
	}
}
