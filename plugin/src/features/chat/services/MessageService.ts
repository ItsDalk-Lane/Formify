import { v4 as uuidv4 } from 'uuid';
import type { Message as ProviderMessage } from 'src/features/tars/providers';
import type { ChatMessage, ChatRole } from '../types/chat';

export class MessageService {
	createMessage(role: ChatRole, content: string, extras?: Partial<ChatMessage>): ChatMessage {
		const now = Date.now();
		return {
			id: extras?.id ?? uuidv4(),
			role,
			content: content.trim(),
			timestamp: extras?.timestamp ?? now,
			images: extras?.images ?? [],
			isError: extras?.isError ?? false,
			metadata: extras?.metadata ?? {}
		};
	}

	formatTimestamp(timestamp: number): string {
		const locale = (window as any)?.moment?.locale?.() ?? 'zh-CN';
		const formatter = new Intl.DateTimeFormat(locale, {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		} as Intl.DateTimeFormatOptions);
		return formatter.format(new Date(timestamp)).replace(/\//g, '/');
	}

	toProviderMessages(messages: ChatMessage[], options?: { contextNotes?: string[]; systemPrompt?: string }): ProviderMessage[] {
		const providerMessages: ProviderMessage[] = [];
		const { contextNotes = [], systemPrompt } = options ?? {};

		if (systemPrompt) {
			providerMessages.push({
				role: 'system',
				content: systemPrompt
			});
		}

		if (contextNotes.length > 0) {
			providerMessages.push({
				role: 'system',
				content: `Relevant context provided by the user:\n${contextNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`
			});
		}

		messages.forEach((message) => {
			let content = message.content;
			if (message.images?.length) {
				const imageSection = message.images
					.map((imagePath, index) => `![Image ${index + 1}](${imagePath})`)
					.join('\n');
				content = `${message.content}\n\n${imageSection}`;
			}
			providerMessages.push({ role: message.role, content });
		});

		return providerMessages;
	}

	serializeMessage(message: ChatMessage): string {
		const timestamp = this.formatTimestamp(message.timestamp);
		const roleLabel = this.mapRoleToLabel(message.role);
		
		// 处理图片引用
		const images = (message.images ?? []).map((image, index) => `![Image ${index + 1}](${image})`).join('\n');
		
		// 确保消息内容完整，不进行任何截断或压缩
		let content = message.content;
		
		// 如果有错误标记，在内容前添加错误标识
		if (message.isError) {
			content = `[错误] ${content}`;
		}
		
		// 构建完整消息，确保内容不被截断
		let fullMessage = `# ${roleLabel} (${timestamp})\n${content}`;
		
		// 如果有图片，添加到消息末尾
		if (images) {
			fullMessage += `\n\n${images}`;
		}
		
		return fullMessage;
	}

	private mapRoleToLabel(role: ChatRole): string {
		switch (role) {
			case 'assistant':
				return 'AI';
			case 'system':
				return '系统';
			default:
				return '用户';
		}
	}
}

