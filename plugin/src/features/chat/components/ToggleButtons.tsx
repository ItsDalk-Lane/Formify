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
			<button type="button" aria-label={localInstance.model_reasoning || '模型推理'}
				onClick={() => service.setReasoningToggle(!state.enableReasoningToggle)}
				className="tw-inline-flex tw-items-center tw-justify-center tw-border tw-border-transparent tw-p-1 tw-cursor-pointer tw-rounded"
				style={{
					backgroundColor: state.enableReasoningToggle ? 'var(--interactive-accent)' : 'transparent',
					color: state.enableReasoningToggle ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)'
				}}
				onMouseEnter={(e) => { if (!state.enableReasoningToggle) e.currentTarget.style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableReasoningToggle) e.currentTarget.style.color = 'var(--text-muted)'; }}>
				<Brain className="tw-size-4" />
			</button>
			<button type="button" aria-label={localInstance.web_search || '联网搜索'}
				onClick={() => service.setWebSearchToggle(!state.enableWebSearchToggle)}
				className="tw-inline-flex tw-items-center tw-justify-center tw-border tw-border-transparent tw-p-1 tw-cursor-pointer tw-rounded"
				style={{
					backgroundColor: state.enableWebSearchToggle ? 'var(--interactive-accent)' : 'transparent',
					color: state.enableWebSearchToggle ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)'
				}}
				onMouseEnter={(e) => { if (!state.enableWebSearchToggle) e.currentTarget.style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableWebSearchToggle) e.currentTarget.style.color = 'var(--text-muted)'; }}>
				<Search className="tw-size-4" />
			</button>
			<button type="button" aria-label={templateSystemPromptLabel} title={templateSystemPromptDescription}
				onClick={() => service.setTemplateAsSystemPromptToggle(!state.enableTemplateAsSystemPrompt)}
				className="tw-inline-flex tw-items-center tw-justify-center tw-border tw-border-transparent tw-p-1 tw-cursor-pointer tw-rounded"
				style={{
					backgroundColor: state.enableTemplateAsSystemPrompt ? 'var(--interactive-accent)' : 'transparent',
					color: state.enableTemplateAsSystemPrompt ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)'
				}}
				onMouseEnter={(e) => { if (!state.enableTemplateAsSystemPrompt) e.currentTarget.style.color = 'var(--interactive-accent)'; }}
				onMouseLeave={(e) => { if (!state.enableTemplateAsSystemPrompt) e.currentTarget.style.color = 'var(--text-muted)'; }}>
				<FileText className="tw-size-4" />
			</button>
		</div>
	);
};
