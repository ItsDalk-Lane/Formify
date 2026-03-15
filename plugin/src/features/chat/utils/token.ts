import { countTokens } from 'gpt-tokenizer';
import type { ChatMessage } from '../types/chat';

/**
 * 计算单条消息的 token 数量
 * 使用 gpt-tokenizer 的 cl100k_base 分词器进行精确计算
 */
export function countMessageTokens(message: ChatMessage): number {
	if (!message.content || message.content.length === 0) {
		return 0;
	}

	try {
		return Number(
			countTokens([
				{
					role: message.role === 'tool' ? 'assistant' : message.role,
					content: message.content,
				},
			] as any)
		);
	} catch {
		// 降级方案：字符数除以4
		return Math.ceil(message.content.length / 4);
	}
}

/**
 * 格式化 token 数量显示
 */
export function formatTokenCount(count: number): string {
	if (count < 1000) {
		return `${count}`;
	}
	return `${(count / 1000).toFixed(1)}k`;
}
