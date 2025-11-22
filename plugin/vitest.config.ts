import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			include: [
				"src/utils/Loop*.ts",
				"src/service/action/loop/LoopControlError.ts",
				"src/service/action/loop/BreakActionService.ts",
				"src/service/action/loop/ContinueActionService.ts",
			],
			reporter: ["text", "lcov"],
			thresholds: {
				lines: 0.8,
				functions: 0.8,
				branches: 0.8,
				statements: 0.8,
			},
		},
	},
	resolve: {
		alias: {
			src: path.resolve(__dirname, "src"),
			obsidian: path.resolve(__dirname, "tests/mocks/obsidian.ts"),
		},
	},
});

