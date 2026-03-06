import { Loader2, X } from 'lucide-react';
import { ChatService } from '../services/ChatService';
import { availableVendors } from 'src/features/tars/settings';
import { localInstance } from 'src/i18n/locals';

interface CompareTabBarProps {
	models: string[];
	activeModel: string | null;
	onSelect: (modelTag: string) => void;
	streamingTags: Set<string>;
	errorTags: Set<string>;
	service: ChatService;
}

function getShortName(tag: string): string {
	const parts = tag.split('/');
	return parts[parts.length - 1];
}

function getVendorColor(vendor?: string) {
	if (!vendor) return { bg: 'var(--background-modifier-hover)', text: 'var(--text-normal)' };
	const hash = Array.from(vendor).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) % 360, 0);
	return {
		bg: `hsl(${hash} 62% 46%)`,
		text: '#fff'
	};
}

export const CompareTabBar = ({
	models,
	activeModel,
	onSelect,
	streamingTags,
	errorTags,
	service,
}: CompareTabBarProps) => {
	const handleStopModel = (e: React.MouseEvent, modelTag: string) => {
		e.stopPropagation();
		service.stopModelGeneration(modelTag);
	};

	const getVendorName = (modelTag: string): string | undefined => {
		const provider = service.getProviders().find((p) => p.tag === modelTag);
		return provider ? availableVendors.find((v) => v.name === provider.vendor)?.name : undefined;
	};

	const getModelName = (modelTag: string): string => {
		const provider = service.getProviders().find((p) => p.tag === modelTag);
		return provider?.modelName || getShortName(modelTag);
	};

	if (models.length === 0) {
		return null;
	}

	return (
		<div className="tw-flex tw-items-center tw-gap-2 tw-px-2 tw-py-2 tw-border-b tw-border-border">
			{models.map((modelTag) => {
				const isActive = modelTag === activeModel;
				const isStreaming = streamingTags.has(modelTag);
				const hasError = errorTags.has(modelTag);
				const vendorName = getVendorName(modelTag);
				const colors = getVendorColor(vendorName);
				const displayName = getModelName(modelTag);

				return (
					<button
						key={modelTag}
						onClick={() => onSelect(modelTag)}
						className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-text-sm tw-transition-all tw-relative"
						style={{
							backgroundColor: isActive ? 'var(--interactive-accent)' : 'transparent',
							color: isActive ? 'var(--text-on-accent)' : 'var(--text-muted)',
							borderRadius: 'var(--radius-m)',
							fontWeight: isActive ? 600 : 400,
							border: isActive ? '1px solid var(--interactive-accent)' : '1px solid transparent',
						}}
					>
						{/* 模型标识点 */}
						<span
							className="tw-flex-shrink-0"
							style={{
								width: '8px',
								height: '8px',
								borderRadius: '50%',
								backgroundColor: hasError
									? 'var(--text-error)'
									: colors.bg,
							}}
						/>
						<span className="tw-max-w-[120px] tw-truncate" title={modelTag}>
							{displayName}
						</span>
						{isStreaming && (
							<Loader2 className="tw-size-3 tw-animate-spin tw-flex-shrink-0" />
						)}
						{isStreaming && (
							<button
								onClick={(e) => handleStopModel(e, modelTag)}
								className="tw-text-muted-foreground hover:tw-text-destructive tw-transition-colors tw-flex-shrink-0"
								title={localInstance.stop_this_model || '停止此模型'}
							>
								<X className="tw-size-3" />
							</button>
						)}
					</button>
				);
			})}
		</div>
	);
};
