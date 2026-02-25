import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { App } from 'obsidian';
import { z } from 'zod';
import {
	BUILTIN_SEQUENTIAL_THINKING_CLIENT_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_VERSION,
} from './constants';

export interface SequentialThinkingBuiltinSettings {
	disableThoughtLogging: boolean;
}

interface ThoughtData {
	thought: string;
	thoughtNumber: number;
	totalThoughts: number;
	isRevision?: boolean;
	revisesThought?: number;
	branchFromThought?: number;
	branchId?: string;
	needsMoreThoughts?: boolean;
	nextThoughtNeeded: boolean;
}

export interface SequentialThinkingBuiltinRuntime {
	serverId: string;
	serverName: string;
	client: Client;
	callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
	listTools: () => Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown>; serverId: string }>>;
	close: () => Promise<void>;
	resetState: () => void;
}

class SequentialThinkingServer {
	private thoughtHistory: ThoughtData[] = [];
	private branches: Record<string, ThoughtData[]> = {};

	constructor(private readonly disableThoughtLogging: boolean) {}

	private formatThought(thoughtData: ThoughtData): string {
		const {
			thoughtNumber,
			totalThoughts,
			thought,
			isRevision,
			revisesThought,
			branchFromThought,
			branchId,
		} = thoughtData;

		if (isRevision) {
			return `[Revision ${thoughtNumber}/${totalThoughts} revising ${revisesThought}] ${thought}`;
		}
		if (branchFromThought) {
			return `[Branch ${thoughtNumber}/${totalThoughts} from ${branchFromThought} id=${branchId ?? ''}] ${thought}`;
		}
		return `[Thought ${thoughtNumber}/${totalThoughts}] ${thought}`;
	}

	processThought(
		input: ThoughtData
	): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
		try {
			if (input.thoughtNumber > input.totalThoughts) {
				input.totalThoughts = input.thoughtNumber;
			}

			this.thoughtHistory.push(input);

			if (input.branchFromThought && input.branchId) {
				if (!this.branches[input.branchId]) {
					this.branches[input.branchId] = [];
				}
				this.branches[input.branchId].push(input);
			}

			if (!this.disableThoughtLogging) {
				console.error(this.formatThought(input));
			}

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								thoughtNumber: input.thoughtNumber,
								totalThoughts: input.totalThoughts,
								nextThoughtNeeded: input.nextThoughtNeeded,
								branches: Object.keys(this.branches),
								thoughtHistoryLength: this.thoughtHistory.length,
								currentThought: input.thought,
								recentThoughts: this.thoughtHistory
									.slice(-5)
									.map((thought) => thought.thought),
							},
							null,
							2
						),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								error:
									error instanceof Error ? error.message : String(error),
								status: 'failed',
							},
							null,
							2
						),
					},
				],
				isError: true,
			};
		}
	}

	reset(): void {
		this.thoughtHistory = [];
		this.branches = {};
	}
}

const sequentialThinkingDescription = `一个用于动态、可反思的问题求解工具，按“思维步骤”逐步推进分析。
该工具支持在推理过程中灵活调整路径：可以修订、分支、回溯，并持续完善结论。

适用场景：
- 将复杂问题拆解成可执行的小步骤
- 需要边分析边修正的规划/设计任务
- 可能中途改变方向的推理任务
- 问题边界尚不清晰、需要逐步澄清
- 需要多轮推理才能收敛的任务
- 需要在多个步骤中保持上下文连续性
- 需要过滤无关信息、聚焦关键线索

核心能力：
- 可动态上调或下调 totalThoughts
- 可对既有思路发起修订
- 即使接近结束，也可继续追加思考步骤
- 可表达不确定性并探索备选路径
- 支持非线性思考（分支与回溯）
- 可形成解题假设并进行验证
- 可基于思维链反复迭代直到满意
- 最终产出明确答案

参数说明：
- thought：当前思考步骤内容，可包含：
  * 常规分析步骤
  * 对既有步骤的修订
  * 对先前决策的质疑
  * 发现分析不足并补充
  * 方法调整
  * 假设生成
  * 假设验证
- nextThoughtNeeded：是否还需要下一步思考
- thoughtNumber：当前步骤编号（可超过初始总步数）
- totalThoughts：预计总步数（可动态调整）
- isRevision：是否为修订步骤
- revisesThought：若为修订，表示修订的是哪一步
- branchFromThought：若为分支，表示从哪一步分出
- branchId：分支标识
- needsMoreThoughts：接近结束但仍需继续思考时可设为 true

使用建议：
1. 先给出初始总步数估计，并准备随过程调整
2. 允许并鼓励对先前步骤进行修订
3. 即使到“终点”也可补充更多思考
4. 在有不确定性时明确表达
5. 对修订或分支步骤做清晰标记
6. 过滤无关信息，保持聚焦
7. 在合适时机形成解题假设
8. 基于思维链验证假设
9. 反复迭代直到结果可靠
10. 输出一个尽可能正确且明确的最终答案
11. 仅在确实完成并满意时，将 nextThoughtNeeded 设为 false`;

