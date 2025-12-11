import { AlertTriangle, CheckCircle, RefreshCcw, Wrench, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { localInstance } from "src/i18n/locals";
import FormPlugin from "src/main";
import { CommandIdConflictDetector, CommandIdConflict } from "src/service/variable/CommandIdConflictDetector";
import "./VariableManagementTabItem.css";

export function CommandIdManagementTabItem(props: { plugin: FormPlugin }) {
	const { plugin } = props;
	const [conflicts, setConflicts] = useState<CommandIdConflict[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [totalForms, setTotalForms] = useState(0);
	const [fixing, setFixing] = useState(false);

	const scanCommandIds = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await CommandIdConflictDetector.detectConflicts(plugin.app.vault);
			setConflicts(result.conflicts);
			setTotalForms(result.totalForms);
		} catch (err) {
			console.error(err);
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	}, [plugin]);

	useEffect(() => {
		scanCommandIds();
	}, [scanCommandIds]);

	const conflictCount = useMemo(() => {
		return conflicts.reduce((sum, conflict) => sum + conflict.files.length - 1, 0);
	}, [conflicts]);

	const handleFixAllConflicts = useCallback(async () => {
		if (conflicts.length === 0) return;

		setFixing(true);
		setError(null);
		try {
			await CommandIdConflictDetector.fixConflicts(plugin.app.vault, conflicts);
			// 重新扫描以确认修复结果
			await scanCommandIds();
		} catch (err) {
			console.error(err);
			setError((err as Error).message);
		} finally {
			setFixing(false);
		}
	}, [plugin, conflicts, scanCommandIds]);

	return (
		<div className="form--VariableManagement">
			<div className="form--VariableToolbar">
				<div className="form--VariableToolbarActions">
					<button onClick={scanCommandIds} disabled={loading}>
						<RefreshCcw size={16} />
						{localInstance.refresh}
					</button>
					{conflicts.length > 0 && (
						<button onClick={handleFixAllConflicts} disabled={fixing || loading}>
							<Wrench size={16} />
							{localInstance.fix_all_conflicts}
						</button>
					)}
				</div>
			</div>

			<div className="form--VariableSummary">
				<div className="form--VariableSummaryCard">
					<span>{localInstance.forms_count}</span>
					<strong>{totalForms}</strong>
				</div>
				<div className="form--VariableSummaryCard" data-conflict="true">
					<span>{localInstance.command_id_conflict}</span>
					<strong>{conflictCount}</strong>
				</div>
				<div className="form--VariableSummaryCard">
					<span>{localInstance.command_id_management}</span>
					<strong>{conflicts.length}</strong>
				</div>
			</div>

			{fixing && (
				<div className="form--VariableInfo" data-type="loading">
					<RefreshCcw size={16} className="animate-spin" />
					{localInstance.fixing_command_id_conflicts}
				</div>
			)}

			{error && (
				<div className="form--VariableError">
					<AlertTriangle size={16} />
					{error}
				</div>
			)}

			<div className="form--VariableTableWrapper">
				<table className="form--VariableTable">
					<thead>
						<tr>
							<th>{localInstance.command_id}</th>
							<th>{localInstance.conflicted_files}</th>
							<th>{localInstance.conflict_status}</th>
							<th>{localInstance.action_type}</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td colSpan={4} className="form--VariableEmpty">
									{localInstance.loading}
								</td>
							</tr>
						) : conflicts.length === 0 ? (
							<tr>
								<td colSpan={4} className="form--VariableEmpty">
									{localInstance.no_command_id_conflicts}
								</td>
							</tr>
						) : (
							conflicts.map((conflict, index) => (
								<tr key={index} data-conflict={true}>
									<td>
										<div className="form--VariableNameCell">
											<code>{conflict.commandId}</code>
										</div>
									</td>
									<td>
										<div className="form--ConflictFiles">
											{conflict.files.map((file, fileIndex) => (
												<div key={fileIndex} className="form--ConflictFile">
													<span className="form--ConflictFileName">{file.name}</span>
													<code className="form--ConflictFilePath">{file.path}</code>
												</div>
											))}
										</div>
									</td>
									<td>
										<span className="form--VariableStatusBadge" data-type="conflict">
											<AlertTriangle size={14} />
											{localInstance.command_id_conflict}
										</span>
									</td>
									<td>
										<span className="form--ConflictCount">
											{conflict.files.length} 个文件
										</span>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{!loading && conflicts.length > 0 && (
				<div className="form--VariableFooter">
					<div className="form--VariableFooterInfo">
						<AlertCircle size={16} />
						{localInstance.command_id_conflicts_found.replace("{0}", conflicts.length.toString())}
					</div>
				</div>
			)}
		</div>
	);
}