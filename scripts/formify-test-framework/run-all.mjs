import path from "node:path";
import {
	createRunContext,
	createRunId,
	ensureRunDirs,
	buildAndSyncPlugin,
	reloadPlugin,
	setTestHooksEnabled,
	getTestHookInfo,
	sleep,
	writeJson,
	readJson,
} from "./shared.mjs";
import { generateSupplementalFixtures } from "./generate-fixtures.mjs";
import { expectedSupplementalCaseIds, runSupplementalSuite } from "./run-supplemental-suite.mjs";
import { buildSupplementalReport } from "./build-report.mjs";

const runId = process.argv[2] ?? createRunId();
const ctx = createRunContext(runId);

async function waitForExpectedSupplementalCases() {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const rows = await readJson(path.join(ctx.logsDir, "supplemental-results.json"), []);
		const caseIds = new Set(rows.map((row) => row.caseId));
		const ready = expectedSupplementalCaseIds.every((caseId) => caseIds.has(caseId));
		if (ready) {
			return;
		}
		await sleep(500);
	}
}

await ensureRunDirs(ctx);
await writeJson(path.join(ctx.logsDir, "framework-run.json"), {
	runId: ctx.runId,
	startedAt: new Date().toISOString(),
});

try {
	await generateSupplementalFixtures(ctx.runId);
	await buildAndSyncPlugin();
	await reloadPlugin(ctx);
	await sleep(3000);
	await setTestHooksEnabled(true);
	await sleep(1500);
	const hookInfo = await getTestHookInfo();
	await writeJson(path.join(ctx.logsDir, "test-hook-info.json"), hookInfo);
	if (!hookInfo?.enabled) {
		throw new Error("test hooks were not enabled successfully");
	}

	await runSupplementalSuite(ctx.runId);
	await waitForExpectedSupplementalCases();
	await buildSupplementalReport(ctx.runId);
	await waitForExpectedSupplementalCases();
	await buildSupplementalReport(ctx.runId);
} finally {
	try {
		await setTestHooksEnabled(false);
	} catch {
		// ignore teardown failure
	}
}
