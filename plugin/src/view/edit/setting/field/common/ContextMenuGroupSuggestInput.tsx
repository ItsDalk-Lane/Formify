import { useEffect, useMemo, useRef, useState } from "react";
import { TFile } from "obsidian";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { getServiceContainer } from "src/service/ServiceContainer";
import ComboboxSuggestion, { Option } from "src/component/combobox/ComboboxSuggestion";

export default function ContextMenuGroupSuggestInput(props: {
	filePath: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
}) {
	const app = useObsidianApp();
	const { value, onChange, placeholder, className, filePath } = props;
	const [options, setOptions] = useState<Option[]>([]);
	const refreshTimeoutRef = useRef<number | null>(null);
	const loadTimeoutRef = useRef<number | null>(null);

	const isCFormFile = (file: TFile): boolean => file.extension === "cform";

	const loadGroupOptions = async () => {
		const files = app.vault.getFiles().filter(isCFormFile);
		const groups = new Set<string>();

		for (const file of files) {
			try {
				const data = await app.vault.read(file);
				const json = JSON.parse(data);
				const group = typeof json?.contextMenuGroup === "string" ? json.contextMenuGroup.trim() : "";
				if (group.length > 0) {
					groups.add(group);
				}
			} catch {
				// 忽略解析失败的文件，避免阻断建议列表
			}
		}

		const sorted = Array.from(groups).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
		setOptions(sorted.map((g) => ({ value: g, label: g })));
	};

	useEffect(() => {
		let mounted = true;

		const run = async () => {
			await loadGroupOptions();
			if (!mounted) return;
		};

		run();

		const scheduleReload = (changed: unknown) => {
			if (!(changed instanceof TFile) || !isCFormFile(changed)) {
				return;
			}
			if (loadTimeoutRef.current) {
				window.clearTimeout(loadTimeoutRef.current);
			}
			loadTimeoutRef.current = window.setTimeout(() => {
				loadGroupOptions();
			}, 300);
		};

		const vault = app.vault;
		const modifyRef = vault.on("modify", scheduleReload);
		const createRef = vault.on("create", scheduleReload);
		const deleteRef = vault.on("delete", scheduleReload);
		const renameRef = vault.on("rename", (file) => scheduleReload(file));

		return () => {
			mounted = false;
			vault.offref(modifyRef);
			vault.offref(createRef);
			vault.offref(deleteRef);
			vault.offref(renameRef);
			if (loadTimeoutRef.current) {
				window.clearTimeout(loadTimeoutRef.current);
				loadTimeoutRef.current = null;
			}
		};
	}, [app, filePath]);

	const optionsWithPlaceholder = useMemo(() => options, [options]);

	return (
		<ComboboxSuggestion
			className={className}
			value={value || ""}
			onChange={(v) => {
				const nextValue = v ?? "";
				onChange(nextValue);

				// 防抖刷新右键菜单，避免每次键入都重建菜单
				if (refreshTimeoutRef.current) {
					window.clearTimeout(refreshTimeoutRef.current);
				}
				refreshTimeoutRef.current = window.setTimeout(() => {
					getServiceContainer().contextMenuService.refreshContextMenuItems();
				}, 300);
			}}
			options={optionsWithPlaceholder}
			placeholder={placeholder}
		/>
	);
}
