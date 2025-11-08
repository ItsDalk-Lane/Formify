import { useState, useEffect } from "react";
import { formIntegrationService } from "src/service/command/FormIntegrationService";
import ToggleControl from "src/view/shared/control/ToggleControl";

export function AsCommandToggle(props: { filePath: string }) {
	const { filePath } = props;
	const [isEnabled, setIsEnabled] = useState(true);
	const [isLoading, setIsLoading] = useState(true);

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