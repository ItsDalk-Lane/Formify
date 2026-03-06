import { Loader2 } from 'lucide-react';

interface ModelTagProps {
	modelTag: string;
	modelName?: string;
	vendor?: string;
	isGenerating?: boolean;
	isError?: boolean;
	size?: 'sm' | 'md';
	onClick?: () => void;
	onRemove?: () => void;
}

const DEFAULT_COLOR = { bg: 'var(--background-modifier-hover)', text: 'var(--text-normal)' };

function getVendorColor(vendor?: string) {
	if (!vendor) return DEFAULT_COLOR;
	const hash = Array.from(vendor).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) % 360, 0);
	return {
		bg: `hsl(${hash} 62% 46%)`,
		text: '#fff'
	};
}

function getShortName(tag: string): string {
	const parts = tag.split('/');
	return parts[parts.length - 1];
}

export const ModelTag = ({
	modelTag,
	modelName,
	vendor,
	isGenerating,
	isError,
	size = 'sm',
	onClick,
}: ModelTagProps) => {
	const colors = getVendorColor(vendor);
	const displayName = modelName || getShortName(modelTag);
	const isMd = size === 'md';

	return (
		<span
			className={`model-tag ${isError ? 'model-tag--error' : ''} ${isGenerating ? 'model-tag--generating' : ''}`}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: '4px',
				padding: isMd ? '3px 8px' : '1px 6px',
				borderRadius: '999px',
				fontSize: isMd ? 'var(--font-ui-small)' : 'var(--font-ui-smaller)',
				fontWeight: 500,
				lineHeight: 1.4,
				backgroundColor: isError ? 'var(--background-modifier-error, #fecaca)' : colors.bg,
				color: isError ? 'var(--text-error, #dc2626)' : colors.text,
				cursor: onClick ? 'pointer' : 'default',
				whiteSpace: 'nowrap',
				maxWidth: '200px',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
			}}
			title={modelTag}
			onClick={onClick}
		>
			{isGenerating && (
				<Loader2
					className="tw-animate-spin"
					style={{ width: isMd ? 14 : 12, height: isMd ? 14 : 12, flexShrink: 0 }}
				/>
			)}
			<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
		</span>
	);
};
