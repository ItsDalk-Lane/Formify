import type { App, TFile } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptDataService } from 'src/features/tars/system-prompts/SystemPromptDataService';
import type { AiFeatureId, SystemPromptItem } from 'src/features/tars/system-prompts/types';

export class SystemPromptAssembler {
	constructor(private readonly app: App) {}


	async buildGlobalSystemPrompt(featureId: AiFeatureId): Promise<string> {
		try {
			const plugin = (this.app as any).plugins?.plugins?.['formify'];
			const enabled = plugin?.settings?.tars?.settings?.enableGlobalSystemPrompts === true;
			if (!enabled) {
				return '';
			}

			const service = SystemPromptDataService.getInstance(this.app);
			const prompts = await service.getSortedPrompts();
			const parts: string[] = [];

			for (const prompt of prompts) {
				const content = await this.resolvePromptContent(prompt);
				if (!this.shouldIncludePrompt(prompt, featureId, content)) {
					continue;
				}
				parts.push(content);
			}

			return parts.join('\n\n');
		} catch (error) {
			DebugLogger.error('[SystemPromptAssembler] 构建全局系统提示词失败，回退为空', error);
			return '';
		}
	}

	async buildMergedSystemPrompt(params: {
		featureId: AiFeatureId;
		additionalSystemPrompt?: string;
	}): Promise<string> {
		const globalPrompt = await this.buildGlobalSystemPrompt(params.featureId);
		const additional = (params.additionalSystemPrompt ?? '').trim();
		if (globalPrompt && additional) {
			return `${globalPrompt}\n\n${additional}`;
		}
		return globalPrompt || additional || '';
	}

	private shouldIncludePrompt(prompt: SystemPromptItem, featureId: AiFeatureId, resolvedContent: string): boolean {
		if (!prompt.enabled) {
			return false;
		}
		if (Array.isArray(prompt.excludeFeatures) && prompt.excludeFeatures.includes(featureId)) {
			return false;
		}
		if (!resolvedContent || resolvedContent.trim().length === 0) {
			return false;
		}
		return true;
	}

	private async resolvePromptContent(prompt: SystemPromptItem): Promise<string> {
		if (prompt.sourceType === 'template') {
			const path = (prompt.templatePath ?? '').trim();
			if (!path) {
				return '';
			}
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!file) {
					DebugLogger.warn('[SystemPromptAssembler] 模板文件不存在', { path });
					return '';
				}
				return (await this.app.vault.read(file as TFile)).trim();
			} catch (error) {
				DebugLogger.error('[SystemPromptAssembler] 读取模板文件失败', { path, error });
				return '';
			}
		}

		return (prompt.content ?? '').trim();
	}
}
