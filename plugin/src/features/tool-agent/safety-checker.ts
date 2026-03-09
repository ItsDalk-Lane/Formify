import type { ToolExecutionStep, SafetyCheckResult, ToolAgentRequest } from './types';

const WRITE_TOOLS = new Set([
	'write_file',
	'delete_file',
	'move_file',
	'create_entities',
	'create_relations',
	'add_observations',
	'delete_entities',
	'delete_observations',
	'delete_relations',
]);

const SHELL_TOOL = 'call_shell';
const SCRIPT_TOOL = 'execute_script';

const DANGEROUS_SHELL_PATTERNS = [
	/\brm\s+-rf\s+\/\b/i,
	/\bmkfs\b/i,
	/\bdd\s+if=/i,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/:\(\)\s*\{/,
];

const normalizePath = (value: unknown): string =>
	typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '';

export class SafetyChecker {
	constructor(private readonly protectedPathPrefixes: string[] = []) {}

	check(
		toolName: string,
		args: Record<string, unknown>,
		constraints: ToolAgentRequest['constraints'],
		trace: ToolExecutionStep[]
	): SafetyCheckResult {
		const maxToolCalls = constraints?.maxToolCalls ?? 10;
		if (trace.length >= maxToolCalls) {
			return {
				allowed: false,
				reason: `Tool call limit reached (${maxToolCalls}).`,
				suggestion: 'Stop calling tools and return the best partial answer.',
			};
		}

		const consecutiveFailures = this.countConsecutiveFailures(toolName, trace);
		if (consecutiveFailures >= 2) {
			return {
				allowed: false,
				reason: `${toolName} has already failed ${consecutiveFailures} times in a row.`,
				suggestion: 'Choose a different tool or ask for clarification instead of repeating the same call.',
			};
		}

		if (constraints?.readOnly && WRITE_TOOLS.has(toolName)) {
			return {
				allowed: false,
				reason: `${toolName} is blocked in read-only mode.`,
				suggestion: 'Return a read-only answer or ask the user for write permission.',
			};
		}

		if (toolName === SHELL_TOOL && constraints?.allowShell === false) {
			return {
				allowed: false,
				reason: 'Shell execution is disabled.',
				suggestion: 'Use non-shell tools or explain that shell access is not allowed.',
			};
		}

		if (toolName === SCRIPT_TOOL && constraints?.allowScript === false) {
			return {
				allowed: false,
				reason: 'Script execution is disabled.',
				suggestion: 'Use direct tools instead of sandboxed scripting.',
			};
		}

		if (toolName === 'write_file') {
			const path = normalizePath(args.path);
			if (!path || this.isProtectedPath(path)) {
				return {
					allowed: false,
					reason: `write_file path is protected or invalid: ${path || '<empty>'}`,
					suggestion: 'Choose a narrower Vault-relative path outside protected system folders.',
				};
			}
		}

		if (toolName === 'delete_file') {
			const path = normalizePath(args.path);
			if (!path || path === '.' || this.isProtectedPath(path)) {
				return {
					allowed: false,
					reason: `delete_file target is protected or too broad: ${path || '<empty>'}`,
					suggestion: 'Delete a specific file or non-protected folder only.',
				};
			}
		}

		if (toolName === SHELL_TOOL) {
			const command = typeof args.command === 'string' ? args.command.trim() : '';
			if (!command) {
				return {
					allowed: false,
					reason: 'Shell command is empty.',
					suggestion: 'Provide a concrete command or use another tool.',
				};
			}
			if (DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(command))) {
				return {
					allowed: false,
					reason: 'Shell command matched a dangerous pattern.',
					suggestion: 'Use a safer, narrower command.',
				};
			}
		}

		return { allowed: true };
	}

	private countConsecutiveFailures(toolName: string, trace: ToolExecutionStep[]): number {
		let count = 0;
		for (let index = trace.length - 1; index >= 0; index -= 1) {
			const step = trace[index];
			if (step.toolName !== toolName) {
				break;
			}
			if (step.status !== 'failed') {
				break;
			}
			count += 1;
		}
		return count;
	}

	private isProtectedPath(path: string): boolean {
		const normalized = path.toLowerCase();
		if (!normalized || normalized === '/' || normalized === '.' || normalized === '..') {
			return true;
		}
		return this.protectedPathPrefixes.some((prefix) => {
			const normalizedPrefix = prefix.trim().replace(/^\/+/, '').toLowerCase();
			return !!normalizedPrefix && (normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`));
		});
	}
}
