import path from "node:path";
import {
	createRunContext,
	baselineRunId,
	vaultRoot,
	readJson,
	readText,
	writeText,
	csvEscape,
} from "./shared.mjs";

function parseCsv(text) {
	const rows = [];
	let field = "";
	let row = [];
	let inQuotes = false;

	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		const next = text[i + 1];

		if (inQuotes) {
			if (char === '"' && next === '"') {
				field += '"';
				i += 1;
			} else if (char === '"') {
				inQuotes = false;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
			continue;
		}
		if (char === ",") {
			row.push(field);
			field = "";
			continue;
		}
		if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			continue;
		}
		if (char !== "\r") {
			field += char;
		}
	}

	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((entry) => entry.length > 1);
}

function countStatuses(rows) {
	return rows.reduce((acc, row) => {
		acc[row.result] = (acc[row.result] ?? 0) + 1;
		return acc;
	}, {});
}

function statusRank(status) {
	switch (status) {
		case "FAIL":
			return 0;
		case "PARTIAL":
			return 1;
		case "UNTESTED":
			return 2;
		default:
			return 3;
	}
}

export async function buildSupplementalReport(runId) {
	const ctx = createRunContext(runId);
	const baselineCsvPath = path.join(vaultRoot, "System", "formify-tests", baselineRunId, "coverage-matrix.csv");
	const baselineCsvText = await readText(baselineCsvPath, "");
	const baselineRowsRaw = parseCsv(baselineCsvText);
	const defaultHeader = ["模块", "功能/配置项", "用例ID", "入口", "预期", "实际", "结果", "证据路径", "未测原因"];
	const [header = defaultHeader, ...dataRows] = baselineRowsRaw;
	const baselineRows = dataRows.map((row) => ({
		module: row[0],
		feature: row[1],
		caseId: row[2],
		entry: row[3],
		expected: row[4],
		actual: row[5],
		result: row[6],
		evidencePath: row[7],
		untestedReason: row[8] ?? "",
	}));
	const supplementalRows = await readJson(path.join(ctx.logsDir, "supplemental-results.json"), []);

	const baselineByCaseId = new Map(baselineRows.map((row) => [row.caseId, row]));
	const mergedByCaseId = new Map(baselineRows.map((row) => [row.caseId, { ...row }]));
	for (const row of supplementalRows) {
		mergedByCaseId.set(row.caseId, {
			module: row.module,
			feature: row.feature,
			caseId: row.caseId,
			entry: row.entry,
			expected: row.expected,
			actual: JSON.stringify(row.actual ?? null),
			result: row.status,
			evidencePath: row.evidencePath,
			untestedReason: row.untestedReason ?? "",
		});
	}

	const mergedRows = Array.from(mergedByCaseId.values()).sort((a, b) => a.caseId.localeCompare(b.caseId));
	const baselineCounts = countStatuses(baselineRows);
	const mergedCounts = countStatuses(mergedRows);
	const baselineAvailable = baselineRowsRaw.length > 0;
	const changedRows = supplementalRows.map((row) => ({
		caseId: row.caseId,
		feature: row.feature,
		module: row.module,
		from: baselineByCaseId.get(row.caseId)?.result ?? "N/A",
		to: row.status,
	}));
	const unresolvedRows = mergedRows
		.filter((row) => row.result !== "PASS")
		.sort((a, b) => statusRank(a.result) - statusRank(b.result) || a.caseId.localeCompare(b.caseId));

	const csvLines = [
		header.map(csvEscape).join(","),
		...mergedRows.map((row) =>
			[
				row.module,
				row.feature,
				row.caseId,
				row.entry,
				row.expected,
				row.actual,
				row.result,
				row.evidencePath,
				row.untestedReason,
			].map(csvEscape).join(",")
		),
	];
	await writeText(path.join(ctx.runDir, "coverage-matrix.csv"), `${csvLines.join("\n")}\n`);

	const issuesLines = unresolvedRows.map((row) => {
		const reason = row.untestedReason ? `未测/部分原因：${row.untestedReason}` : `实际：${row.actual}`;
		return `- \`${row.caseId}\` ${row.result} ${row.module} / ${row.feature}\n  入口：${row.entry}\n  ${reason}\n  证据：${row.evidencePath}`;
	});
	await writeText(
		path.join(ctx.runDir, "issues.md"),
		[
			"# Formify 补测问题清单",
			"",
			`基线 run：\`${baselineRunId}\``,
			`补测 run：\`${ctx.runId}\``,
			"",
			issuesLines.length > 0 ? issuesLines.join("\n") : "- 本轮补测后无新增未解决项。",
			"",
		].join("\n")
	);

	const report = [
		"# Formify 补测与自动测试框架报告",
		"",
		`- 基线 run：\`${baselineRunId}\``,
		`- 本轮补测 run：\`${ctx.runId}\``,
		`- 基线覆盖矩阵：${baselineCsvPath}`,
		`- 本轮补测结果：${path.join(ctx.logsDir, "supplemental-results.json")}`,
		`- 测试钩子开关：\`plugin.settings.testing.enableTestHooks\``,
		`- 基线可用性：${baselineAvailable ? "已加载" : "缺失，当前报告按补测项自洽生成"}`,
		"",
		"## 执行摘要",
		`- 基线统计：PASS ${baselineCounts.PASS ?? 0} / FAIL ${baselineCounts.FAIL ?? 0} / PARTIAL ${baselineCounts.PARTIAL ?? 0} / UNTESTED ${baselineCounts.UNTESTED ?? 0}`,
		`- 合并后统计：PASS ${mergedCounts.PASS ?? 0} / FAIL ${mergedCounts.FAIL ?? 0} / PARTIAL ${mergedCounts.PARTIAL ?? 0} / UNTESTED ${mergedCounts.UNTESTED ?? 0}`,
		`- 本轮补测项数：${supplementalRows.length}`,
		"",
		"## 本轮变更结果",
		...changedRows.map((row) => `- \`${row.caseId}\` ${row.module} / ${row.feature}: ${row.from} -> ${row.to}`),
		"",
		"## 仍未完全通过的项",
		...(unresolvedRows.length > 0
			? unresolvedRows.map((row) =>
				`- \`${row.caseId}\` ${row.result} ${row.module} / ${row.feature}: ${row.untestedReason || row.actual}`
			)
			: ["- 合并后的覆盖矩阵中所有项均为 PASS。"]),
		"",
		"## 自动测试框架",
		"- 框架目录：`/Users/study_superior/Desktop/Code/Formify/scripts/formify-test-framework/`",
		"- 入口命令：`cd /Users/study_superior/Desktop/Code/Formify/plugin && npm run test:framework`",
		"- 输出目录：`/Users/study_superior/Desktop/沙箱仓库/System/formify-tests/<run-id>/`",
		"- 当前范围明确不覆盖：`FACT-011` 真实 AI provider 返回、外部 `MCP-003` 的全 server 全工具穷举。",
		"",
		"## 交付文件",
		`- 覆盖矩阵：${path.join(ctx.runDir, "coverage-matrix.csv")}`,
		`- 报告：${path.join(ctx.runDir, "report.md")}`,
		`- 问题清单：${path.join(ctx.runDir, "issues.md")}`,
		`- 原始补测日志：${path.join(ctx.logsDir, "supplemental-results.json")}`,
		"",
	];
	await writeText(path.join(ctx.runDir, "report.md"), report.join("\n"));

	return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const runId = process.argv[2];
	await buildSupplementalReport(runId);
}
