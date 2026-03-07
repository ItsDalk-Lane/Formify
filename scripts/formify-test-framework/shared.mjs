import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const repoRoot = "/Users/study_superior/Desktop/Code/Formify";
export const pluginRoot = path.join(repoRoot, "plugin");
export const vaultRoot = process.env.FORMIFY_TEST_VAULT ?? "/Users/study_superior/Desktop/沙箱仓库";
export const baselineRunId = process.env.FORMIFY_BASELINE_RUN_ID ?? "20260307-090505";

export function createRunId(date = new Date()) {
	const yyyy = String(date.getFullYear());
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export function createRunContext(runId = createRunId()) {
	const runDir = path.join(vaultRoot, "System", "formify-tests", runId);
	return {
		runId,
		runDir,
		fixturesDir: path.join(runDir, "fixtures"),
		formsDir: path.join(runDir, "fixtures", "forms"),
		notesDir: path.join(runDir, "fixtures", "notes"),
		screenshotsDir: path.join(runDir, "screenshots"),
		logsDir: path.join(runDir, "logs"),
		cliDir: path.join(runDir, "cli"),
	};
}

export async function ensureDir(dir) {
	await fs.mkdir(dir, { recursive: true });
}

export async function ensureRunDirs(ctx) {
	await Promise.all([
		ensureDir(ctx.runDir),
		ensureDir(ctx.fixturesDir),
		ensureDir(ctx.formsDir),
		ensureDir(ctx.notesDir),
		ensureDir(ctx.screenshotsDir),
		ensureDir(ctx.logsDir),
		ensureDir(ctx.cliDir),
	]);
}

export async function writeText(filePath, content) {
	await ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, content, "utf8");
}

export async function writeJson(filePath, value) {
	await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readText(filePath, fallback = "") {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return fallback;
	}
}

export async function readJson(filePath, fallback = null) {
	try {
		return JSON.parse(await readText(filePath));
	} catch {
		return fallback;
	}
}

export async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function sleep(ms) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function execProcess(command, args, options = {}) {
	const {
		cwd = repoRoot,
		timeoutMs = 120000,
		env = process.env,
		stdio = ["ignore", "pipe", "pipe"],
	} = options;
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			stdio,
			shell: false,
		});
		let stdout = "";
		let stderr = "";
		let finished = false;
		const timer = setTimeout(() => {
			if (finished) return;
			finished = true;
			child.kill("SIGTERM");
			reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
		}, timeoutMs);

		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

export async function execObsidian(args, options = {}) {
	return await execProcess("obsidian", args, {
		cwd: vaultRoot,
		...options,
	});
}

export async function captureCliOutput(ctx, name, args, options = {}) {
	const result = await execObsidian(args, options);
	await writeText(path.join(ctx.cliDir, `${name}.txt`), `${result.stdout}${result.stderr}`.trimEnd() + "\n");
	return result;
}

export async function obsidianEvalRaw(code, options = {}) {
	return await execObsidian(["eval", `code=${code}`], options);
}

export async function obsidianEvalJson(body, options = {}) {
	const wrapped = `
(async () => {
  const result = await (async () => {
${body}
  })();
  return JSON.stringify(result ?? null);
})()
	`.trim();
	const result = await obsidianEvalRaw(wrapped, options);
	if (result.code !== 0) {
		throw new Error(stripAnsi(result.stderr || result.stdout || "obsidian eval failed").trim());
	}
	const lines = stripAnsi(result.stdout)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const text = lines.length > 0 ? lines[lines.length - 1].replace(/^=>\s*/, "") : "";
	if (!text) {
		return null;
	}
	return JSON.parse(text);
}

export async function buildAndSyncPlugin() {
	return await execProcess("npm", ["run", "build:local"], {
		cwd: pluginRoot,
		timeoutMs: 240000,
		stdio: "inherit",
	});
}

export async function reloadPlugin(ctx) {
	const result = await captureCliOutput(ctx, "plugin-reload", ["plugin:reload", "id=formify"], {
		timeoutMs: 120000,
	});
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || "plugin:reload failed");
	}
	return result;
}

export async function setTestHooksEnabled(enabled) {
	return await obsidianEvalJson(`
const plugin = app.plugins.plugins.formify;
if (!plugin) {
  throw new Error("formify-plugin-not-loaded");
}
await plugin.replaceSettings({
  testing: {
    enableTestHooks: ${enabled ? "true" : "false"},
  },
});
return plugin.settings.testing;
`, {
		timeoutMs: 120000,
	});
}

export async function getTestHookInfo() {
	return await obsidianEvalJson(`
const hook = window.__formifyTestHooks;
if (!hook) {
  return null;
}
return hook.getInfo();
`);
}

export function csvEscape(value) {
	const text = String(value ?? "");
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function stripAnsi(text) {
	return String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}
