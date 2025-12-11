import { FormConfig } from "src/model/FormConfig";
import { TFile, Vault } from "obsidian";

export interface CommandIdConflict {
	commandId: string;
	files: Array<{
		path: string;
		name: string;
	}>;
}

export interface CommandIdConflictResult {
	conflicts: CommandIdConflict[];
	totalForms: number;
}

export class CommandIdConflictDetector {
	/**
	 * 扫描所有表单文件，检测commandId重复
	 */
	static async detectConflicts(vault: Vault): Promise<CommandIdConflictResult> {
		const formFiles = vault.getFiles().filter((file) => file.extension === "cform");
		const commandIdMap = new Map<string, Array<{ path: string; name: string }>>();
		let totalForms = 0;

		// 遍历所有表单文件
		for (const file of formFiles) {
			try {
				const content = await vault.read(file);
				const parsed = JSON.parse(content);

				// 只处理有commandId的表单
				if (parsed.commandId) {
					totalForms++;
					const conflictInfo = {
						path: file.path,
						name: file.basename
					};

					if (commandIdMap.has(parsed.commandId)) {
						commandIdMap.get(parsed.commandId)!.push(conflictInfo);
					} else {
						commandIdMap.set(parsed.commandId, [conflictInfo]);
					}
				}
			} catch (error) {
				console.warn(`Failed to read or parse form file ${file.path}:`, error);
			}
		}

		// 找出有重复的commandId
		const conflicts: CommandIdConflict[] = [];
		for (const [commandId, files] of commandIdMap.entries()) {
			if (files.length > 1) {
				conflicts.push({
					commandId,
					files
				});
			}
		}

		return {
			conflicts,
			totalForms
		};
	}

	/**
	 * 修复重复的commandId
	 */
	static async fixConflicts(vault: Vault, conflicts: CommandIdConflict[]): Promise<void> {
		for (const conflict of conflicts) {
			// 对于每个冲突，保留第一个文件的commandId，为其他文件生成新的commandId
			for (let i = 1; i < conflict.files.length; i++) {
				const file = conflict.files[i];
				const formFile = vault.getAbstractFileByPath(file.path);

				if (formFile instanceof TFile) {
					try {
						const content = await vault.read(formFile);
						const parsed = JSON.parse(content);
						const config = new FormConfig(parsed.id);

						// 生成新的commandId
						const newCommandId = config.generateCommandId(file.path);

						// 更新commandId
						parsed.commandId = newCommandId;

						// 写回文件
						await vault.modify(formFile, JSON.stringify(parsed, null, 2));

						console.log(`Fixed commandId conflict for ${file.path}: ${conflict.commandId} -> ${newCommandId}`);
					} catch (error) {
						console.error(`Failed to fix commandId conflict for ${file.path}:`, error);
						throw new Error(`修复文件 ${file.path} 的commandId失败: ${error}`);
					}
				}
			}
		}
	}

	/**
	 * 生成新的commandId
	 */
	static generateNewCommandId(filePath: string): string {
		const timestamp = Date.now();
		const pathHash = this.hashString(filePath).substr(0, 6);
		const random = Math.random().toString(36).substr(2, 4);
		return `${timestamp}-${pathHash}-${random}`;
	}

	/**
	 * 简单的字符串哈希函数
	 */
	private static hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // 转换为32位整数
		}
		return Math.abs(hash).toString(36);
	}
}