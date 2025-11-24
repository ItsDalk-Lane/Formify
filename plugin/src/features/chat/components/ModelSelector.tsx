import type { ProviderSettings } from 'src/features/tars/providers';

interface ModelSelectorProps {
	providers: ProviderSettings[];
	value: string;
	onChange: (tag: string) => void;
}

export const ModelSelector = ({ providers, value, onChange }: ModelSelectorProps) => {
	if (!providers.length) {
		return <div className="tw-text-sm tw-text-error">尚未配置AI模型</div>;
	}

	return (
		<label className="chat-model-selector tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
			<span className="tw-text-xs tw-text-muted-foreground">Model</span>
			<select className="chat-select" value={value} onChange={(event) => onChange(event.target.value)}>
				{providers.map((provider) => (
					<option key={provider.tag} value={provider.tag}>
						{provider.tag} · {provider.options.model}
					</option>
				))}
			</select>
		</label>
	);
};

