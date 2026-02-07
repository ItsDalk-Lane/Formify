import { Folder } from "lucide-react";
import { useMemo } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import ComboboxSuggestion from "./ComboboxSuggestion";

export default function FolderSuggestInput(props: {
	placeholder?: string;
	value: string;
	onChange: (value: string) => void;
	limitFolderPath?: string;
}) {
	const app = useObsidianApp();
	const { value, onChange, limitFolderPath } = props;

	const items = useMemo(() => {
		const folders = app.vault.getAllFolders();
		const normalizedLimitPath = (limitFolderPath || "")
			.replace(/\\/g, "/")
			.replace(/\/$/, "");

		const options = folders
			.filter((f) => {
				if (!normalizedLimitPath) {
					return true;
				}

				const normalizedFolderPath = f.path.replace(/\\/g, "/");
				return (
					normalizedFolderPath === normalizedLimitPath ||
					normalizedFolderPath.startsWith(`${normalizedLimitPath}/`)
				);
			})
			.map((f) => {
				return {
					value: f.path,
					label: f.path,
					icon: <Folder size={14} />,
				};
			});
		return options;
	}, [app, limitFolderPath]);

	return (
		<ComboboxSuggestion
			value={value}
			onChange={onChange}
			options={items}
			placeholder={props.placeholder}
		/>
	);
}
