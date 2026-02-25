export type AgentTaskHandler = (
	task: string,
	context: { id: string }
) => Promise<unknown> | unknown;

export class AgentRegistry {
	private readonly agents = new Map<string, AgentTaskHandler>();

	register(id: string, handler: AgentTaskHandler): void {
		const normalizedId = String(id ?? '').trim();
		if (!normalizedId) {
			throw new Error('Agent id 不能为空');
		}
		this.agents.set(normalizedId, handler);
	}

	unregister(id: string): void {
		const normalizedId = String(id ?? '').trim();
		this.agents.delete(normalizedId);
	}

	has(id: string): boolean {
		const normalizedId = String(id ?? '').trim();
		return this.agents.has(normalizedId);
	}

	list(): string[] {
		return Array.from(this.agents.keys());
	}

	async delegate(id: string, task: string): Promise<unknown> {
		const normalizedId = String(id ?? '').trim();
		const normalizedTask = String(task ?? '').trim();

		if (!normalizedId) {
			throw new Error('id 不能为空');
		}
		if (!normalizedTask) {
			throw new Error('task 不能为空');
		}

		const handler = this.agents.get(normalizedId);
		if (!handler) {
			throw new Error(`未注册代理: ${normalizedId}`);
		}

		return await handler(normalizedTask, { id: normalizedId });
	}

	clear(): void {
		this.agents.clear();
	}
}
