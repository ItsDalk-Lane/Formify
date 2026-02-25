import { z } from 'zod';

export type BuiltinToolHandler<TArgs> = (
	args: TArgs
) => Promise<unknown> | unknown;

interface BuiltinToolEntry<TArgs> {
	schema: z.ZodType<TArgs>;
	handler: BuiltinToolHandler<TArgs>;
}

export class BuiltinToolRegistry {
	private readonly entries = new Map<string, BuiltinToolEntry<unknown>>();

	register<TArgs>(
		name: string,
		schema: z.ZodType<TArgs>,
		handler: BuiltinToolHandler<TArgs>
	): void {
		this.entries.set(name, {
			schema: schema as z.ZodType<unknown>,
			handler: handler as BuiltinToolHandler<unknown>,
		});
	}

	has(name: string): boolean {
		return this.entries.has(name);
	}

	listToolNames(): string[] {
		return Array.from(this.entries.keys());
	}

	async call(name: string, args: Record<string, unknown>): Promise<unknown> {
		const entry = this.entries.get(name);
		if (!entry) {
			throw new Error(`未找到内置工具: ${name}`);
		}

		const parsedArgs = entry.schema.parse(args);
		return await entry.handler(parsedArgs);
	}

	clear(): void {
		this.entries.clear();
	}
}
