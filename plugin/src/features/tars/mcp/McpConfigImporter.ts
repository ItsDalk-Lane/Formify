/**
 * MCP 配置导入器
 *
 * 支持解析标准的 mcp.json 格式（Claude Desktop 兼容）
 * 将导入的配置合并到现有服务器列表中
 */

import type { McpConfigFile, McpServerConfig } from './types'

/** 生成简短唯一 ID */
function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

/** 导入结果 */
export interface McpImportResult {
	/** 合并后的完整列表 */
	merged: McpServerConfig[]
	/** 新增的服务器名称 */
	added: string[]
	/** 跳过的服务器名称（已存在） */
	skipped: string[]
	/** 解析错误 */
	errors: string[]
}

export class McpConfigImporter {
	/**
	 * 解析 mcp.json 文件内容
	 *
	 * 支持格式:
	 * ```json
	 * {
	 *   "mcpServers": {
	 *     "server-name": {
	 *       "command": "npx",
	 *       "args": ["-y", "@modelcontextprotocol/server-xxx"],
	 *       "env": { "KEY": "value" }
	 *     }
	 *   }
	 * }
	 * ```
	 */
	static parse(jsonContent: string): { servers: McpServerConfig[]; errors: string[] } {
		const servers: McpServerConfig[] = []
		const errors: string[] = []

		let raw: McpConfigFile
		try {
			raw = JSON.parse(jsonContent) as McpConfigFile
		} catch {
			return { servers: [], errors: ['JSON 解析失败，请检查文件格式'] }
		}

		if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
			return { servers: [], errors: ['缺少 mcpServers 字段'] }
		}

		for (const [name, def] of Object.entries(raw.mcpServers)) {
			if (!def || typeof def !== 'object') {
				errors.push(`服务器 "${name}" 配置格式无效`)
				continue
			}

			if (!def.command || typeof def.command !== 'string') {
				errors.push(`服务器 "${name}" 缺少 command 字段`)
				continue
			}

			servers.push({
				id: generateId(),
				name,
				enabled: true,
				transportType: 'stdio',
				command: def.command,
				args: Array.isArray(def.args) ? def.args.map(String) : [],
				env: def.env && typeof def.env === 'object'
					? Object.fromEntries(
						Object.entries(def.env).map(([k, v]) => [k, String(v)])
					)
					: undefined,
				timeout: 30000,
			})
		}

		return { servers, errors }
	}

	/**
	 * 将导入的配置合并到现有列表
	 *
	 * 同名服务器默认跳过（不覆盖）
	 */
	static merge(
		existing: McpServerConfig[],
		imported: McpServerConfig[],
	): McpImportResult {
		const existingNames = new Set(existing.map((s) => s.name))
		const added: string[] = []
		const skipped: string[] = []
		const merged = [...existing]

		for (const server of imported) {
			if (existingNames.has(server.name)) {
				skipped.push(server.name)
			} else {
				merged.push(server)
				added.push(server.name)
			}
		}

		return { merged, added, skipped, errors: [] }
	}

	/**
	 * 一站式导入：解析 + 合并
	 */
	static importFromJson(
		jsonContent: string,
		existingServers: McpServerConfig[],
	): McpImportResult {
		const { servers, errors } = McpConfigImporter.parse(jsonContent)

		if (servers.length === 0) {
			return { merged: existingServers, added: [], skipped: [], errors }
		}

		const result = McpConfigImporter.merge(existingServers, servers)
		result.errors = errors
		return result
	}
}