const sequentialThinkingInputSchema = z.object({
	thought: z.string().describe('当前思考步骤内容'),
	nextThoughtNeeded: z
		.boolean()
		.describe('是否还需要下一步思考'),
	thoughtNumber: z
		.number()
		.int()
		.min(1)
		.describe('当前思考步骤编号（如 1、2、3）'),
	totalThoughts: z
		.number()
		.int()
		.min(1)
		.describe('预计总思考步数（如 5、10）'),
	isRevision: z
		.boolean()
		.optional()
		.describe('是否为对先前思路的修订'),
	revisesThought: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe('正在修订的步骤编号'),
	branchFromThought: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe('分支起点步骤编号'),
	branchId: z.string().optional().describe('分支标识'),
	needsMoreThoughts: z
		.boolean()
		.optional()
		.describe('是否需要追加更多思考'),
});

const extractTextResult = (result: {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}): string => {
	const text = (result.content ?? [])
		.filter((item) => item.type === 'text' && typeof item.text === 'string')
		.map((item) => item.text as string)
		.join('\n');
	if (result.isError) {
		return `[工具执行错误] ${text}`;
	}
	return text;
};

export async function createSequentialThinkingBuiltinRuntime(
	_app: App,
	settings: SequentialThinkingBuiltinSettings
): Promise<SequentialThinkingBuiltinRuntime> {
	const server = new McpServer({
		name: BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
		version: BUILTIN_SEQUENTIAL_THINKING_SERVER_VERSION,
	});

	const thinkingServer = new SequentialThinkingServer(
		settings.disableThoughtLogging
	);

	server.registerTool(
		'sequentialthinking',
		{
			description: sequentialThinkingDescription,
			inputSchema: sequentialThinkingInputSchema,
		},
		async (args) => {
			const result = thinkingServer.processThought(args as ThoughtData);
			return result;
		}
	);

	const [serverTransport, clientTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: BUILTIN_SEQUENTIAL_THINKING_CLIENT_NAME,
		version: BUILTIN_SEQUENTIAL_THINKING_SERVER_VERSION,
	});
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);

	const close = async (): Promise<void> => {
		thinkingServer.reset();
		await Promise.allSettled([client.close(), server.close()]);
	};

	return {
		serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
		serverName: BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
		client,
		callTool: async (name: string, args: Record<string, unknown>) => {
			const result = await client.callTool({
				name,
				arguments: args,
			});
			return extractTextResult({
				content: result.content,
				isError: result.isError,
			});
		},
		listTools: async () => {
			const result = await client.listTools();
			return result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description ?? '',
				inputSchema: tool.inputSchema,
				serverId: BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
			}));
		},
		close,
		resetState: () => {
			thinkingServer.reset();
		},
	};
}

export async function createSequentialThinkingBuiltinClient(
	app: App,
	settings: SequentialThinkingBuiltinSettings
): Promise<Client> {
	const runtime = await createSequentialThinkingBuiltinRuntime(app, settings);
	return runtime.client;
}
