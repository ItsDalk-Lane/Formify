import { TFile } from "obsidian";
import { useState, useEffect, useRef, useCallback } from "react";
import { FormConfig } from "../model/FormConfig";
import { useObsidianApp } from "../context/obsidianAppContext";

export function useForm(filePath: string, defaultConfig: FormConfig) {
	const [formConfig, setFormConfig] = useState<FormConfig>(defaultConfig);
	const [formFile, setFormFile] = useState<string>(filePath);
	const app = useObsidianApp();
	
	// 用于跟踪是否是内部写入触发的修改事件，避免无限循环
	const isInternalWrite = useRef(false);
	// 用于防抖处理，避免频繁写入
	const writeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	
	const parseConfig = useCallback(async () => {
		const file = app.vault.getAbstractFileByPath(formFile);
		if (!file || !(file instanceof TFile)) {
			return null;
		}
		const data = await app.vault.read(file);
		if (!data) {
			return null;
		}
		try {
			const config = JSON.parse(data);
			return config;
		} catch (e) {
			return null;
		}
	}, [app, formFile]);

	useEffect(() => {
		parseConfig().then((c) => {
			setFormConfig(c || defaultConfig);
		});
	}, [formFile]);

	useEffect(() => {
		const eventRef = app.vault.on("modify", (file) => {
			if (formFile !== file.path) {
				return;
			}
			// 如果是内部写入触发的修改事件，则忽略，避免无限循环
			if (isInternalWrite.current) {
				isInternalWrite.current = false;
				return;
			}
			parseConfig().then((config) => {
				if (config) {
					setFormConfig(config);
				}
			});
		});

		// rename
		const renameRef = app.vault.on("rename", (file, oldPath) => {
			if (formFile !== oldPath) {
				return;
			}
			setFormFile(file.path);
		});

		return () => {
			app.vault.offref(renameRef);
			app.vault.offref(eventRef);
		};
	}, [formFile]);

	// 带防抖和内部写入标记的保存函数
	const saveFormConfig = useCallback(async (config: FormConfig) => {
		// 清除之前的定时器
		if (writeTimeoutRef.current) {
			clearTimeout(writeTimeoutRef.current);
		}
		
		// 设置防抖写入
		writeTimeoutRef.current = setTimeout(async () => {
			isInternalWrite.current = true;
			await app.vault.writeJson(formFile, config);
		}, 100);
	}, [app, formFile]);

	return {
		formConfig,
		formFile,
		setFormConfig,
		saveFormConfig,
		reload: () => parseConfig().then((c) => c && setFormConfig(c)),
	};
}
