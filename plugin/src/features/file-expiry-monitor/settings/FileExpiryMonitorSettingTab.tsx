import { useCallback, useRef, useEffect, useState } from 'react';
import { ToggleSwitch } from 'src/component/toggle-switch/ToggleSwitch';
import { InteractiveList } from 'src/component/interactive-list/InteractiveList';
import { localInstance } from 'src/i18n/locals';
import { getServiceContainer } from 'src/service/ServiceContainer';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import FileSuggest from './FileSuggest';
import type { MonitorConfig, MonitorSettings } from '../model';
import { DEFAULT_DATA_FILE_PATH, MonitorTargetType } from '../model';
import { MonitorConfigEditor } from './MonitorConfigEditor';
import './MonitorConfigEditor.css';

interface FileExpiryMonitorSettingTabProps {
	/** 设置变更后的回调（用于持久化） */
	onSettingsChange?: () => void;
}

/**
 * 文件过期监控功能设置标签页
 * 包含功能开关、数据文件路径、确认开关、监控路径列表
 */
export function FileExpiryMonitorSettingTab(props: FileExpiryMonitorSettingTabProps) {
	const { onSettingsChange } = props;
	const app = useObsidianApp();
	const container = getServiceContainer();
	const dataService = container.monitorDataService;

	// 数据文件路径输入框引用，绑定 FileSuggest
	const dataFilePathRef = useRef<HTMLInputElement>(null);

	// 功能设置状态
	const [settings, setSettings] = useState<MonitorSettings>(() => ({
		...dataService.getSettings(),
	}));

	// 监控配置列表
	const [monitors, setMonitors] = useState<MonitorConfig[]>(() => [
		...dataService.getMonitors(),
	]);

	// 编辑中的配置项（null 表示新增，MonitorConfig 表示编辑）
	const [editingConfig, setEditingConfig] = useState<MonitorConfig | null | undefined>(
		undefined
	);

	// 绑定 FileSuggest 到数据文件路径输入框
	useEffect(() => {
		if (!dataFilePathRef.current || !app) return;
		const suggest = new FileSuggest(app, dataFilePathRef.current);
		suggest.onSelect((file) => {
			const next = { ...settings, dataFilePath: file.path };
			setSettings(next);
			if (dataFilePathRef.current) {
				dataFilePathRef.current.value = file.path;
			}
			suggest.close();
		});
		return () => {
			suggest.close();
		};
	}, [app]);

	/**
	 * 同步设置到数据服务并通知外部
	 */
	const applySettings = useCallback((next: MonitorSettings) => {
		dataService.updateSettings(next);
		void dataService.saveData();
		onSettingsChange?.();
	}, [dataService, onSettingsChange]);

	/**
	 * 同步监控列表到数据服务并通知外部
	 */
	const applyMonitors = useCallback(() => {
		void dataService.saveData();
		onSettingsChange?.();
	}, [dataService, onSettingsChange]);

	// 设置变更处理
	const handleToggleEnabled = useCallback((checked: boolean) => {
		const next = { ...settings, enabled: checked };
		setSettings(next);
		applySettings(next);
	}, [settings, applySettings]);

	const handleToggleConfirmDelete = useCallback((checked: boolean) => {
		const next = { ...settings, confirmBeforeDelete: checked };
		setSettings(next);
		applySettings(next);
	}, [settings, applySettings]);

	const handleDataFilePathChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const next = { ...settings, dataFilePath: e.target.value };
		setSettings(next);
	}, [settings]);

	/**
	 * 数据文件路径失焦时写入
	 */
	const handleDataFilePathBlur = useCallback(() => {
		applySettings(settings);
	}, [settings, applySettings]);

	// 监控列表操作
	const handleMonitorsReorder = useCallback((items: MonitorConfig[]) => {
		setMonitors(items);
		// 通过替换方式同步到数据服务
		const currentIds = new Set(dataService.getMonitors().map(m => m.id));
		const newIds = new Set(items.map(m => m.id));
		// 移除不在新列表中的
		for (const id of currentIds) {
			if (!newIds.has(id)) {
				dataService.removeMonitor(id);
			}
		}
		// 更新所有现有项
		for (const item of items) {
			if (currentIds.has(item.id)) {
				dataService.updateMonitor(item.id, item);
			} else {
				dataService.addMonitor(item);
			}
		}
		applyMonitors();
	}, [dataService, applyMonitors]);

	const handleAddMonitor = useCallback(() => {
		// 打开编辑面板（null 表示新增）
		setEditingConfig(null);
	}, []);

	const handleSaveConfig = useCallback((config: MonitorConfig) => {
		const existing = monitors.find(m => m.id === config.id);
		if (existing) {
			// 更新
			const updated = monitors.map(m => m.id === config.id ? config : m);
			setMonitors(updated);
			dataService.updateMonitor(config.id, config);
		} else {
			// 新增
			const updated = [...monitors, config];
			setMonitors(updated);
			dataService.addMonitor(config);
		}
		setEditingConfig(undefined);
		applyMonitors();
	}, [monitors, dataService, applyMonitors]);

	const handleCancelEdit = useCallback(() => {
		setEditingConfig(undefined);
	}, []);

	return (
		<div className="fem-setting-section">
			{/* 功能开关 */}
			<div className="fem-setting-section__row">
				<div className="fem-setting-section__row-label">
					<span className="fem-setting-section__row-label-name">
						{localInstance.monitor_enabled}
					</span>
				</div>
				<ToggleSwitch checked={settings.enabled} onChange={handleToggleEnabled} />
			</div>

			{/* 数据文件路径 */}
			<div className="fem-setting-section__row">
				<div className="fem-setting-section__row-label">
					<span className="fem-setting-section__row-label-name">
						{localInstance.data_file_path}
					</span>
					<span className="fem-setting-section__row-label-desc">
						{DEFAULT_DATA_FILE_PATH}
					</span>
				</div>
				<input
					ref={dataFilePathRef}
					type="text"
					className="fem-setting-section__input"
					value={settings.dataFilePath}
					onChange={handleDataFilePathChange}
					onBlur={handleDataFilePathBlur}
					placeholder={DEFAULT_DATA_FILE_PATH}
				/>
			</div>

			{/* 删除确认开关 */}
			<div className="fem-setting-section__row">
				<div className="fem-setting-section__row-label">
					<span className="fem-setting-section__row-label-name">
						{localInstance.confirm_before_delete}
					</span>
				</div>
				<ToggleSwitch
					checked={settings.confirmBeforeDelete}
					onChange={handleToggleConfirmDelete}
				/>
			</div>

			{/* 监控路径列表 */}
			<InteractiveList<MonitorConfig>
				title={localInstance.add_monitor_path}
				items={monitors}
				onChange={handleMonitorsReorder}
				onAdd={handleAddMonitor}
				addButtonLabel={`+ ${localInstance.add_monitor_path}`}
			>
				{(item, _index, removeItem) => (
					<div className="fem-monitor-item">
						<div className="fem-monitor-item__info">
							<div className="fem-monitor-item__path">{item.path}</div>
							<div className="fem-monitor-item__meta">
								{item.targetType === MonitorTargetType.FOLDER
									? localInstance.monitor_type_folder
									: localInstance.monitor_type_file}
								{' · '}
								{item.expiryHours !== undefined ? `${item.expiryHours} 小时` : `${item.expiryDays} ${localInstance.expiry_days}`}
								{item.recursive ? ` · ${localInstance.recursive}` : ''}
							</div>
						</div>
						<button
							className="fem-monitor-item__edit-btn"
							onClick={() => setEditingConfig(item)}
						>
							{localInstance.edit}
						</button>
						<button
							className="fem-monitor-item__edit-btn"
							onClick={() => removeItem(item)}
						>
							✕
						</button>
					</div>
				)}
			</InteractiveList>

			{/* 编辑面板 */}
			{editingConfig !== undefined && (
				<MonitorConfigEditor
					config={editingConfig}
					onSave={handleSaveConfig}
					onCancel={handleCancelEdit}
				/>
			)}
		</div>
	);
}
