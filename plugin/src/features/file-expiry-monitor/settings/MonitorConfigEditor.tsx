import { useState, useRef, useEffect } from 'react';
import { v4 } from 'uuid';
import { ToggleSwitch } from 'src/component/toggle-switch/ToggleSwitch';
import { localInstance } from 'src/i18n/locals';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import MonitorFolderSuggest from './MonitorFolderSuggest';
import FileSuggest from './FileSuggest';
import type { MonitorConfig } from '../model';
import { MonitorTargetType, DEFAULT_MONITOR_CONFIG } from '../model';
import './MonitorConfigEditor.css';

interface MonitorConfigEditorProps {
	/** 编辑的配置项（null 表示新建） */
	config: MonitorConfig | null;
	/** 保存回调 */
	onSave: (config: MonitorConfig) => void;
	/** 取消回调 */
	onCancel: () => void;
}

/**
 * 单个监控配置的编辑组件
 */
export function MonitorConfigEditor(props: MonitorConfigEditorProps) {
	const { config, onSave, onCancel } = props;
	const app = useObsidianApp();

	const [path, setPath] = useState(config?.path ?? '');
	const [targetType, setTargetType] = useState<MonitorTargetType>(
		config?.targetType ?? DEFAULT_MONITOR_CONFIG.targetType
	);
	const [expiryDays, setExpiryDays] = useState(
		config?.expiryDays ?? DEFAULT_MONITOR_CONFIG.expiryDays
	);
	const [recursive, setRecursive] = useState(
		config?.recursive ?? DEFAULT_MONITOR_CONFIG.recursive
	);
	const [minStayMinutes, setMinStayMinutes] = useState(
		config?.minStayMinutes ?? DEFAULT_MONITOR_CONFIG.minStayMinutes
	);

	// 路径输入框引用，用于绑定 Suggest
	const pathInputRef = useRef<HTMLInputElement>(null);
	// 保存当前 suggest 实例的引用，切换类型时用于清理
	const suggestRef = useRef<MonitorFolderSuggest | FileSuggest | null>(null);

	// 根据 targetType 绑定对应的 Suggest 到路径输入框
	useEffect(() => {
		if (!pathInputRef.current || !app) return;

		// 销毁旧的 suggest 实例
		if (suggestRef.current) {
			suggestRef.current.close();
			suggestRef.current = null;
		}

		if (targetType === MonitorTargetType.FOLDER) {
			const suggest = new MonitorFolderSuggest(app, pathInputRef.current);
			suggest.onSelect((folder) => {
				setPath(folder.path);
				if (pathInputRef.current) {
					pathInputRef.current.value = folder.path;
				}
				suggest.close();
			});
			suggestRef.current = suggest;
		} else {
			const suggest = new FileSuggest(app, pathInputRef.current);
			suggest.onSelect((file) => {
				setPath(file.path);
				if (pathInputRef.current) {
					pathInputRef.current.value = file.path;
				}
				suggest.close();
			});
			suggestRef.current = suggest;
		}

		return () => {
			if (suggestRef.current) {
				suggestRef.current.close();
				suggestRef.current = null;
			}
		};
	}, [app, targetType]);

	const handleSave = () => {
		if (!path.trim()) return;
		onSave({
			id: config?.id ?? v4(),
			path: path.trim(),
			targetType,
			expiryDays: Math.max(1, expiryDays),
			recursive,
			minStayMinutes: Math.max(1, minStayMinutes),
		});
	};

	return (
		<div className="fem-config-editor">
			{/* 监控路径 */}
			<div className="fem-config-editor__row">
				<label className="fem-config-editor__label">{localInstance.monitor_path}</label>
				<input
					ref={pathInputRef}
					type="text"
					className="fem-config-editor__input"
					value={path}
					onChange={(e) => setPath(e.target.value)}
					placeholder="folder/subfolder"
				/>
			</div>

			{/* 监控类型 */}
			<div className="fem-config-editor__row">
				<label className="fem-config-editor__label">{localInstance.monitor_type}</label>
				<div className="fem-config-editor__radio-group">
					<label className="fem-config-editor__radio-label">
						<input
							type="radio"
							name="targetType"
							checked={targetType === MonitorTargetType.FOLDER}
							onChange={() => setTargetType(MonitorTargetType.FOLDER)}
						/>
						{localInstance.monitor_type_folder}
					</label>
					<label className="fem-config-editor__radio-label">
						<input
							type="radio"
							name="targetType"
							checked={targetType === MonitorTargetType.FILE}
							onChange={() => setTargetType(MonitorTargetType.FILE)}
						/>
						{localInstance.monitor_type_file}
					</label>
				</div>
			</div>

			{/* 过期天数 */}
			<div className="fem-config-editor__row">
				<label className="fem-config-editor__label">{localInstance.expiry_days}</label>
				<input
					type="number"
					className="fem-config-editor__input fem-config-editor__input--narrow"
					value={expiryDays}
					min={1}
					onChange={(e) => setExpiryDays(Number(e.target.value) || 30)}
				/>
			</div>

			{/* 递归（仅文件夹模式） */}
			{targetType === MonitorTargetType.FOLDER && (
				<div className="fem-config-editor__row">
					<label className="fem-config-editor__label">{localInstance.recursive}</label>
					<ToggleSwitch checked={recursive} onChange={setRecursive} />
				</div>
			)}

			{/* 最小保持时间 */}
			<div className="fem-config-editor__row">
				<label className="fem-config-editor__label">{localInstance.min_stay_minutes}</label>
				<input
					type="number"
					className="fem-config-editor__input fem-config-editor__input--narrow"
					value={minStayMinutes}
					min={1}
					onChange={(e) => setMinStayMinutes(Number(e.target.value) || 5)}
				/>
			</div>

			{/* 操作按钮 */}
			<div className="fem-config-editor__actions">
				<button className="fem-config-editor__btn fem-config-editor__btn--cancel" onClick={onCancel}>
					{localInstance.cancel}
				</button>
				<button
					className="fem-config-editor__btn fem-config-editor__btn--save"
					onClick={handleSave}
					disabled={!path.trim()}
				>
					{localInstance.save}
				</button>
			</div>
		</div>
	);
}
