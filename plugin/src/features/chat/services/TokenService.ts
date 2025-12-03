/**
 * Token计算服务
 * 支持多种AI模型的Token计算，包括OpenAI/GPT、Claude、Gemini等
 * 
 * Token估算规则基于OpenAI的官方说明和实践经验：
 * - 英文：约4个字符 ≈ 1个token（包括空格和标点）
 * - 中文：约1-2个字符 ≈ 1个token（每个汉字通常是1-2个token）
 * - 代码：变量名、关键字等通常是1个token
 */

import type { ChatMessage } from '../types/chat';

// 尝试导入gpt-tokenizer，如果失败则使用估算方法
let gptEncode: ((text: string) => number[]) | null = null;

try {
	// 动态导入以避免构建时问题
	const tokenizer = require('gpt-tokenizer');
	gptEncode = tokenizer.encode;
} catch (e) {
	console.warn('[TokenService] gpt-tokenizer not available, using estimation');
}

/**
 * Token统计信息
 */
export interface TokenStats {
	inputTokens: number;      // 用户输入的Token数量
	outputTokens: number;     // AI输出的Token数量
	totalTokens: number;      // 总Token数量
}

/**
 * 模型类型枚举，用于选择对应的Token计算方式
 */
export type ModelType = 'gpt' | 'claude' | 'gemini' | 'deepseek' | 'qwen' | 'doubao' | 'other';

/**
 * 从模型ID或供应商名称推断模型类型
 * @param modelId 模型ID或供应商名称
 * @returns 模型类型
 */
export function inferModelType(modelId: string | null): ModelType {
	if (!modelId) return 'gpt';
	
	const lowerModelId = modelId.toLowerCase();
	
	// GPT/OpenAI系列
	if (lowerModelId.includes('gpt') || 
		lowerModelId.includes('openai') || 
		lowerModelId.includes('azure') ||
		lowerModelId.includes('o1') ||
		lowerModelId.includes('o3') ||
		lowerModelId.includes('o4')) {
		return 'gpt';
	}
	
	// Claude系列
	if (lowerModelId.includes('claude') || lowerModelId.includes('anthropic')) {
		return 'claude';
	}
	
	// Gemini系列
	if (lowerModelId.includes('gemini') || lowerModelId.includes('google')) {
		return 'gemini';
	}
	
	// DeepSeek系列
	if (lowerModelId.includes('deepseek')) {
		return 'deepseek';
	}
	
	// 通义千问系列
	if (lowerModelId.includes('qwen') || lowerModelId.includes('tongyi')) {
		return 'qwen';
	}
	
	// 豆包系列
	if (lowerModelId.includes('doubao')) {
		return 'doubao';
	}
	
	// 其他模型默认使用GPT tokenizer
	return 'other';
}

/**
 * 使用GPT tokenizer计算Token数量
 * @param text 要计算的文本
 * @returns Token数量
 */
function countTokensGPT(text: string): number {
	if (!text) return 0;
	
	// 如果gpt-tokenizer可用，使用它
	if (gptEncode) {
		try {
			const tokens = gptEncode(text);
			return tokens.length;
		} catch (error) {
			console.warn('[TokenService] GPT tokenizer failed, falling back to estimation:', error);
		}
	}
	
	// 回退到估算方法
	return estimateTokens(text);
}

/**
 * 估算Token数量
 * 基于OpenAI官方说明和实践经验的更准确估算：
 * - 英文单词：约1个单词 ≈ 1.3个token
 * - 中文字符：约1个汉字 ≈ 1.5个token（Claude/GPT对中文的处理）
 * - 标点符号：通常1个标点 ≈ 1个token
 * - 空格：多个空格可能合并
 * 
 * @param text 要计算的文本
 * @returns 估算的Token数量
 */
function estimateTokens(text: string): number {
	if (!text) return 0;
	
	let totalTokens = 0;
	
	// 提取中文字符（包括中文标点）
	const chinesePattern = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;
	const chineseMatches = text.match(chinesePattern) || [];
	
	// 中文字符：每个汉字约1.5个token（GPT/Claude的tokenizer对中文的处理）
	totalTokens += Math.ceil(chineseMatches.length * 1.5);
	
	// 移除中文字符后的文本
	const nonChineseText = text.replace(chinesePattern, ' ');
	
	// 英文单词和数字：按空格和标点分割
	const words = nonChineseText.split(/[\s]+/).filter(w => w.length > 0);
	
	for (const word of words) {
		if (word.length === 0) continue;
		
		// 纯数字
		if (/^\d+$/.test(word)) {
			// 数字：每3-4位约1个token
			totalTokens += Math.ceil(word.length / 3);
		}
		// 纯标点
		else if (/^[^\w]+$/.test(word)) {
			totalTokens += word.length;
		}
		// 单词（可能包含标点）
		else {
			// 分离单词中的标点
			const pureWord = word.replace(/[^\w]/g, '');
			const punctuation = word.replace(/[\w]/g, '');
			
			// 英文单词：短单词1个token，长单词可能分成多个
			if (pureWord.length <= 4) {
				totalTokens += 1;
			} else {
				// 长单词按4个字符约1个token计算
				totalTokens += Math.ceil(pureWord.length / 4);
			}
			
			// 标点符号
			totalTokens += punctuation.length;
		}
	}
	
	return Math.max(1, totalTokens);
}

/**
 * 根据模型类型计算Token数量
 * @param text 要计算的文本
 * @param modelType 模型类型
 * @returns Token数量
 */
export function countTokens(text: string, modelType: ModelType = 'gpt'): number {
	if (!text) return 0;
	
	// 所有模型都使用相同的计算逻辑
	// GPT tokenizer对大多数模型都有较好的近似
	return countTokensGPT(text);
}

/**
 * 计算消息列表的Token统计
 * @param messages 消息列表
 * @param modelType 模型类型
 * @returns Token统计信息
 */
export function calculateTokenStats(messages: ChatMessage[], modelType: ModelType = 'gpt'): TokenStats {
	let inputTokens = 0;
	let outputTokens = 0;
	
	for (const message of messages) {
		const tokenCount = countTokens(message.content, modelType);
		
		if (message.role === 'user') {
			inputTokens += tokenCount;
		} else if (message.role === 'assistant') {
			outputTokens += tokenCount;
		}
		// system消息不计入统计
	}
	
	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens
	};
}

/**
 * 格式化Token数量显示
 * - 小于1000时显示具体数字（如"456"）
 * - 大于等于1000时以千为单位显示，无小数位（如"2k"）
 * @param count Token数量
 * @returns 格式化后的字符串
 */
export function formatTokenCount(count: number): string {
	if (count < 1000) {
		return count.toString();
	}
	return `${Math.round(count / 1000)}k`;
}

/**
 * 生成Token统计的tooltip文本
 * @param stats Token统计信息
 * @returns tooltip文本
 */
export function generateTokenTooltip(stats: TokenStats): string {
	return `输入: ${stats.inputTokens.toLocaleString()} tokens\n输出: ${stats.outputTokens.toLocaleString()} tokens\n总计: ${stats.totalTokens.toLocaleString()} tokens`;
}
