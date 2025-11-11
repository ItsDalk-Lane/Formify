import { ChevronsUpDown } from "lucide-react";
import { DateTime } from "luxon";
import { DropdownMenu } from "radix-ui";
import "./InternalVariablePopover.css";
import { localInstance } from "src/i18n/locals";

export const internalFieldNames = [
	{
		name: "{{date}}",
		description: DateTime.now().toFormat("yyyy-MM-dd"),
	},
	{
		name: "{{time}}",
		description: DateTime.now().toFormat("HH:mm:ss"),
	},
	{
		name: "{{date:YYYY-MM-DDTHH:mm}}",
		description: DateTime.now().toFormat("yyyy-MM-dd'T'HH:mm"),
	},
	{
		name: "{{date:YYMMDD}}",
		description: DateTime.now().toFormat("yyMMdd"),
	},
	{
		name: "{{date:YYYY-MM-DD|+3}}",
		description: DateTime.now().plus({ days: 3 }).toFormat("yyyy-MM-dd") + " (当前日期+3天)",
		tooltip: "支持相对日期：\n• {{date:格式|+数字}} 未来几天\n• {{date:格式|-数字}} 过去几天\n• {{date:格式|下周一}} 下周一到下周日\n• {{date:格式|next monday}} next monday to next sunday",
	},
	{
		name: "{{time:+1小时}}",
		description: DateTime.now().plus({ hours: 1 }).toFormat("HH:mm:ss") + " (当前时间+1小时)",
		tooltip: "支持时间运算：\n• {{time:+数字小时}} 或 {{time:+数字hour}}\n• {{time:-数字小时}} 或 {{time:-数字hour}}\n• {{time:+数字分钟}} 或 {{time:+数字minute}}\n• {{time:-数字分钟}} 或 {{time:-数字minute}}\n• 支持组合：{{time:+1小时30分钟}}",
	},
	{
		name: "{{random:10}}",
		description: "生成10位随机字符串 (包含数字和字母)",
		tooltip: "生成随机字符串：\n• {{random:长度}} 长度范围 1-100\n• 字符集：0-9, a-z, A-Z\n• 保证包含至少一个数字和一个字母",
	},
	{
		name: "{{selection}}",
		description: localInstance.selection_variable_description,
	},
	{
		name: "{{clipboard}}",
		description: localInstance.clipboard_variable_description,
	},
];

export default function (props: { onSelect: (value: string) => void }) {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button className={"form--FormInternalVariablesButton"}>
					{localInstance.internal_variables}
					<ChevronsUpDown size={16} />
				</button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				className="form--FormInternalVariables"
				align="start"
			>
				{internalFieldNames.map((option) => {
					return (
						<DropdownMenu.Item
							key={option.name}
							className="form--FormInternalVariable"
							title={option.tooltip || undefined}
							onSelect={() => {
								props.onSelect(option.name);
							}}
						>
							<span className="form--FormInternalVariableName">
								{option.name}
							</span>
							<span className="form--FormInternalVariableDescription">
								{option.description}
							</span>
						</DropdownMenu.Item>
					);
				})}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	);
}
