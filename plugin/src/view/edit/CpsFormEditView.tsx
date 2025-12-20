import { useEffect, useState, useRef, useCallback } from "react";
import { useObsidianApp } from "src/context/obsidianAppContext";
import { FormConfig } from "src/model/FormConfig";
import "./CpsFormEditView.css";
import CpsFormSetting from "./setting/CpsFormSetting";

export default function CpsFormEditView(props: {
	filePath: string;
	defaultConfig: FormConfig;
}) {
	const app = useObsidianApp();
	const { filePath, defaultConfig } = props;
	const [formConfig, setFormConfig] = useState<FormConfig>(defaultConfig);
	
	// 用于跟踪是否是用户编辑触发的变更，避免与外部同步冲突
	const isUserEdit = useRef(false);
	// 防抖定时器
	const writeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// 当外部配置发生变化（例如：导入表单、外部写入文件触发 reload）时，
	// 在未处于用户编辑中的情况下，同步刷新编辑界面。
	useEffect(() => {
		if (isUserEdit.current) {
			return;
		}
		setFormConfig(defaultConfig);
	}, [defaultConfig, filePath]);

	// 保存配置到文件（带防抖）
	const saveConfig = useCallback((config: FormConfig) => {
		if (writeTimeoutRef.current) {
			clearTimeout(writeTimeoutRef.current);
		}
		writeTimeoutRef.current = setTimeout(async () => {
			try {
				await app.vault.writeJson(filePath, config);
			} finally {
				isUserEdit.current = false;
			}
		}, 150);
	}, [app, filePath]);

	// 处理用户编辑
	const handleChange = useCallback((config: FormConfig) => {
		isUserEdit.current = true;
		setFormConfig(config);
		saveConfig(config);
	}, [saveConfig]);

	// 清理定时器
	useEffect(() => {
		return () => {
			if (writeTimeoutRef.current) {
				clearTimeout(writeTimeoutRef.current);
			}
		};
	}, []);

	return (
		<CpsFormSetting
			filePath={filePath}
			formConfig={formConfig}
			onChange={(config) => {
				handleChange(config as FormConfig);
			}}
		/>
	);
}
