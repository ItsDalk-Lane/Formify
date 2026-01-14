import { v4 as uuidv4 } from 'uuid';
import type { ToolExecution } from '../types/tools';
import { ToolRegistryService } from './ToolRegistryService';

export class ToolExecutionManager {
	private executions: ToolExecution[] = [];

	constructor(
		private readonly registry: ToolRegistryService,
		private readonly onChange?: (executions: ToolExecution[]) => void
	) {}

	getPending(): ToolExecution[] {
		return this.executions.filter((e) => e.status === 'pending');
	}

	getAll(): ToolExecution[] {
		return [...this.executions];
	}

	createPending(params: {
		toolId: string;
		toolCallId?: string;
		sessionId: string;
		messageId: string;
		args: Record<string, any>;
	}): ToolExecution {
		const now = Date.now();
		const exec: ToolExecution = {
			id: `tool-exec-${uuidv4()}`,
			toolId: params.toolId,
			toolCallId: params.toolCallId,
			sessionId: params.sessionId,
			messageId: params.messageId,
			arguments: params.args,
			status: 'pending',
			createdAt: now
		};
		this.executions = [...this.executions, exec];
		this.onChange?.(this.getAll());
		return exec;
	}

	async approve(id: string): Promise<ToolExecution> {
		const exec = this.executions.find((e) => e.id === id);
		if (!exec) throw new Error(`未找到待审批执行: ${id}`);
		if (exec.status !== 'pending') return exec;

		exec.status = 'approved';
		exec.approvedAt = Date.now();
		this.onChange?.(this.getAll());

		try {
			exec.status = 'executing';
			this.onChange?.(this.getAll());
			const result = await this.registry.execute(exec.toolId, exec.arguments);
			exec.status = 'completed';
			exec.result = result;
			exec.completedAt = Date.now();
			this.onChange?.(this.getAll());
			return exec;
		} catch (error) {
			exec.status = 'failed';
			exec.error = error instanceof Error ? error.message : String(error);
			exec.completedAt = Date.now();
			this.onChange?.(this.getAll());
			return exec;
		}
	}

	reject(id: string): ToolExecution {
		const exec = this.executions.find((e) => e.id === id);
		if (!exec) throw new Error(`未找到待审批执行: ${id}`);
		if (exec.status !== 'pending') return exec;

		exec.status = 'rejected';
		exec.completedAt = Date.now();
		this.onChange?.(this.getAll());
		return exec;
	}

	clearPending() {
		this.executions = this.executions.filter((e) => e.status !== 'pending');
		this.onChange?.(this.getAll());
	}
}
