import path from "node:path";
import {
	createRunContext,
	ensureRunDirs,
	writeJson,
	writeText,
} from "./shared.mjs";

function createFileAction(filePath, content) {
	return {
		id: `create-${path.basename(filePath).replace(/\W+/g, "-")}`,
		type: "createFile",
		filePath,
		openPageIn: "none",
		contentTemplateSource: "text",
		content,
		templateFile: "",
		conflictResolution: "overwrite",
		createFileMode: "singleFile",
		batchFilePaths: [],
		folderPath: "",
		batchFolderPaths: [],
	};
}

function createBaseForm(id) {
	return {
		id,
		fields: [],
		actions: [],
		actionGroups: [],
		actionTriggers: [],
		showSubmitSuccessToast: false,
		enableExecutionTimeout: false,
		executionTimeoutThreshold: 30,
		commandEnabled: false,
		contextMenuEnabled: false,
		runOnStartup: false,
	};
}

export async function generateSupplementalFixtures(runId) {
	const ctx = createRunContext(runId);
	await ensureRunDirs(ctx);

	const notes = {
		"results/.gitkeep": "",
		"files/with-frontmatter.md": "---\nstatus: ready\ntags:\n  - alpha\n---\n# With Frontmatter\nBody alpha\n",
		"files/plain.md": "# Plain File\nBody plain\n",
		"active-note.md": "# Active Note\nCurrent content with english中文.\n[[chat-linked-target]]\n",
		"chat-linked-target.md": "# Linked Target\nLINK_TARGET_MARKER\n",
		"startup-reference.md": "---\nstatus: ready\nkind: startup\n---\n# Startup Reference\n",
		"text-source.md": "# Text Source\n**Bold** and *italic* with ![[image.png]] and [link](https://example.com).\n中文English mixed.\n\n## Section A\nA body\n### Section B\nB body\n",
		"text-clear-format.md": "# Clear **Bold**\n- item 1\n> quote\n",
		"text-delete-content.md": "---\nstatus: keep\n---\n# Heading A\nA1\n## Child\nA2\n# Heading B\nB1\n",
		"text-delete-file.md": "# Delete me\n",
		"text-move-file.md": "# Move me\n",
		"move-destination/.gitkeep": "",
		"expiry-open.md": "# Expiry Open\n",
		"expiry-delete.md": "# Expiry Delete\n",
		"expiry-move.md": "# Expiry Move\n",
	};

	for (const [relativePath, content] of Object.entries(notes)) {
		await writeText(path.join(ctx.notesDir, relativePath), content);
	}

	const integrationForm = {
		...createBaseForm("supplemental-integration-form"),
		fields: [
			{ id: "field-title", label: "Title", type: "text", defaultValue: "integration-pass" },
		],
		actions: [
			createFileAction(
				`System/formify-tests/${ctx.runId}/fixtures/notes/results/integration-output.md`,
				"integration={{@Title}}"
			),
		],
		actionTriggers: [
			{
				id: "integration-trigger",
				name: "Integration Trigger",
				actionIds: ["create-integration-output-md"],
				commandEnabled: true,
				contextMenuEnabled: true,
				runOnStartup: false,
				autoTriggerEnabled: false,
			},
		],
		commandEnabled: true,
		contextMenuEnabled: true,
	};

	const importSource = {
		...createBaseForm("supplemental-import-source"),
		fields: [
			{ id: "src-title", label: "SourceTitle", type: "text", defaultValue: "src" },
			{ id: "src-duplicate", label: "DuplicateField", type: "text", defaultValue: "duplicate" },
			{ id: "src-unique", label: "UniqueField", type: "number", defaultValue: 7 },
		],
		actions: [
			createFileAction(
				`System/formify-tests/${ctx.runId}/fixtures/notes/results/import-source-output.md`,
				"source={{@SourceTitle}}"
			),
			{
				id: "import-source-command",
				type: "runCommand",
				commandId: "formify:file-expiry-check-now",
				commandName: "Formify: file-expiry-check-now",
				commandSourceMode: "fixed",
			},
		],
		showSubmitSuccessToast: true,
		enableExecutionTimeout: true,
		executionTimeoutThreshold: 45,
		commandEnabled: true,
	};

	const importTarget = {
		...createBaseForm("supplemental-import-target"),
		fields: [
			{ id: "target-duplicate", label: "DuplicateField", type: "text", defaultValue: "target-duplicate" },
			{ id: "target-only", label: "TargetOnly", type: "checkbox", defaultValue: true },
		],
		actions: [
			createFileAction(
				`System/formify-tests/${ctx.runId}/fixtures/notes/results/import-target-output.md`,
				"target=true"
			),
		],
		commandEnabled: true,
	};

	const startupForm = {
		...createBaseForm("supplemental-startup-form"),
		actions: [
			createFileAction(
				`System/formify-tests/${ctx.runId}/fixtures/notes/results/startup-output.md`,
				"startup=ok"
			),
		],
		runOnStartup: true,
	};

	const autoTriggerForm = {
		...createBaseForm("supplemental-auto-trigger-form"),
		actions: [
			createFileAction(
				`System/formify-tests/${ctx.runId}/fixtures/notes/results/auto-trigger-output.md`,
				"auto-trigger=ok"
			),
		],
		startupConditions: {
			enabled: true,
			relation: "and",
			conditions: [
				{
					id: "auto-trigger-script",
					type: "script",
					category: "autoTrigger",
					relation: "and",
					enabled: true,
					config: {
						expression: "return true;",
					},
				},
			],
		},
		actionTriggers: [
			{
				id: "auto-trigger-action",
				name: "Auto Trigger Action",
				actionIds: ["create-auto-trigger-output-md"],
				commandEnabled: false,
				contextMenuEnabled: false,
				runOnStartup: false,
				autoTriggerEnabled: true,
				startupConditions: {
					enabled: true,
					relation: "and",
					conditions: [
						{
							id: "auto-trigger-script-2",
							type: "script",
							category: "autoTrigger",
							relation: "and",
							enabled: true,
							config: {
								expression: "return true;",
							},
						},
					],
				},
			},
		],
	};

	const forms = {
		"integration-form.cform": integrationForm,
		"import-source.cform": importSource,
		"import-target.cform": importTarget,
		"startup-form.cform": startupForm,
		"auto-trigger-form.cform": autoTriggerForm,
	};

	for (const [relativePath, config] of Object.entries(forms)) {
		await writeJson(path.join(ctx.formsDir, relativePath), config);
	}

	const meta = {
		runId: ctx.runId,
		forms: Object.keys(forms).map((name) => `System/formify-tests/${ctx.runId}/fixtures/forms/${name}`),
		notes: Object.keys(notes).map((name) => `System/formify-tests/${ctx.runId}/fixtures/notes/${name}`),
	};
	await writeJson(path.join(ctx.fixturesDir, "fixture-meta.json"), meta);

	return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const runId = process.argv[2];
	await generateSupplementalFixtures(runId);
}
