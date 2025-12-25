import { AlertTriangle, CheckCircle, Copy, Filter, RefreshCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { localInstance } from "src/i18n/locals";
import { FormConfig } from "src/model/FormConfig";
import FormPlugin from "src/main";
import { VariableRegistry } from "src/service/variable/VariableRegistry";
import { VariableConflictDetector } from "src/service/variable/VariableConflictDetector";
import { ConflictInfo, VariableInfo, VariableSource } from "src/types/variable";
import "./VariableManagementTabItem.css";

type VariableRow = VariableInfo & {
	id: string;
	filePath: string;
	fileName: string;
	conflict?: ConflictInfo;
};

const TYPE_FILTERS: Array<{ value: VariableSource | "all"; label: string }> = [
	{ value: "all", label: localInstance.all },
	{ value: VariableSource.FORM_FIELD, label: localInstance.form_field_variable },
	{ value: VariableSource.LOOP_VAR, label: localInstance.loop_variable },
	{ value: VariableSource.AI_OUTPUT, label: localInstance.ai_output_variable },
	{ value: VariableSource.SUGGEST_MODAL, label: localInstance.suggest_field_variable },
	{ value: VariableSource.INTERNAL, label: localInstance.internal_variable },
	{ value: VariableSource.SYSTEM_RESERVED, label: localInstance.system_reserved_variable }
];

const STATUS_FILTERS: Array<{ value: "all" | "conflict" | "normal"; label: string }> = [
	{ value: "all", label: localInstance.all },
	{ value: "conflict", label: localInstance.has_conflicts },
	{ value: "normal", label: localInstance.no_conflicts }
];

export function VariableManagementTabItem(props: { plugin: FormPlugin }) {
	const { plugin } = props;
	const [rows, setRows] = useState<VariableRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [typeFilter, setTypeFilter] = useState<VariableSource | "all">("all");
	const [statusFilter, setStatusFilter] = useState<"all" | "conflict" | "normal">("all");
	const [search, setSearch] = useState("");

	const scanVariables = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const vault = plugin.app.vault;
			const formFiles = vault.getFiles().filter((file) => file.extension === "cform");
			const nextRows: VariableRow[] = [];

			for (const file of formFiles) {
				try {
					const raw = await vault.read(file);
					const parsed = JSON.parse(raw);
					const config = FormConfig.fromJSON(parsed);
					const variables = VariableRegistry.collectAllVariables(config, { includeSystemReserved: false });
					const conflicts = VariableConflictDetector.detectConflictsFromConfig(config);
					const conflictMap = new Map<string, ConflictInfo>();
					conflicts.forEach((conflict) => {
						conflict.items.forEach((item) => {
							if (item.name) {
								conflictMap.set(item.name.trim(), conflict);
							}
						});
						if (conflict.variableName) {
							conflictMap.set(conflict.variableName.trim(), conflict);
						}
					});

					variables.forEach((variable, index) => {
						const trimmedName = variable.name?.trim();
						if (!trimmedName) {
							return;
						}
						nextRows.push({
							...variable,
							name: trimmedName,
							id: `${file.path}-${variable.source}-${variable.sourceId ?? index}-${index}`,
							filePath: file.path,
							fileName: file.basename,
							conflict: conflictMap.get(trimmedName)
						});
					});
				} catch (readError) {
					console.warn(`Failed to read form file ${file.path}`, readError);
				}
			}

			setRows(nextRows);
		} catch (err) {
			console.error(err);
			setError((err as Error).message);
		} finally {
			setLoading(false);
		}
	}, [plugin]);

	useEffect(() => {
		scanVariables();
	}, [scanVariables]);

	const filteredRows = useMemo(() => {
		const keyword = search.trim().toLowerCase();
		return rows.filter((row) => {
			if (typeFilter !== "all" && row.source !== typeFilter) {
				return false;
			}
			if (statusFilter === "conflict" && !row.conflict) {
				return false;
			}
			if (statusFilter === "normal" && row.conflict) {
				return false;
			}
			if (keyword) {
				const haystack = `${row.name} ${row.fileName} ${row.filePath}`.toLowerCase();
				if (!haystack.includes(keyword)) {
					return false;
				}
			}
			return true;
		});
	}, [rows, typeFilter, statusFilter, search]);

	const formCount = useMemo(() => {
		return new Set(rows.map((row) => row.filePath)).size;
	}, [rows]);

	const conflictCount = useMemo(() => rows.filter((row) => row.conflict).length, [rows]);

	const handleExport = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
		} catch (err) {
			console.warn("Failed to export variable info", err);
		}
	}, [rows]);

	return (
		<div className="form--VariableManagement">
			<div className="form--VariableToolbar">
				<div className="form--VariableToolbarActions">
					<button onClick={scanVariables} disabled={loading}>
						<RefreshCcw size={16} />
						{localInstance.refresh}
					</button>
					<button onClick={handleExport} disabled={rows.length === 0}>
						<Copy size={16} />
						{localInstance.export_variables}
					</button>
				</div>
				<div className="form--VariableSearch">
					<Search size={16} />
					<input
						type="text"
						value={search}
						placeholder={localInstance.search_variables}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</div>
			</div>

			<div className="form--VariableSummary">
				<div className="form--VariableSummaryCard">
					<span>{localInstance.total_variables}</span>
					<strong>{rows.length}</strong>
				</div>
				<div className="form--VariableSummaryCard" data-conflict="true">
					<span>{localInstance.has_conflicts}</span>
					<strong>{conflictCount}</strong>
				</div>
				<div className="form--VariableSummaryCard">
					<span>{localInstance.forms_count}</span>
					<strong>{formCount}</strong>
				</div>
			</div>

			<div className="form--VariableFilters">
				<div className="form--VariableFilterGroup">
					<Filter size={14} />
					{TYPE_FILTERS.map((option) => (
						<button
							key={option.value}
							className="form--VariableFilterButton"
							data-active={typeFilter === option.value}
							onClick={() => setTypeFilter(option.value)}
						>
							{option.label}
						</button>
					))}
				</div>
				<div className="form--VariableFilterGroup">
					{STATUS_FILTERS.map((option) => (
						<button
							key={option.value}
							className="form--VariableFilterButton"
							data-active={statusFilter === option.value}
							onClick={() => setStatusFilter(option.value)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

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
							<th>{localInstance.variable_name}</th>
							<th>{localInstance.variable_type}</th>
							<th>{localInstance.variable_source}</th>
							<th>{localInstance.variable_file}</th>
							<th>{localInstance.conflict_status}</th>
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td colSpan={5} className="form--VariableEmpty">
									{localInstance.loading}
								</td>
							</tr>
						) : filteredRows.length === 0 ? (
							<tr>
								<td colSpan={5} className="form--VariableEmpty">
									{localInstance.no_variables_found}
								</td>
							</tr>
						) : (
							filteredRows.map((row) => (
								<tr key={row.id} data-conflict={!!row.conflict}>
									<td>
										<div className="form--VariableNameCell">
											<strong>{row.name}</strong>
											{row.description && <span>{row.description}</span>}
										</div>
									</td>
									<td>{TYPE_FILTERS.find((item) => item.value === row.source)?.label ?? row.source}</td>
									<td>{row.location?.path || row.location?.actionType || "-"}</td>
									<td>
										<div className="form--VariableFileCell">
											<span>{row.fileName}</span>
											<code>{row.filePath}</code>
										</div>
									</td>
									<td>
										{row.conflict ? (
											<span className="form--VariableStatusBadge" data-type="conflict">
												<AlertTriangle size={14} />
												{localInstance.has_conflicts}
											</span>
										) : (
											<span className="form--VariableStatusBadge" data-type="normal">
												<CheckCircle size={14} />
												{localInstance.no_conflicts}
											</span>
										)}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

