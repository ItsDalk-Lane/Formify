import useFormConfig from "src/hooks/useFormConfig";
import { localInstance } from "src/i18n/locals";
import CpsFormItem from "src/view/shared/CpsFormItem";

export default function LoopAwareInputSetting(props: {
	actionId: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
	label?: string;
	required?: boolean;
	description?: string;
	disabled?: boolean;
	maxLength?: number;
}) {
	const { actionId, value, onChange, placeholder, label, required, description, disabled, maxLength } = props;

	// 即使在循环内，也使用普通输入框样式，只是通过 context 提供变量信息给变量面板
	return (
		<CpsFormItem
			label={label}
			description={description}
			required={required}
		>
			<input
				type="text"
				className="form--input"
				value={value || ""}
				onChange={(e) => {
					let newValue = e.target.value;
					// Apply maxLength if specified
					if (maxLength && newValue.length > maxLength) {
						newValue = newValue.substring(0, maxLength);
					}
					onChange(newValue);
				}}
				placeholder={placeholder}
				disabled={disabled}
				maxLength={maxLength}
			/>
		</CpsFormItem>
	);
}