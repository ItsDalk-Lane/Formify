import { useMemo } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import ComboboxSuggestion from "./ComboboxSuggestion";

export default function (props: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	immediate?: boolean;
}) {
	const app = useObsidianApp();
	const { value, onChange } = props;
	
	const items = useMemo(() => {
		// 获取插件设置中的提示词模板目录
		const plugin = (app as any).plugins?.plugins?.["formify"];
		const promptTemplateFolder = plugin?.settings?.promptTemplateFolder || "form/prompt-templates";
		
		// 添加"请选择"选项
		const selectOnSubmitOption = {
			value: "",
			label: localInstance.ai_select_on_submit,
			description: localInstance.ai_select_template_prompt,
		};
		
		// 获取所有Markdown文件
		const files = app.vault.getMarkdownFiles();
		
		// 过滤出提示词模板目录下的文件
		const filteredFiles = files.filter((f) => 
			f.path.startsWith(promptTemplateFolder + "/") || 
			f.path === promptTemplateFolder
		);
		
		const fileOptions = filteredFiles.map((f) => {
			return {
				value: f.path,
				label: f.path,
				description: f.path,
			};
		});
		
		// 将"请选择"选项放在最前面
		return [selectOnSubmitOption, ...fileOptions];
	}, [app]);

	return (
		<ComboboxSuggestion
			value={value}
			placeholder={props.placeholder || ""}
			onChange={onChange}
			options={items}
		/>
	);
}
