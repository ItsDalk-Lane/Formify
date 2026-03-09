import type { McpToolDefinition } from 'src/features/tars/mcp/types';
import { memoryToolDefinitions } from './memory-tools';
import { searchToolDefinitions } from './search-tools';
import { thinkingToolDefinitions } from './thinking-tools';
import { toolSearchToolDefinitions } from './tool-search-tools';
import type { ToolDefinition } from './types';
import { vaultToolDefinitions } from './vault-tools';

const allDefinitions = [
	...vaultToolDefinitions,
	...searchToolDefinitions,
	...memoryToolDefinitions,
	...thinkingToolDefinitions,
	...toolSearchToolDefinitions,
];

export class ToolRegistry {
	private readonly all = allDefinitions;
	private readonly byName = new Map(
		this.all.map((tool) => [tool.name.toLowerCase(), tool] as const)
	);

	getAllTools(): ToolDefinition[] {
		return [...this.all];
	}

	getBuiltinExecutionTools(): ToolDefinition[] {
		return this.all.filter((tool) => tool.serverId !== '__builtin__:tool-search');
	}

	getToolByName(name: string): ToolDefinition | null {
		return this.byName.get(name.trim().toLowerCase()) ?? null;
	}

	getToolsByServer(serverId: string): ToolDefinition[] {
		return this.all.filter((tool) => tool.serverId === serverId);
	}

	toProviderToolDefinition(tool: ToolDefinition, description: string): McpToolDefinition {
		return {
			name: tool.name,
			description,
			inputSchema: tool.inputSchema,
			serverId: tool.serverId,
		};
	}
}

export const toolRegistry = new ToolRegistry();

export {
	allDefinitions as allToolDefinitions,
	memoryToolDefinitions,
	searchToolDefinitions,
	thinkingToolDefinitions,
	toolSearchToolDefinitions,
	type ToolDefinition,
	vaultToolDefinitions,
};
