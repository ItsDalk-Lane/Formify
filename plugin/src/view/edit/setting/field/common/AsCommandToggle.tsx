import { useState, useEffect } from "react";
import { App, TFile } from "obsidian";
import { getServiceContainer } from "src/service/ServiceContainer";
import ToggleControl from "src/view/shared/control/ToggleControl";
import { useObsidianApp } from "src/context/obsidianAppContext";

export function AsCommandToggle(props: { filePath: string }) {
	const { filePath } = props;
	const [isEnabled, setIsEnabled] = useState(true);
	const [isLoading, setIsLoading] = useState(true);
	const formIntegrationService = getServiceContainer().formIntegrationService;

	// 获取当前命令状态
	useEffect(() => {
		let mounted = true;

		const loadCommandStatus = async () => {
			try {
				const enabled = await formIntegrationService.isCommandEnabled(filePath);
				if (mounted) {
					setIsEnabled(enabled);
					setIsLoading(false);
				}
			} catch (error) {
				console.error(`Failed to load command status for ${filePath}:`, error);
				if (mounted) {
					setIsEnabled(true); // 出错时默认启用
					setIsLoading(false);
				}
			}
		};

		loadCommandStatus();

		return () => {
			mounted = false;
		};
	}, [filePath]);

	// 处理开关变化
	const onChange = async (newValue: boolean) => {
		try {
			setIsLoading(true);
			if (newValue) {
				// 启用命令
				await formIntegrationService.enableCommand(filePath);
			} else {
				// 禁用命令
				await formIntegrationService.disableCommand(filePath);
			}
			setIsEnabled(newValue);
		} catch (error) {
			console.error(`Failed to toggle command for ${filePath}:`, error);
			// 出错时恢复原状态
			setIsEnabled(!newValue);
		} finally {
			setIsLoading(false);
		}
	};

	if (isLoading) {
		return <div>Loading...</div>; // 或者显示一个加载指示器
	}

	return <ToggleControl value={isEnabled} onValueChange={onChange} />;
}

export function ContextMenuToggle(props: { filePath: string }) {
	const { filePath } = props;
	const app = useObsidianApp();
	const [isEnabled, setIsEnabled] = useState(false); // 使用false作为初始值，避免null状态
	const [isLoading, setIsLoading] = useState(true);

	// 获取当前右键菜单状态
	useEffect(() => {
		let mounted = true;

		const loadContextMenuStatus = async () => {
			try {
				// 这里需要从FormConfig中读取contextMenuEnabled状态
				const file = app.vault.getAbstractFileByPath(filePath);
				if (!file || !(file instanceof TFile)) {
					if (mounted) {
						setIsEnabled(false);
						setIsLoading(false);
					}
					return;
				}

				const configData = await app.vault.read(file);
				const config = JSON.parse(configData);
				const enabled = config.contextMenuEnabled === true;
				
				if (mounted) {
					setIsEnabled(enabled);
					setIsLoading(false);
				}
			} catch (error) {
				console.error(`Failed to load context menu status for ${filePath}:`, error);
				if (mounted) {
					setIsEnabled(false); // 出错时默认禁用
					setIsLoading(false);
				}
			}
		};

		loadContextMenuStatus();

		return () => {
			mounted = false;
		};
	}, [filePath, app]);

	// 处理开关变化
	const onChange = async (newValue: boolean) => {
		try {
			setIsLoading(true);
			
			// 读取当前配置
			const file = app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) {
				throw new Error(`Form file not found: ${filePath}`);
			}

			const configData = await app.vault.read(file);
			const config = JSON.parse(configData);
			
			// 更新contextMenuEnabled状态
			config.contextMenuEnabled = newValue;
			
			// 保存配置
			await app.vault.modify(file, JSON.stringify(config, null, 2));
			
			setIsEnabled(newValue);
		} catch (error) {
			console.error(`Failed to toggle context menu for ${filePath}:`, error);
			// 出错时恢复原状态
			setIsEnabled(!newValue);
		} finally {
			setIsLoading(false);
		}
	};

	// 使用透明度来避免布局抖动
	const style = {
		opacity: isLoading ? 0.5 : 1,
		transition: 'opacity 0.2s ease-in-out',
		pointerEvents: isLoading ? 'none' : 'auto' as const
	};

	return (
		<div style={style}>
			<ToggleControl value={isEnabled} onValueChange={onChange} />
		</div>
	);
}