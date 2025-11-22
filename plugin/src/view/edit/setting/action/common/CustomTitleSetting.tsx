import { localInstance } from "src/i18n/locals";
import { IFormAction } from "src/model/action/IFormAction";
import CpsFormItem from "src/view/shared/CpsFormItem";

export function CustomTitleSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
}) {
	const { value, onChange } = props;

	const validateTitle = (title: string): string => {
		// 移除首尾空格
		const trimmedTitle = title.trim();

		// 长度限制：最多50个字符
		if (trimmedTitle.length > 50) {
			return trimmedTitle.substring(0, 50);
		}

		// 不允许特殊字符（允许中文、英文、数字、空格、常见标点）
		const invalidChars = /[<>{}[\]\\|`~]/g;
		return trimmedTitle.replace(invalidChars, '');
	};

	return (
		<CpsFormItem
			label={localInstance.custom_title}
			description={localInstance.custom_title_description}
		>
			<input
				type="text"
				value={value.customTitle || ""}
				onChange={(e) => {
					const validatedTitle = validateTitle(e.target.value);
					const newValue = {
						...value,
						customTitle: validatedTitle || undefined,
					};
					onChange(newValue);
				}}
				placeholder={localInstance.enter_custom_title}
				maxLength={50}
			/>
		</CpsFormItem>
	);
}