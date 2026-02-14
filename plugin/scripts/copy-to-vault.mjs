import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(scriptDir, "..");
const repoRootDir = resolve(pluginDir, "..");
const ENV_KEY = "OBSIDIAN_VAULT_PATH";

const requiredBuildFiles = ["main.js"];
const optionalBuildFiles = ["styles.css", "versions.json"];

function loadEnvFiles() {
	const envCandidates = [resolve(pluginDir, ".env"), resolve(repoRootDir, ".env")];

	for (const envPath of envCandidates) {
		if (existsSync(envPath)) {
			dotenv.config({ path: envPath, quiet: true });
		}
	}
}

async function pathExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveManifestPath() {
	const candidates = [
		resolve(pluginDir, "manifest.json"),
		resolve(repoRootDir, "manifest.json")
	];

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`[formify] 未找到 manifest.json。已检查: ${candidates.join(", ")}`
	);
}

async function readPluginId(manifestPath) {
	const manifestContent = await readFile(manifestPath, "utf8");
	const manifest = JSON.parse(manifestContent);
	if (!manifest?.id || typeof manifest.id !== "string") {
		throw new Error(`[formify] manifest.json 缺少有效的 id 字段: ${manifestPath}`);
	}
	return manifest.id;
}

async function resolveFilesToCopy(manifestPath) {
	const files = [
		{ name: "main.js", sourcePath: resolve(pluginDir, "main.js"), required: true },
		{ name: "manifest.json", sourcePath: manifestPath, required: true }
	];

	for (const name of optionalBuildFiles) {
		const sourcePath = resolve(pluginDir, name);
		if (await pathExists(sourcePath)) {
			files.push({ name, sourcePath, required: false });
		}
	}

	for (const name of requiredBuildFiles) {
		const sourcePath = resolve(pluginDir, name);
		if (!(await pathExists(sourcePath))) {
			throw new Error(`[formify] 缺少构建产物: ${sourcePath}。请先运行构建命令。`);
		}
	}

	return files;
}

export async function copyToVault(options = {}) {
	loadEnvFiles();

	const vaultPathFromEnv = process.env[ENV_KEY];
	const vaultRoot = resolve(options.vaultPath ?? vaultPathFromEnv ?? "");
	if (!vaultPathFromEnv && !options.vaultPath) {
		throw new Error(
			`[formify] 未设置 ${ENV_KEY}。请在 plugin/.env 或仓库根 .env 中添加：${ENV_KEY}=/path/to/your/vault`
		);
	}

	const manifestPath = await resolveManifestPath();
	const pluginId = await readPluginId(manifestPath);
	const sourceDir = pluginDir;
	const targetPluginDir = resolve(vaultRoot, ".obsidian", "plugins", pluginId);
	const filesToCopy = await resolveFilesToCopy(manifestPath);

	await mkdir(targetPluginDir, { recursive: true });

	const copiedFiles = [];
	for (const file of filesToCopy) {
		const targetPath = join(targetPluginDir, file.name);
		await copyFile(file.sourcePath, targetPath);
		copiedFiles.push(file.name);
	}

	console.log(`[formify] Source: ${sourceDir}`);
	console.log(`[formify] Vault: ${vaultRoot}`);
	console.log(`[formify] Plugin id: ${pluginId}`);
	console.log(`[formify] Target: ${targetPluginDir}`);
	console.log(`[formify] Copy: ${copiedFiles.join(", ")}`);

	return {
		pluginId,
		sourceDir,
		targetPluginDir,
		copiedFiles
	};
}

const isDirectRun =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
	try {
		await copyToVault();
	} catch (error) {
		console.error(`[formify] Copy failed: ${error.message}`);
		process.exit(1);
	}
}
