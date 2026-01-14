import type { ToolDefinition } from '../types/tools';

export type ToolRegistrySource = 'builtin' | 'user';

interface ToolEntry {
	definition: ToolDefinition;
	source: ToolRegistrySource;
}

export class ToolRegistryService {
	private readonly tools = new Map<string, ToolEntry>();

	register(tool: ToolDefinition, source: ToolRegistrySource) {
		const existing = this.tools.get(tool.id);
		if (existing && existing.source === 'builtin' && source === 'user') {
			// 保护内置工具：不允许用户定义覆盖内置工具实现
			return;
		}
		this.tools.set(tool.id, {
			definition: tool,
			source
		});
	}

	upsertUserTool(tool: ToolDefinition) {
		this.register(tool, 'user');
	}

	get(id: string): ToolDefinition | null {
		return this.tools.get(id)?.definition ?? null;
	}

	isBuiltin(id: string): boolean {
		return this.tools.get(id)?.source === 'builtin';
	}

	list(): ToolDefinition[] {
		return Array.from(this.tools.values())
			.map((entry) => entry.definition)
			.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
	}

	listEnabled(): ToolDefinition[] {
		return this.list().filter((tool) => tool.enabled);
	}

	setToolEnabled(id: string, enabled: boolean) {
		const existing = this.tools.get(id);
		if (!existing) return;
		existing.definition = {
			...existing.definition,
			enabled,
			updatedAt: Date.now()
		};
		this.tools.set(id, existing);
	}

	remove(id: string): boolean {
		const existing = this.tools.get(id);
		if (!existing) return false;
		if (existing.source === 'builtin') return false;
		return this.tools.delete(id);
	}

	toOpenAICompatibleTools(onlyEnabled = true): any[] {
		const toolList = onlyEnabled ? this.listEnabled() : this.list();
		return toolList.map((tool) => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters
			}
		}));
	}

	async execute(toolNameOrId: string, args: Record<string, any>): Promise<string> {
		const tool = this.get(toolNameOrId) ?? this.list().find((t) => t.name === toolNameOrId) ?? null;
		if (!tool) {
			throw new Error(`未找到工具: ${toolNameOrId}`);
		}
		if (!tool.enabled) {
			throw new Error(`工具未启用: ${tool.name}`);
		}
		if (tool.handler) {
			const result = await tool.handler(args);
			return typeof result === 'string' ? result : String(result);
		}
		if (tool.serverHandler) {
			return await tool.serverHandler(args);
		}
		throw new Error(`工具未实现执行器: ${tool.name}`);
	}
}
