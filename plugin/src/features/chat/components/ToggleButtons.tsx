import { Brain, Search, FileText } from 'lucide-react';
import { ChatService } from '../services/ChatService';
import type { ChatState } from '../types/chat';
import { localInstance } from 'src/i18n/locals';

interface ToggleButtonsProps {
	service: ChatService;
	state: ChatState;
}

export const ToggleButtons = ({ service, state }: ToggleButtonsProps) => {
	const templateSystemPromptLabel = localInstance.chat_template_system_prompt_toggle || '模板系统提示词';
	const templateSystemPromptDescription = localInstance.chat_template_system_prompt_toggle_desc || '启用后将提示词模板作为系统提示词使用';

	return (
		<div className="toggle-buttons tw-flex tw-items-center tw-gap-1 tw-flex-wrap">
			<span
				aria-label={localInstance.model_reasoning || '模型推理'}
				title={localInstance.model_reasoning || '模型推理'}
				onClick={() => service.setReasoningToggle(!state.enableReasoningToggle)}
				className="tw-cursor-pointer tw-flex tw-items-center tw-justify-center"
				style={{ color: state.enableReasoningToggle ? 'var(--interactive-accent)' : 'var(--text-muted)' }}
				onMouseEnter={(e) => { if (!state.enableReasoningToggle) (e.currentTarget as HTMLElement).style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableReasoningToggle) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
				<Brain className="tw-size-4" />
			</span>
			<span
				aria-label={localInstance.web_search || '联网搜索'}
				title={localInstance.web_search || '联网搜索'}
				onClick={() => service.setWebSearchToggle(!state.enableWebSearchToggle)}
				className="tw-cursor-pointer tw-flex tw-items-center tw-justify-center"
				style={{ color: state.enableWebSearchToggle ? 'var(--interactive-accent)' : 'var(--text-muted)' }}
				onMouseEnter={(e) => { if (!state.enableWebSearchToggle) (e.currentTarget as HTMLElement).style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableWebSearchToggle) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
				<Search className="tw-size-4" />
			</span>
			<span
				aria-label={templateSystemPromptLabel}
				title={templateSystemPromptDescription}
				onClick={() => service.setTemplateAsSystemPromptToggle(!state.enableTemplateAsSystemPrompt)}
				className="tw-cursor-pointer tw-flex tw-items-center tw-justify-center"
				style={{ color: state.enableTemplateAsSystemPrompt ? 'var(--interactive-accent)' : 'var(--text-muted)' }}
				onMouseEnter={(e) => { if (!state.enableTemplateAsSystemPrompt) (e.currentTarget as HTMLElement).style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableTemplateAsSystemPrompt) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
				<FileText className="tw-size-4" />
			</span>
		</div>
	);
};
