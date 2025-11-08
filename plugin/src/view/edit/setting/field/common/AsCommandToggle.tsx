import { formIntegrationService } from "src/service/command/FormIntegrationService";
import ToggleControl from "src/view/shared/control/ToggleControl";

export function AsCommandToggle(props: { filePath: string }) {
	const { filePath } = props;

	// 获取当前命令状态
	const value = formIntegrationService.isCommandEnabled(filePath);

	// 处理开关变化
	const onChange = async (newValue: boolean) => {
		try {
			if (newValue) {
				// 启用命令
				await formIntegrationService.enableCommand(filePath);
			} else {
				// 禁用命令
				await formIntegrationService.disableCommand(filePath);
			}
		} catch (error) {
			console.error(`Failed to toggle command for ${filePath}:`, error);
		}
	};

	return <ToggleControl value={value} onValueChange={onChange} />;
}