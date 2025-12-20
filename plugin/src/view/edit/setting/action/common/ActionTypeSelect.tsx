import {
    Bot,
    Code,
    CornerDownRight,
    File,
    FileJson,
    Hourglass,
    MessageSquare,
    Mouse,
    RefreshCcw,
    SquarePen,
    SquareSlash,
    Text,
    ZapIcon,
} from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { FormActionType } from "src/model/enums/FormActionType";
import { FormTypeSelect } from "src/view/shared/select/FormTypeSelect";

export default function ActionTypeSelect(props: {
	value: string;
	onChange: (value: FormActionType) => void;
	styles?: Record<string, string>;
}) {
	const { value } = props;
	const options = formActionTypeOptions.map((option) => ({
		...option,
		id: option.value,
	}));
	return (
		<FormTypeSelect
			value={value}
			onChange={props.onChange}
			options={options}
			styles={props.styles}
		/>
	);
}

// 所有动作类型选项（包含循环控制动作）
const allFormActionTypeOptions = [
	{
		value: FormActionType.CREATE_FILE,
		label: localInstance.create_file,
		icon: <File />,
	},
	{
		value: FormActionType.INSERT_TEXT,
		label: localInstance.insert_text,
		icon: <Text />,
	},
	{
		value: FormActionType.TEXT,
		label: localInstance.form_text,
		icon: <SquarePen />,
	},
	{
		value: FormActionType.UPDATE_FRONTMATTER,
		label: localInstance.update_property,
		icon: <FileJson />,
	},
	{
		value: FormActionType.AI,
		label: localInstance.ai_action,
		icon: <Bot />,
	},
	// {
	// 	value: FormActionType.GENERATE_FORM,
	// 	label: localInstance.generate_form,
	// 	icon: <Clipboard />,
	// },
	{
		value: FormActionType.SUGGEST_MODAL,
		label: localInstance.suggest_modal,
		icon: <MessageSquare />,
	},
	{
		value: FormActionType.RUN_COMMAND,
		label: localInstance.run_command,
		icon: <ZapIcon />,
	},
	{
		value: FormActionType.RUN_SCRIPT,
		label: localInstance.run_script,
		icon: <Code />,
	},
	{
		value: FormActionType.WAIT,
		label: localInstance.wait,
		icon: <Hourglass />,
	},
	{
		value: FormActionType.LOOP,
		label: localInstance.loop,
		icon: <RefreshCcw />,
	},
	{
		value: FormActionType.BREAK,
		label: localInstance.break_loop,
		icon: <SquareSlash />,
	},
	{
		value: FormActionType.CONTINUE,
		label: localInstance.continue_loop,
		icon: <CornerDownRight />,
	},
	{
		value: FormActionType.BUTTON,
		label: localInstance.button,
		icon: <Mouse />,
	},
];

/**
 * 获取动作类型选项，支持基于上下文过滤
 * @param isInsideLoop 是否在循环内部，为true时显示所有动作，为false时过滤掉循环控制动作
 * @returns 过滤后的动作类型选项
 */
export const getFormActionTypeOptions = (isInsideLoop: boolean = false) => {
	if (isInsideLoop) {
		// 循环内部：显示所有动作，包括循环控制动作
		return allFormActionTypeOptions;
	} else {
		// 循环外部：过滤掉循环控制动作
		return allFormActionTypeOptions.filter(
			(option) =>
				option.value !== FormActionType.BREAK &&
				option.value !== FormActionType.CONTINUE
		);
	}
};

// 保持向后兼容的导出
export const formActionTypeOptions = getFormActionTypeOptions();
