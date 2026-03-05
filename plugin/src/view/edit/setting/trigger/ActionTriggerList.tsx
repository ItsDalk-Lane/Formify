import { ActionTrigger } from "src/model/ActionTrigger";
import { FormConfig } from "src/model/FormConfig";
import { localInstance } from "src/i18n/locals";
import { ActionTriggerItem } from "./ActionTriggerItem";
import "./ActionTrigger.css";

interface ActionTriggerListProps {
	formConfig: FormConfig;
	filePath: string;
	focusTriggerId?: string;
	onChange: (triggers: ActionTrigger[]) => void;
}

/**
 * 动作触发器列表组件
 * 管理表单中所有的独立动作触发器
 */
export function ActionTriggerList(props: ActionTriggerListProps) {
	const { formConfig, filePath, focusTriggerId, onChange } = props;
	const triggers = formConfig.actionTriggers || [];

	/** 添加新触发器 */
	const addTrigger = () => {
		const newTrigger = new ActionTrigger({
			name: `${localInstance.trigger_default_name} ${triggers.length + 1}`,
		});
		onChange([...triggers, newTrigger]);
	};

	/** 更新指定触发器 */
	const updateTrigger = (updated: ActionTrigger) => {
		const newTriggers = triggers.map((t) =>
			t.id === updated.id ? updated : t
		);
		onChange(newTriggers);
	};

	/** 删除指定触发器 */
	const deleteTrigger = (triggerId: string) => {
		onChange(triggers.filter((t) => t.id !== triggerId));
	};

	/** 复制触发器 */
	const duplicateTrigger = (trigger: ActionTrigger) => {
		const copy = new ActionTrigger({
			...trigger,
			name: `${trigger.name} (${localInstance.copy})`,
			commandId: undefined,
			lastExecutionTime: undefined,
		});
		const index = triggers.findIndex((t) => t.id === trigger.id);
		const newTriggers = [
			...triggers.slice(0, index + 1),
			copy,
			...triggers.slice(index + 1),
		];
		onChange(newTriggers);
	};

	return (
		<div className="form--ActionTriggerList">
			{triggers.map((trigger, index) => (
				<ActionTriggerItem
					key={trigger.id}
					trigger={trigger}
					formConfig={formConfig}
					filePath={filePath}
					onChange={updateTrigger}
					onDelete={deleteTrigger}
					onDuplicate={duplicateTrigger}
					defaultOpen={(index === triggers.length - 1 && triggers.length === 1) || trigger.id === focusTriggerId}
					forceOpen={trigger.id === focusTriggerId}
				/>
			))}
			<button
				className="form--AddButton"
				onClick={addTrigger}
			>
				+ {localInstance.trigger_add}
			</button>
		</div>
	);
}
