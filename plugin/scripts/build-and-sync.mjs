import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyToVault } from "./copy-to-vault.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(scriptDir, "..");

function runProductionBuild() {
	return new Promise((resolveBuild, rejectBuild) => {
		const child = spawn(
			process.execPath,
			["esbuild.config.mjs", "production"],
			{
				cwd: pluginDir,
				stdio: "inherit",
				shell: false
			}
		);

		child.on("error", (error) => {
			rejectBuild(new Error(`[formify] Build process failed to start: ${error.message}`));
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolveBuild();
				return;
			}
			rejectBuild(new Error(`[formify] Build failed with exit code ${code}`));
		});
	});
}

try {
	console.log("[formify] Starting production build...");
	await runProductionBuild();
	console.log("[formify] Build finished. Syncing files to Obsidian vault...");
	await copyToVault();
	console.log("[formify] Build + sync completed.");
} catch (error) {
	console.error(`[formify] Build + sync failed: ${error.message}`);
	process.exit(1);
}
