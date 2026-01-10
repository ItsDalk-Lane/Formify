import type { App, TFile } from 'obsidian';
import { DebugLogger } from 'src/utils/DebugLogger';
import { SystemPromptDataService } from 'src/features/tars/system-prompts/SystemPromptDataService';
import type { AiFeatureId, SystemPromptItem } from 'src/features/tars/system-prompts/types';

export class SystemPromptAssembler {
	constructor(private readonly app: App) {}

	private static readonly SYSTEM_PROMPT_PREFACE = `你是一个高度可配置的智能助手。在当前的会话上下文中，你的行为逻辑、输出格式和处理规则将由下方的一系列**XML配置模块**定义。

## 1. 配置文件解析规则
请按照以下逻辑解析后续输入的XML数据块：
- **模块化结构**：每一个 XML 标签（例如 \`<标签名>...</标签名>\`）代表一个独立的**系统规则模块**。
- **语义识别**：标签的名称（TagName）即为该规则的**“生效领域”**或**“功能主题”**（例如 \`<数学公式格式>\` 意味着该规则仅在涉及数学公式生成时生效）。
- **指令权威性**：标签内部的文本内容是该领域的**最高优先级指令**。当你的默认知识库与标签内的规定冲突时，必须**无条件遵循标签内的规定**。

## 2. 执行与合成策略
在生成回答时，你需要动态“组装”所有适用的规则：
- **并行处理**：如果用户的请求同时涉及多个标签定义的领域（例如既包含数学公式又包含YAML头），你必须**同时满足**所有相关标签的要求。
- **格式严格性**：对于涉及格式约束的标签（如标点符号、换行、特定代码块），必须精确执行，不得修改指定的控制字符。
- **静默应用**：这些XML标签仅供你理解规则使用，**请勿**在最终输出中将这些标签或规则原文展示给用户，仅输出符合规则的结果。

---
**以下是加载的系统规则模块：**`;

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
				parts.push(this.wrapWithXmlTag(prompt.name, content));
			}

			const built = parts.join('\n\n').trim();
			if (!built) {
				return '';
			}
			return `${SystemPromptAssembler.SYSTEM_PROMPT_PREFACE}\n${built}`;
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

	private wrapWithXmlTag(name: string, content: string): string {
		const tag = this.sanitizeTagName(name);
		const body = (content ?? '').trim();
		return `<${tag}>\n${body}\n</${tag}>`;
	}

	private sanitizeTagName(name: string): string {
		const trimmed = (name ?? '').trim();
		const cleaned = trimmed.replace(/[<>/\\]/g, '').replace(/\s+/g, '');
		return cleaned.length > 0 ? cleaned : 'system_prompt';
	}
}
