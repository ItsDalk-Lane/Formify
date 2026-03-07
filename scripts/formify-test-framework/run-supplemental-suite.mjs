import path from "node:path";
import {
	createRunContext,
	captureCliOutput,
	obsidianEvalJson,
	ensureRunDirs,
	readJson,
	sleep,
	writeJson,
	writeText,
	vaultRoot,
} from "./shared.mjs";

export const expectedSupplementalCaseIds = [
	"FINT-001",
	"CMD-002",
	"FIMP-001",
	"FIMP-003",
	"FIMP-002",
	"FACT-001",
	"FCORE-003",
	"FCORE-004",
	"FACT-008",
	"FACT-009",
	"FACT-010",
	"FSTA-002",
	"FSTA-003",
	"FSTA-001",
	"CHAT-004",
	"CHAT-005",
	"SP-002",
	"QA-002",
	"QA-003",
	"EXP-005",
];

export async function runSupplementalSuite(runId) {
	const ctx = createRunContext(runId);
	await ensureRunDirs(ctx);

	await captureCliOutput(ctx, "version", ["version"]);
	await captureCliOutput(ctx, "help", ["help"]);

	const result = await obsidianEvalJson(`
const hook = window.__formifyTestHooks;
if (!hook) {
  throw new Error('window.__formifyTestHooks is not available');
}

const runId = '${ctx.runId}';
const runDir = 'System/formify-tests/' + runId;
const formsBase = runDir + '/fixtures/forms';
const notesBase = runDir + '/fixtures/notes';
const logsBase = runDir + '/logs';
const plugin = app.plugins.plugins.formify;
const formService = plugin.services.formService;
const autoTriggerService = plugin.services.autoTriggerService;
const results = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = async (relativePath) => await app.vault.adapter.read(relativePath);
const exists = async (relativePath) => await app.vault.adapter.exists(relativePath);
const removeIfExists = async (relativePath) => {
  if (await exists(relativePath)) {
    await app.vault.adapter.remove(relativePath);
  }
};
const getFile = (relativePath) => {
  const file = app.vault.getFileByPath(relativePath);
  if (!file) {
    throw new Error('file-not-found:' + relativePath);
  }
  return file;
};
const escModal = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};
const clickSelector = (selector) => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error('selector-not-found:' + selector);
  }
  element.click();
};
const writeResults = async () => {
  await app.vault.adapter.write(logsBase + '/supplemental-live-results.json', JSON.stringify(results, null, 2));
};
const pushResult = async (payload) => {
  results.push(payload);
  await writeResults();
};
const safe = async ({ caseId, module, feature, entry, expected, evidencePath, fn, partial = false, untestedReason = '' }) => {
  try {
    const actual = await fn();
    await pushResult({
      caseId,
      module,
      feature,
      entry,
      expected,
      actual,
      status: partial ? 'PARTIAL' : 'PASS',
      evidencePath,
      untestedReason,
    });
  } catch (error) {
    await pushResult({
      caseId,
      module,
      feature,
      entry,
      expected,
      actual: {
        error: error instanceof Error ? error.message : String(error),
      },
      status: 'FAIL',
      evidencePath,
      untestedReason,
    });
  }
};

hook.clearEvents();
hook.clearArtifacts();
hook.clearResponses();

await safe({
  caseId: 'FINT-001',
  module: 'Form.Integration',
  feature: 'command-trigger-registration-and-cleanup',
  entry: 'window.__formifyTestHooks.getFormIntegrationSnapshot',
  expected: '新增 .cform 后能注册命令与触发器，重命名与删除后能回收旧命令',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const tempPath = formsBase + '/integration-watch.cform';
    const renamedPath = formsBase + '/integration-watch-renamed.cform';
    const source = await read(formsBase + '/integration-form.cform');
    await removeIfExists(tempPath);
    await removeIfExists(renamedPath);
    await app.vault.adapter.write(tempPath, source);
    await hook.refreshFormIntegration(true);
    await sleep(400);
    const first = hook.getFormIntegrationSnapshot();
    const firstForm = first.formEntries.find((item) => item.path === tempPath);
    const firstTrigger = first.triggerEntries.find((item) => item.path === tempPath);
    if (!firstForm || !firstTrigger || firstTrigger.commandIds.length === 0) {
      throw new Error('temporary integration form was not registered');
    }
    await app.fileManager.renameFile(getFile(tempPath), renamedPath);
    await sleep(500);
    const second = hook.getFormIntegrationSnapshot();
    if (second.formEntries.some((item) => item.path === tempPath)) {
      throw new Error('old path command still exists after rename');
    }
    if (!second.formEntries.some((item) => item.path === renamedPath)) {
      throw new Error('renamed command path missing');
    }
    await app.vault.delete(getFile(renamedPath));
    await sleep(500);
    const third = hook.getFormIntegrationSnapshot();
    if (third.formEntries.some((item) => item.path.includes('integration-watch'))) {
      throw new Error('deleted temporary form command still exists');
    }
    return { first, second, third };
  },
});

await safe({
  caseId: 'CMD-002',
  module: 'Command',
  feature: 'open-form command entry',
  entry: 'app.commands.executeCommandById(formify:open-form)',
  expected: '执行 open-form 命令后打开 .cform 选择弹窗',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearEvents();
    await app.commands.executeCommandById('formify:open-form');
    await sleep(300);
    const snapshot = hook.getUiSnapshot();
    const events = hook.getEvents('open-form-modal-opened');
    escModal();
    if (!snapshot.openFormModal || events.length === 0) {
      throw new Error('open-form modal did not become visible');
    }
    return { snapshot, events };
  },
});

await safe({
  caseId: 'FIMP-001',
  module: 'Form.Import',
  feature: 'full import workflow',
  entry: 'window.__formifyTestHooks.runImportScenario',
  expected: '整表导入可成功执行，并能识别冲突与深拷贝',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const scenario = await hook.runImportScenario({
      sourcePath: formsBase + '/import-source.cform',
      targetPath: formsBase + '/import-target.cform',
      importOptions: {
        importType: 'all',
        deepCopy: true,
      },
    });
    if (!scenario.result?.success) {
      throw new Error('full import scenario returned unsuccessful result');
    }
    if ((scenario.conflicts?.length ?? 0) < 1) {
      throw new Error('expected import conflict was not detected');
    }
    if (!scenario.analysis?.idsChanged || !scenario.analysis?.deepCopied) {
      throw new Error('deep copy / regenerated ids assertion failed');
    }
    return scenario;
  },
});

await safe({
  caseId: 'FIMP-003',
  module: 'Form.Import',
  feature: 'partial import conflict and writeback details',
  entry: 'window.__formifyTestHooks.runImportScenario',
  expected: '部分导入可按字段/动作选择生效，并保留目标表单结构',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const scenario = await hook.runImportScenario({
      sourcePath: formsBase + '/import-source.cform',
      targetPath: formsBase + '/import-target.cform',
      importOptions: {
        importType: 'partial',
        deepCopy: true,
        partialImport: {
          importFields: true,
          importActions: true,
          importOtherSettings: true,
          fieldIds: ['src-unique'],
          actionIds: ['import-source-command'],
          otherSettings: {
            showSubmitSuccessToast: true,
            enableExecutionTimeout: true,
            executionTimeoutThreshold: true,
          },
        },
      },
    });
    if (!scenario.result?.success) {
      throw new Error('partial import scenario returned unsuccessful result');
    }
    if ((scenario.analysis?.importedFieldCount ?? 0) !== 1) {
      throw new Error('partial import field selection mismatch');
    }
    if ((scenario.analysis?.importedActionCount ?? 0) !== 1) {
      throw new Error('partial import action selection mismatch');
    }
    return scenario;
  },
});

await safe({
  caseId: 'FIMP-002',
  module: 'Form.Import',
  feature: 'import dialog entry',
  entry: 'CpsFormFileView import button',
  expected: '编辑态点击导入按钮后弹出导入对话框',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearEvents();
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(getFile(formsBase + '/import-target.cform'));
    await sleep(500);
    const editButton = document.querySelector('.form--CpsFormFileView .form--CpsFormFileViewModeButton');
    if (!(editButton instanceof HTMLElement)) {
      throw new Error('edit mode button not found');
    }
    editButton.click();
    await sleep(300);
    clickSelector('[data-testid="formify-import-button"]');
    await sleep(300);
    const snapshot = hook.getUiSnapshot();
    const events = hook.getEvents('form-import-dialog-opened');
    clickSelector('[data-testid="formify-import-dialog"] .dialog-header button');
    await sleep(200);
    if (!snapshot.importDialog || events.length === 0) {
      throw new Error('import dialog did not become visible');
    }
    return { snapshot, events };
  },
});

await safe({
  caseId: 'FCORE-004',
  module: 'Form.Core',
  feature: 'file_list includeMetadata combinations',
  entry: 'window.__formifyTestHooks.evaluateFileListValues',
  expected: 'file_list 在 includeMetadata=true/false 时分别保留和剥离 frontmatter',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const withMeta = await hook.evaluateFileListValues({
      paths: [
        notesBase + '/files/with-frontmatter.md',
        notesBase + '/files/plain.md',
      ],
      includeMetadata: true,
    });
    const withoutMeta = await hook.evaluateFileListValues({
      paths: [
        notesBase + '/files/with-frontmatter.md',
      ],
      includeMetadata: false,
    });
    if (!String(withMeta[0]?.processed ?? '').includes('status: ready')) {
      throw new Error('frontmatter should be preserved when includeMetadata=true');
    }
    if (String(withoutMeta[0]?.processed ?? '').includes('status: ready')) {
      throw new Error('frontmatter should be stripped when includeMetadata=false');
    }
    return { withMeta, withoutMeta };
  },
});

await safe({
  caseId: 'FACT-008',
  module: 'Form.Actions',
  feature: 'suggestModal action',
  entry: 'formService.submit + test hook suggestModal response',
  expected: 'suggestModal 可通过测试钩子自动选择并把值写入后续动作',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearResponses();
    hook.enqueueResponse('suggestModal', 'Beta');
    const outputPath = notesBase + '/results/suggest-modal-output.md';
    await removeIfExists(outputPath);
    await formService.submit({}, {
      id: 'suggest-modal-suite',
      fields: [],
      actions: [
        {
          id: 'suggest',
          type: 'suggestModal',
          fieldName: 'chosen',
          suggestSource: 'fixed',
          items: ['Alpha', 'Beta'],
        },
        {
          id: 'persist',
          type: 'createFile',
          filePath: outputPath,
          openPageIn: 'none',
          contentTemplateSource: 'text',
          content: 'chosen={{@chosen}}',
          templateFile: '',
          conflictResolution: 'overwrite',
          createFileMode: 'singleFile',
          batchFilePaths: [],
          folderPath: '',
          batchFolderPaths: [],
        },
      ],
      actionGroups: [],
      actionTriggers: [],
    }, { app });
    const output = await read(outputPath);
    if (!output.includes('chosen=Beta')) {
      throw new Error('suggest modal output mismatch');
    }
    return { output };
  },
});

await safe({
  caseId: 'FACT-009',
  module: 'Form.Actions',
  feature: 'generateForm action',
  entry: 'formService.submit + test hook generateForm response',
  expected: 'generateForm 可通过测试钩子自动提交子表单并向后续动作传值',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearResponses();
    hook.enqueueResponse('generateForm', {
      ChildTitle: 'child-manual',
      ChildToggle: false,
    });
    const outputPath = notesBase + '/results/generate-form-output.md';
    await removeIfExists(outputPath);
    await formService.submit({}, {
      id: 'generate-form-suite',
      fields: [],
      actions: [
        {
          id: 'generate-form',
          type: 'generateForm',
          fields: [
            { id: 'child-title', label: 'ChildTitle', type: 'text', defaultValue: 'child-default' },
            { id: 'child-toggle', label: 'ChildToggle', type: 'toggle', defaultValue: true },
          ],
        },
        {
          id: 'persist-generated',
          type: 'createFile',
          filePath: outputPath,
          openPageIn: 'none',
          contentTemplateSource: 'text',
          content: 'child={{@ChildTitle}}\\ntoggle={{@ChildToggle}}',
          templateFile: '',
          conflictResolution: 'overwrite',
          createFileMode: 'singleFile',
          batchFilePaths: [],
          folderPath: '',
          batchFolderPaths: [],
        },
      ],
      actionGroups: [],
      actionTriggers: [],
    }, { app });
    const output = await read(outputPath);
    if (!output.includes('child=child-manual')) {
      throw new Error('generateForm output mismatch');
    }
    return { output };
  },
});

await safe({
  caseId: 'FACT-010',
  module: 'Form.Actions',
  feature: 'text action branches',
  entry: 'formService.submit + test hook confirm/clipboard/export responses',
  expected: 'text action 的 operation/cleanup 主要分支都能稳定执行并产出结果',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearArtifacts();
    hook.clearResponses();
    hook.enqueueResponse('exportHtmlFolder', '${vaultRoot.replaceAll("\\", "\\\\")}/System/formify-tests/${ctx.runId}/fixtures/notes/html-export');
    const textLeaf = app.workspace.getLeaf(true);
    await textLeaf.openFile(getFile(notesBase + '/text-source.md'));
    await sleep(300);
    await formService.submit({}, {
      id: 'text-operation-suite',
      fields: [],
      actions: [
        { id: 'copy-rich', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_RICH_TEXT', targetMode: 'current', targetFiles: [] } },
        { id: 'copy-markdown', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_MARKDOWN', targetMode: 'current', targetFiles: [] } },
        { id: 'export-html', type: 'text', mode: 'operation', textOperationConfig: { type: 'EXPORT_HTML', targetMode: 'current', targetFiles: [] } },
        { id: 'copy-plain', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_PLAIN_TEXT', targetMode: 'current', targetFiles: [] } },
        { id: 'add-spaces', type: 'text', mode: 'operation', textOperationConfig: { type: 'ADD_SPACES_BETWEEN_CJK_AND_ENGLISH', targetMode: 'current', targetFiles: [] } },
      ],
      actionGroups: [],
      actionTriggers: [],
    }, { app });
    const operationArtifacts = hook.getArtifacts('text-operation');
    const textSourceAfter = await read(notesBase + '/text-source.md');
    if ((operationArtifacts?.length ?? 0) < 4) {
      throw new Error('text operation artifacts were not fully recorded');
    }
    if (!textSourceAfter.includes('中文 English')) {
      throw new Error('add spaces operation did not rewrite active file');
    }

    await app.vault.adapter.write(notesBase + '/text-delete-heading.md', '# Heading A\\nA1\\n## Child\\nA2\\n# Heading B\\nB1\\n');
    hook.enqueueResponse('confirm', true);
    hook.enqueueResponse('confirm', true);
    hook.enqueueResponse('confirm', true);
    hook.enqueueResponse('confirm', true);
    hook.enqueueResponse('confirm', true);
    await formService.submit({}, {
      id: 'text-cleanup-suite',
      fields: [],
      actions: [
        {
          id: 'clear-format',
          type: 'text',
          mode: 'cleanup',
          textCleanupConfig: {
            type: 'clearFormat',
            clearFormatConfig: {
              targetMode: 'specified',
              targetFiles: [notesBase + '/text-clear-format.md'],
              clearAll: true,
              needConfirm: true,
            },
          },
        },
        {
          id: 'delete-content-frontmatter',
          type: 'text',
          mode: 'cleanup',
          textCleanupConfig: {
            type: 'deleteContent',
            deleteContentConfig: {
              targetMode: 'specified',
              targetFiles: [notesBase + '/text-delete-content.md'],
              contentDeleteType: 'entireContent',
              contentDeleteRange: 'bodyOnly',
              needConfirm: true,
            },
          },
        },
        {
          id: 'delete-heading-content',
          type: 'text',
          mode: 'cleanup',
          textCleanupConfig: {
            type: 'deleteContent',
            deleteContentConfig: {
              targetMode: 'specified',
              targetFiles: [notesBase + '/text-delete-heading.md'],
              contentDeleteType: 'headingContent',
              headingTitle: 'Heading A',
              headingContentDeleteRange: 'toSameOrHigher',
              needConfirm: true,
            },
          },
        },
        {
          id: 'move-file',
          type: 'text',
          mode: 'cleanup',
          textCleanupConfig: {
            type: 'moveFile',
            moveFileConfig: {
              targetMode: 'specified',
              targetPaths: [notesBase + '/text-move-file.md'],
              moveType: 'file',
              destinationFolderPath: notesBase + '/move-destination',
              conflictResolution: 'overwrite',
              needConfirm: true,
            },
          },
        },
        {
          id: 'delete-file',
          type: 'text',
          mode: 'cleanup',
          textCleanupConfig: {
            type: 'deleteFile',
            deleteFileConfig: {
              targetMode: 'specified',
              targetPaths: [notesBase + '/text-delete-file.md'],
              deleteType: 'file',
              needConfirm: true,
            },
          },
        },
      ],
      actionGroups: [],
      actionTriggers: [],
    }, { app });
    const clearFormatOutput = await read(notesBase + '/text-clear-format.md');
    const deleteContentOutput = await read(notesBase + '/text-delete-content.md');
    const deleteHeadingOutput = await read(notesBase + '/text-delete-heading.md');
    const movedExists = await exists(notesBase + '/move-destination/text-move-file.md');
    const deletedExists = await exists(notesBase + '/text-delete-file.md');
    if (clearFormatOutput.includes('**') || clearFormatOutput.includes('- ')) {
      throw new Error('clear format cleanup did not normalize markdown');
    }
    if (!deleteContentOutput.startsWith('---')) {
      throw new Error('delete content bodyOnly should keep frontmatter');
    }
    if (deleteHeadingOutput.includes('A1') || deleteHeadingOutput.includes('## Child')) {
      throw new Error('heading content cleanup did not remove heading body');
    }
    if (!movedExists) {
      throw new Error('move file cleanup did not move target');
    }
    if (deletedExists) {
      throw new Error('delete file cleanup did not remove target');
    }
    return {
      operationArtifacts,
      textSourceAfter,
      clearFormatOutput,
      deleteContentOutput,
      deleteHeadingOutput,
      movedExists,
      deletedExists,
    };
  },
});

await safe({
  caseId: 'FSTA-003',
  module: 'Startup',
  feature: 'startup condition detailed categories',
  entry: 'window.__formifyTestHooks.evaluateStartupConditions',
  expected: '时间、文件、系统、脚本四类启动条件子类型可逐项评估',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const referencePath = notesBase + '/startup-reference.md';
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(getFile(referencePath));
    await sleep(200);
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const today = now.toISOString().slice(0, 10);
    const currentDay = now.getDay();
    const markdownLeaves = app.workspace.getLeavesOfType('markdown').length;
    const layoutType = markdownLeaves > 1 ? 'split' : 'single';

    const checks = {
      timeRange: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'time-range', type: 'time', relation: 'and', enabled: true, config: { subType: 'time_range', startTime: hour + ':' + minute, endTime: hour + ':' + minute } }],
        },
      }),
      dayOfWeek: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'day-of-week', type: 'time', relation: 'and', enabled: true, config: { subType: 'day_of_week', daysOfWeek: [currentDay] } }],
        },
      }),
      dateRange: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'date-range', type: 'time', relation: 'and', enabled: true, config: { subType: 'date_range', startDate: today, endDate: today } }],
        },
      }),
      lastExecution: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'last-execution', type: 'time', relation: 'and', enabled: true, config: { subType: 'last_execution_interval', intervalMinutes: 1 } }],
        },
        context: {
          lastExecutionTime: Date.now() - 2 * 60 * 1000,
        },
      }),
      fileExists: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'file-exists', type: 'file', relation: 'and', enabled: true, config: { subType: 'file_exists', targetMode: 'specific_file', targetFilePath: referencePath } }],
        },
      }),
      fileStatus: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'file-status', type: 'file', relation: 'and', enabled: true, config: { subType: 'file_status', targetMode: 'specific_file', targetFilePath: referencePath, fileStatusChecks: ['is_open', 'is_active'] } }],
        },
        context: {
          currentFilePath: referencePath,
        },
      }),
      contentContains: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'content', type: 'file', relation: 'and', enabled: true, config: { subType: 'content_contains', targetMode: 'specific_file', targetFilePath: referencePath, searchText: 'Startup Reference' } }],
        },
      }),
      frontmatterProperty: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'frontmatter', type: 'file', relation: 'and', enabled: true, config: { subType: 'frontmatter_property', targetMode: 'specific_file', targetFilePath: referencePath, propertyName: 'status', propertyValue: 'ready', operator: 'equals' } }],
        },
      }),
      pluginVersion: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'plugin-version', type: 'system', relation: 'and', enabled: true, config: { subType: 'plugin_version', version: '0.0.1', operator: 'greater_than_or_equal' } }],
        },
      }),
      obsidianVersion: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'obsidian-version', type: 'system', relation: 'and', enabled: true, config: { subType: 'obsidian_version', version: '1.0.0', operator: 'greater_than_or_equal' } }],
        },
      }),
      workspaceLayout: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'workspace-layout', type: 'system', relation: 'and', enabled: true, config: { subType: 'workspace_layout', layoutType } }],
        },
      }),
      script: await hook.evaluateStartupConditions({
        config: {
          enabled: true,
          relation: 'and',
          conditions: [{ id: 'script-cond', type: 'script', relation: 'and', enabled: true, config: { expression: "return !!currentFile && currentFile.path.includes('startup-reference');" } }],
        },
        context: {
          currentFilePath: referencePath,
        },
      }),
    };

    const failedKey = Object.entries(checks).find(([, value]) => !value?.result?.satisfied)?.[0];
    if (failedKey) {
      throw new Error('startup condition check failed: ' + failedKey);
    }
    return checks;
  },
});

await safe({
  caseId: 'FSTA-001',
  module: 'Startup',
  feature: 'startup execution and auto-trigger',
  entry: 'window.__formifyTestHooks.executeStartupForms',
  expected: '启动表单与 auto-trigger 监控都能真正执行动作并落盘',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const startupOutput = notesBase + '/results/startup-output.md';
    const autoTriggerOutput = notesBase + '/results/auto-trigger-output.md';
    await removeIfExists(startupOutput);
    await removeIfExists(autoTriggerOutput);
    const monitoredBefore = {
      forms: (autoTriggerService?.monitoredForms?.size) ?? ((autoTriggerService)?.monitoredForms ? autoTriggerService.monitoredForms.size : null),
      triggers: (autoTriggerService?.monitoredTriggers?.size) ?? ((autoTriggerService)?.monitoredTriggers ? autoTriggerService.monitoredTriggers.size : null),
    };
    const execution = await hook.executeStartupForms({
      resetExecutionFlag: true,
      runAutoTriggerEvaluation: true,
    });
    await sleep(300);
    if (!(await exists(startupOutput))) {
      throw new Error('startup form did not write expected output');
    }
    if (!(await exists(autoTriggerOutput))) {
      throw new Error('auto-trigger evaluation did not write expected output');
    }
    return {
      execution,
      monitoredBefore,
      startupOutput: await read(startupOutput),
      autoTriggerOutput: await read(autoTriggerOutput),
    };
  },
});

await safe({
  caseId: 'CHAT-004',
  module: 'Chat',
  feature: 'multi entry points',
  entry: 'chat open commands',
  expected: 'sidebar/left-sidebar/tab/window/persistent-modal 入口都能触发对应打开逻辑',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearEvents();
    await plugin.replaceSettings({ chat: { openMode: 'tab' } });
    await app.commands.executeCommandById('formify:form-chat-open-sidebar');
    await sleep(400);
    await app.commands.executeCommandById('formify:form-chat-open-left-sidebar');
    await sleep(400);
    await app.commands.executeCommandById('formify:form-chat-open-tab');
    await sleep(400);
    await app.commands.executeCommandById('formify:form-chat-open-window');
    await sleep(400);
    await app.commands.executeCommandById('formify:form-chat-open-persistent-modal');
    await sleep(500);
    const beforeSessionId = hook.getChatState().activeSession?.id;
    await app.commands.executeCommandById('formify:form-chat-new-conversation');
    await sleep(200);
    const afterSessionId = hook.getChatState().activeSession?.id;
    await app.commands.executeCommandById('formify:form-chat-save-conversation');
    await sleep(400);
    await app.commands.executeCommandById('formify:form-chat-open-history');
    await sleep(200);
    const ui = hook.getUiSnapshot();
    const modes = hook.getEvents('chat-view-activate-requested').map((item) => item.payload?.mode);
    const persistentClose = document.querySelector('.chat-persistent-modal-close-btn');
    if (persistentClose instanceof HTMLElement) {
      persistentClose.click();
      await sleep(200);
    }
    if (!modes.includes('sidebar') || !modes.includes('left-sidebar') || !modes.includes('tab') || !modes.includes('window')) {
      throw new Error('one or more chat entry commands did not emit activation event');
    }
    if (!ui.persistentChatModal) {
      throw new Error('persistent chat modal did not open');
    }
    if (!ui.chatSidebarLeaves && !ui.chatTabLeaves) {
      throw new Error('chat views were not attached to workspace');
    }
    if (beforeSessionId === afterSessionId) {
      throw new Error('new conversation command did not create a new session');
    }
    return { modes, ui, beforeSessionId, afterSessionId };
  },
});

await safe({
  caseId: 'CHAT-005',
  module: 'Chat',
  feature: 'context add remove and internal link parsing',
  entry: 'window.__formifyTestHooks chat helpers',
  expected: '文件/文件夹/图片上下文增删和内链解析都能生效',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.chatCreateNewSession('supplemental-context');
    hook.chatAddSelectedFile(notesBase + '/active-note.md');
    hook.chatAddSelectedFolder(notesBase + '/files');
    hook.chatAddSelectedImages(['sample-a.png', 'sample-b.png']);
    hook.chatAddActiveFile(notesBase + '/active-note.md');
    hook.chatRemoveSelectedImage('sample-a.png');
    hook.chatRemoveSelectedFile(notesBase + '/active-note.md', true);
    hook.chatAddActiveFile(notesBase + '/active-note.md');
    const stateAfterManualRemoval = hook.getChatState();
    hook.chatAddSelectedFile(notesBase + '/active-note.md');
    const state = hook.getChatState();
    const providerMessages = await hook.chatBuildProviderMessages({
      messages: [
        { id: 'user-1', role: 'user', content: 'Summarize linked context', timestamp: Date.now() },
      ],
    });
    const payload = JSON.stringify(providerMessages);
    if (!payload.includes('LINK_TARGET_MARKER')) {
      throw new Error('internal link content marker was not resolved into provider messages');
    }
    if ((state.selectedImages?.length ?? 0) !== 1) {
      throw new Error('selected image add/remove state mismatch');
    }
    if (!(state.selectedFolders?.length > 0)) {
      throw new Error('selected folder state mismatch');
    }
    return { stateAfterManualRemoval, state, providerMessages };
  },
});

await safe({
  caseId: 'SP-002',
  module: 'SystemPrompts',
  feature: 'CRUD and feature exclusion',
  entry: 'window.__formifyTestHooks system prompt helpers',
  expected: '系统提示词可新增/改写/重排/删除，并保留 excludeFeatures',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    const id = 'supplemental-system-prompt-' + runId;
    await hook.upsertSystemPrompt({
      id,
      name: 'Supplemental Prompt',
      sourceType: 'custom',
      content: 'System prompt content',
      enabled: true,
      excludeFeatures: ['selection_toolbar'],
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    let prompts = await hook.listSystemPrompts();
    const inserted = prompts.find((item) => item.id === id);
    if (!inserted || !(inserted.excludeFeatures ?? []).includes('selection_toolbar')) {
      throw new Error('system prompt excludeFeatures was not persisted');
    }
    await hook.reorderSystemPrompts(prompts.map((item) => item.id).reverse());
    prompts = await hook.upsertSystemPrompt({
      ...inserted,
      content: 'System prompt updated',
      enabled: false,
      updatedAt: Date.now(),
    });
    const updated = prompts.find((item) => item.id === id);
    if (!updated || updated.enabled !== false || updated.content !== 'System prompt updated') {
      throw new Error('system prompt update mismatch');
    }
    const afterDelete = await hook.deleteSystemPrompt(id);
    if (afterDelete.some((item) => item.id === id)) {
      throw new Error('system prompt delete mismatch');
    }
    return { inserted, updated, afterDeleteCount: afterDelete.length };
  },
});

await safe({
  caseId: 'QA-003',
  module: 'QuickActions',
  feature: 'multi-level nesting and toolbar limits',
  entry: 'window.__formifyTestHooks quick action helpers',
  expected: '快捷操作支持最多 3 层嵌套，超出时报错，showInToolbar 状态可更新',
  evidencePath: runDir + '/logs/supplemental-results.json',
  partial: true,
  untestedReason: '结果弹窗与流式 UI 仍未纳入本轮自动化',
  fn: async () => {
    const baseTime = Date.now();
    const group1 = { id: 'qa-group-1-' + runId, name: 'QA Group 1', prompt: '', promptSource: 'custom', showInToolbar: true, order: 0, createdAt: baseTime, updatedAt: baseTime, actionType: 'group', isActionGroup: true, children: [] };
    const group2 = { id: 'qa-group-2-' + runId, name: 'QA Group 2', prompt: '', promptSource: 'custom', showInToolbar: true, order: 1, createdAt: baseTime + 1, updatedAt: baseTime + 1, actionType: 'group', isActionGroup: true, children: [] };
    const group3 = { id: 'qa-group-3-' + runId, name: 'QA Group 3', prompt: '', promptSource: 'custom', showInToolbar: true, order: 2, createdAt: baseTime + 2, updatedAt: baseTime + 2, actionType: 'group', isActionGroup: true, children: [] };
    const leaf = { id: 'qa-leaf-' + runId, name: 'QA Leaf', prompt: 'leaf', promptSource: 'custom', showInToolbar: true, order: 3, createdAt: baseTime + 3, updatedAt: baseTime + 3, actionType: 'normal', isActionGroup: false, children: [] };
    await hook.saveQuickAction(group1);
    await hook.saveQuickAction(group2);
    await hook.saveQuickAction(group3);
    await hook.saveQuickAction(leaf);
    await hook.moveQuickActionToGroup(group2.id, group1.id);
    await hook.moveQuickActionToGroup(group3.id, group2.id);
    const level = await hook.getQuickActionNestingLevel(group3.id);
    let nestingError = null;
    try {
      await hook.moveQuickActionToGroup(leaf.id, group3.id);
    } catch (error) {
      nestingError = error instanceof Error ? error.message : String(error);
    }
    await hook.updateQuickActionShowInToolbar(group1.id, false);
    const updated = await hook.listQuickActions();
    await hook.deleteQuickAction(group1.id);
    await hook.deleteQuickAction(group2.id);
    await hook.deleteQuickAction(group3.id);
    await hook.deleteQuickAction(leaf.id);
    if (level !== 2) {
      throw new Error('quick action nesting level mismatch');
    }
    if (!String(nestingError ?? '').includes('最多支持 3 层嵌套')) {
      throw new Error('quick action nesting limit error was not raised');
    }
    if (updated.find((item) => item.id === group1.id)?.showInToolbar !== false) {
      throw new Error('quick action toolbar visibility update failed');
    }
    return { level, nestingError };
  },
});

await safe({
  caseId: 'EXP-005',
  module: 'FileExpiry',
  feature: 'popup batch delete move and open file',
  entry: 'ExpiryNoticePopup DOM + test hooks',
  expected: '过期文件弹窗可打开文件、批量移动、批量删除',
  evidencePath: runDir + '/logs/supplemental-results.json',
  fn: async () => {
    hook.clearEvents();
    hook.showExpiryNotice([{ path: notesBase + '/expiry-open.md', daysExpired: 7 }]);
    await sleep(300);
    const getByTestId = (testId) => {
      const element = Array.from(document.querySelectorAll('[data-testid]')).find((item) => item.getAttribute('data-testid') === testId);
      if (!(element instanceof HTMLElement)) {
        throw new Error('testid-not-found:' + testId);
      }
      return element;
    };
    getByTestId('formify-expiry-open-' + notesBase + '/expiry-open.md').click();
    await sleep(300);
    const openedPath = app.workspace.getActiveFile()?.path ?? null;
    if (openedPath !== notesBase + '/expiry-open.md') {
      throw new Error('expiry popup open-file action did not activate target note');
    }
    getByTestId('formify-expiry-close').click();
    await sleep(200);

    hook.enqueueResponse('folderPicker', notesBase + '/move-destination');
    hook.showExpiryNotice([{ path: notesBase + '/expiry-move.md', daysExpired: 9 }]);
    await sleep(300);
    getByTestId('formify-expiry-checkbox-' + notesBase + '/expiry-move.md').click();
    getByTestId('formify-expiry-move-selected').click();
    await sleep(500);
    const movedExists = await exists(notesBase + '/move-destination/expiry-move.md');
    if (!movedExists) {
      throw new Error('expiry popup move action did not move target file');
    }
    getByTestId('formify-expiry-close').click();
    await sleep(200);

    hook.showExpiryNotice([{ path: notesBase + '/expiry-delete.md', daysExpired: 11 }]);
    await sleep(300);
    getByTestId('formify-expiry-checkbox-' + notesBase + '/expiry-delete.md').click();
    getByTestId('formify-expiry-delete-selected').click();
    await sleep(500);
    const deletedExists = await exists(notesBase + '/expiry-delete.md');
    if (deletedExists) {
      throw new Error('expiry popup delete action did not delete target file');
    }
    return {
      openedPath,
      movedExists,
      deletedExists,
      events: hook.getEvents(),
    };
  },
});

return {
  ok: true,
  resultCount: results.length,
  results,
};
`, {
		timeoutMs: 240000,
	});

	let liveRows = [];
	for (let attempt = 0; attempt < 20; attempt += 1) {
		liveRows = await readJson(path.join(ctx.logsDir, "supplemental-live-results.json"), []);
		if (Array.isArray(liveRows) && liveRows.length >= 16) {
			break;
		}
		await sleep(250);
	}
	const initialRows =
		Array.isArray(result?.results) && result.results.length > 0
			? result.results
			: Array.isArray(liveRows)
				? liveRows
				: [];
	await writeJson(path.join(ctx.logsDir, "supplemental-results.json"), initialRows);
	await writeText(path.join(ctx.logsDir, "supplemental-summary.json"), JSON.stringify(result ?? null, null, 2));

	const upsertRows = async (rows) => {
		const current = await readJson(path.join(ctx.logsDir, "supplemental-results.json"), []);
		const byCaseId = new Map(current.map((row) => [row.caseId, row]));
		for (const row of rows) {
			byCaseId.set(row.caseId, row);
		}
		await writeJson(path.join(ctx.logsDir, "supplemental-results.json"), Array.from(byCaseId.values()));
	};

	const runExtraCase = async (meta, body, timeoutMs = 120000) => {
		let row;
		try {
			const actual = await obsidianEvalJson(body, { timeoutMs });
			row = {
				caseId: meta.caseId,
				module: meta.module,
				feature: meta.feature,
				entry: meta.entry,
				expected: meta.expected,
				actual,
				status: meta.partial ? "PARTIAL" : "PASS",
				evidencePath: meta.evidencePath,
				untestedReason: meta.untestedReason ?? "",
			};
		} catch (error) {
			row = {
				caseId: meta.caseId,
				module: meta.module,
				feature: meta.feature,
				entry: meta.entry,
				expected: meta.expected,
				actual: {
					error: error instanceof Error ? error.message : String(error),
				},
				status: "FAIL",
				evidencePath: meta.evidencePath,
				untestedReason: meta.untestedReason ?? "",
			};
		}
		await upsertRows([row]);
		return row;
	};

	const evidencePath = `${ctx.runDir}/logs/supplemental-results.json`;

	await runExtraCase(
		{
			caseId: "FACT-001",
			module: "Form.Actions",
			feature: "collectData dependency analysis inside loop action groups",
			entry: "formService.submit + loop/collectData regression case",
			expected: "循环动作组中的 collectData 输出变量可被后续动作正确识别并落盘",
			evidencePath,
		},
		`
const formService = app.plugins.plugins.formify.services.formService;
const outputPath = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/collect-data-loop-output.md';
if (await app.vault.adapter.exists(outputPath)) {
  await app.vault.adapter.remove(outputPath);
}
await formService.submit({}, {
  id: 'collect-data-loop-suite',
  fields: [],
  actions: [
    {
      id: 'loop-collect',
      type: 'loop',
      loopType: 'count',
      countStart: 1,
      countEnd: 3,
      countStep: 1,
      actionGroupId: 'collect-group',
      itemVariableName: 'item',
      indexVariableName: 'index',
      totalVariableName: 'total',
      maxIterations: 10,
      errorHandlingStrategy: 'stop',
    },
    {
      id: 'persist-collected',
      type: 'createFile',
      filePath: outputPath,
      openPageIn: 'none',
      contentTemplateSource: 'text',
      content: 'items={{@CollectedItems}}',
      templateFile: '',
      conflictResolution: 'overwrite',
      createFileMode: 'singleFile',
      batchFilePaths: [],
      folderPath: '',
      batchFolderPaths: [],
    },
  ],
  actionGroups: [
    {
      id: 'collect-group',
      actions: [
        {
          id: 'collect-item',
          type: 'collectData',
          outputVariableName: 'CollectedItems',
          content: '{{@item}}',
          storageMode: 'append',
          variableType: 'string',
        },
      ],
    },
  ],
  actionTriggers: [],
}, { app });
const output = await app.vault.adapter.read(outputPath);
if (!output.includes('items=1') || !output.includes('\\n2') || !output.includes('\\n3')) {
  throw new Error('collectData loop output mismatch');
}
return { output };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FCORE-003",
			module: "Form.Core",
			feature: "falsey form values should not fall back to defaults",
			entry: "formService.submit false/0/empty-string regression case",
			expected: "false、0、空字符串在提交时应保持用户值，不应回退为默认值",
			evidencePath,
		},
		`
const formService = app.plugins.plugins.formify.services.formService;
const outputPath = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/falsey-values-output.md';
if (await app.vault.adapter.exists(outputPath)) {
  await app.vault.adapter.remove(outputPath);
}
await formService.submit({
  toggleField: false,
  zeroField: 0,
  emptyField: '',
}, {
  id: 'falsey-values-suite',
  fields: [
    { id: 'toggleField', label: 'ToggleField', type: 'toggle', defaultValue: true },
    { id: 'zeroField', label: 'ZeroField', type: 'number', defaultValue: 7 },
    { id: 'emptyField', label: 'EmptyField', type: 'text', defaultValue: 'fallback' },
  ],
  actions: [
    {
      id: 'persist-falsey-values',
      type: 'createFile',
      filePath: outputPath,
      openPageIn: 'none',
      contentTemplateSource: 'text',
      content: 'toggle={{@ToggleField}}\\nzero={{@ZeroField}}\\nempty={{@EmptyField}}',
      templateFile: '',
      conflictResolution: 'overwrite',
      createFileMode: 'singleFile',
      batchFilePaths: [],
      folderPath: '',
      batchFolderPaths: [],
    },
  ],
  actionGroups: [],
  actionTriggers: [],
}, { app });
const output = await app.vault.adapter.read(outputPath);
if (!output.includes('toggle=false')) {
  throw new Error('false toggle value fell back to default');
}
if (!output.includes('zero=0')) {
  throw new Error('zero numeric value fell back to default');
}
if (!output.includes('empty=')) {
  throw new Error('empty string output line missing');
}
if (output.includes('empty=fallback')) {
  throw new Error('empty string value fell back to default');
}
return { output };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FACT-008",
			module: "Form.Actions",
			feature: "suggestModal action",
			entry: "formService.submit + test hook suggestModal response",
			expected: "suggestModal 可通过测试钩子自动选择并把值写入后续动作",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const formService = app.plugins.plugins.formify.services.formService;
const outputPath = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/suggest-modal-output.md';
if (await app.vault.adapter.exists(outputPath)) {
  await app.vault.adapter.remove(outputPath);
}
hook.clearResponses();
hook.enqueueResponse('suggestModal', 'Beta');
await formService.submit({}, {
  id: 'suggest-modal-suite',
  fields: [],
  actions: [
    { id: 'suggest', type: 'suggestModal', fieldName: 'chosen', suggestSource: 'fixed', items: ['Alpha', 'Beta'] },
    { id: 'persist', type: 'createFile', filePath: outputPath, openPageIn: 'none', contentTemplateSource: 'text', content: 'chosen={{@chosen}}', templateFile: '', conflictResolution: 'overwrite', createFileMode: 'singleFile', batchFilePaths: [], folderPath: '', batchFolderPaths: [] },
  ],
  actionGroups: [],
  actionTriggers: [],
}, { app });
const output = await app.vault.adapter.read(outputPath);
if (!output.includes('chosen=Beta')) {
  throw new Error('suggest modal output mismatch');
}
return { output, events: hook.getEvents('suggest-modal-selected') };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FACT-009",
			module: "Form.Actions",
			feature: "generateForm action",
			entry: "formService.submit + test hook generateForm response",
			expected: "generateForm 可通过测试钩子自动提交子表单并向后续动作传值",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const formService = app.plugins.plugins.formify.services.formService;
const outputPath = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/generate-form-output.md';
if (await app.vault.adapter.exists(outputPath)) {
  await app.vault.adapter.remove(outputPath);
}
hook.clearResponses();
hook.enqueueResponse('generateForm', { ChildTitle: 'child-manual', ChildToggle: false });
await formService.submit({}, {
  id: 'generate-form-suite',
  fields: [],
  actions: [
    { id: 'generate-form', type: 'generateForm', fields: [{ id: 'child-title', label: 'ChildTitle', type: 'text', defaultValue: 'child-default' }, { id: 'child-toggle', label: 'ChildToggle', type: 'toggle', defaultValue: true }] },
    { id: 'persist', type: 'createFile', filePath: outputPath, openPageIn: 'none', contentTemplateSource: 'text', content: 'child={{@ChildTitle}}\\ntoggle={{@ChildToggle}}', templateFile: '', conflictResolution: 'overwrite', createFileMode: 'singleFile', batchFilePaths: [], folderPath: '', batchFolderPaths: [] },
  ],
  actionGroups: [],
  actionTriggers: [],
}, { app });
const output = await app.vault.adapter.read(outputPath);
if (!output.includes('child=child-manual')) {
  throw new Error('generateForm output mismatch');
}
return { output, events: hook.getEvents('generate-form-auto-submitted') };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FACT-010",
			module: "Form.Actions",
			feature: "text action branches",
			entry: "formService.submit + test hook confirm/clipboard/export responses",
			expected: "text action 的 operation/cleanup 主要分支都能稳定执行并产出结果",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const formService = app.plugins.plugins.formify.services.formService;
const notesBase = 'System/formify-tests/${ctx.runId}/fixtures/notes';
const exportBase = '${vaultRoot.replaceAll("\\", "\\\\")}/System/formify-tests/${ctx.runId}/fixtures/notes/html-export';
const textLeaf = app.workspace.getLeaf(true);
await textLeaf.openFile(app.vault.getFileByPath(notesBase + '/text-source.md'));
await new Promise((resolve) => setTimeout(resolve, 300));
hook.clearArtifacts();
hook.clearResponses();
hook.enqueueResponse('exportHtmlFolder', exportBase);
await formService.submit({}, {
  id: 'text-operation-suite',
  fields: [],
  actions: [
    { id: 'copy-rich', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_RICH_TEXT', targetMode: 'current', targetFiles: [] } },
    { id: 'copy-markdown', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_MARKDOWN', targetMode: 'current', targetFiles: [] } },
    { id: 'export-html', type: 'text', mode: 'operation', textOperationConfig: { type: 'EXPORT_HTML', targetMode: 'current', targetFiles: [] } },
    { id: 'copy-plain', type: 'text', mode: 'operation', textOperationConfig: { type: 'COPY_PLAIN_TEXT', targetMode: 'current', targetFiles: [] } },
    { id: 'add-spaces', type: 'text', mode: 'operation', textOperationConfig: { type: 'ADD_SPACES_BETWEEN_CJK_AND_ENGLISH', targetMode: 'current', targetFiles: [] } },
  ],
  actionGroups: [],
  actionTriggers: [],
}, { app });
await app.vault.adapter.write(notesBase + '/text-delete-heading.md', '# Heading A\\nA1\\n## Child\\nA2\\n# Heading B\\nB1\\n');
hook.enqueueResponse('confirm', true);
hook.enqueueResponse('confirm', true);
hook.enqueueResponse('confirm', true);
hook.enqueueResponse('confirm', true);
hook.enqueueResponse('confirm', true);
await formService.submit({}, {
  id: 'text-cleanup-suite',
  fields: [],
  actions: [
    { id: 'clear-format', type: 'text', mode: 'cleanup', textCleanupConfig: { type: 'clearFormat', clearFormatConfig: { targetMode: 'specified', targetFiles: [notesBase + '/text-clear-format.md'], clearAll: true, needConfirm: true } } },
    { id: 'delete-content-frontmatter', type: 'text', mode: 'cleanup', textCleanupConfig: { type: 'deleteContent', deleteContentConfig: { targetMode: 'specified', targetFiles: [notesBase + '/text-delete-content.md'], contentDeleteType: 'entireContent', contentDeleteRange: 'bodyOnly', needConfirm: true } } },
    { id: 'delete-heading-content', type: 'text', mode: 'cleanup', textCleanupConfig: { type: 'deleteContent', deleteContentConfig: { targetMode: 'specified', targetFiles: [notesBase + '/text-delete-heading.md'], contentDeleteType: 'headingContent', headingTitle: 'Heading A', headingContentDeleteRange: 'toSameOrHigher', needConfirm: true } } },
    { id: 'move-file', type: 'text', mode: 'cleanup', textCleanupConfig: { type: 'moveFile', moveFileConfig: { targetMode: 'specified', targetPaths: [notesBase + '/text-move-file.md'], moveType: 'file', destinationFolderPath: notesBase + '/move-destination', conflictResolution: 'overwrite', needConfirm: true } } },
    { id: 'delete-file', type: 'text', mode: 'cleanup', textCleanupConfig: { type: 'deleteFile', deleteFileConfig: { targetMode: 'specified', targetPaths: [notesBase + '/text-delete-file.md'], deleteType: 'file', needConfirm: true } } },
  ],
  actionGroups: [],
  actionTriggers: [],
}, { app });
const operationArtifacts = hook.getArtifacts('text-operation');
const textSourceAfter = await app.vault.adapter.read(notesBase + '/text-source.md');
const clearFormatOutput = await app.vault.adapter.read(notesBase + '/text-clear-format.md');
const deleteContentOutput = await app.vault.adapter.read(notesBase + '/text-delete-content.md');
const deleteHeadingOutput = await app.vault.adapter.read(notesBase + '/text-delete-heading.md');
const movedExists = await app.vault.adapter.exists(notesBase + '/move-destination/text-move-file.md');
const deletedExists = await app.vault.adapter.exists(notesBase + '/text-delete-file.md');
if ((operationArtifacts?.length ?? 0) < 4) throw new Error('text operation artifacts were not fully recorded');
if (!textSourceAfter.includes('中文 English')) throw new Error('add spaces operation did not rewrite active file');
if (clearFormatOutput.includes('**') || clearFormatOutput.includes('- ')) throw new Error('clear format cleanup did not normalize markdown');
if (!deleteContentOutput.startsWith('---')) throw new Error('delete content bodyOnly should keep frontmatter');
if (deleteHeadingOutput.includes('A1') || deleteHeadingOutput.includes('## Child')) throw new Error('heading content cleanup did not remove heading body');
if (!movedExists) throw new Error('move file cleanup did not move target');
if (deletedExists) throw new Error('delete file cleanup did not remove target');
return { operationArtifacts, textSourceAfter, clearFormatOutput, deleteContentOutput, deleteHeadingOutput, movedExists, deletedExists };
`,
		180000
	);

	await runExtraCase(
		{
			caseId: "FSTA-002",
			module: "Startup",
			feature: "submitDirectly plugin version startup condition",
			entry: "formService.open runtime .cform with plugin_version condition",
			expected: "plugin_version 启动条件在无界面直接执行路径下应读取到 formify 的真实版本",
			evidencePath,
		},
		`
const formService = app.plugins.plugins.formify.services.formService;
const formsBase = 'System/formify-tests/${ctx.runId}/fixtures/forms';
const outputPath = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/startup-plugin-version-output.md';
const formPath = formsBase + '/runtime-plugin-version-form.cform';
const upsertJsonFile = async (filePath, value) => {
  const content = JSON.stringify(value, null, 2);
  const existing = app.vault.getFileByPath(filePath);
  if (existing) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(filePath, content);
};
if (await app.vault.adapter.exists(outputPath)) {
  await app.vault.adapter.remove(outputPath);
}
const file = await upsertJsonFile(formPath, {
  id: 'runtime-plugin-version-form',
  fields: [],
  actions: [
    {
      id: 'persist-plugin-version-check',
      type: 'createFile',
      filePath: outputPath,
      openPageIn: 'none',
      contentTemplateSource: 'text',
      content: 'plugin-version=ok',
      templateFile: '',
      conflictResolution: 'overwrite',
      createFileMode: 'singleFile',
      batchFilePaths: [],
      folderPath: '',
      batchFolderPaths: [],
    },
  ],
  actionGroups: [],
  actionTriggers: [],
  showSubmitSuccessToast: false,
  enableExecutionTimeout: false,
  executionTimeoutThreshold: 30,
  commandEnabled: false,
  contextMenuEnabled: false,
  runOnStartup: false,
  startupConditions: {
    enabled: true,
    relation: 'and',
    conditions: [
      {
        id: 'plugin-version-condition',
        type: 'system',
        relation: 'and',
        enabled: true,
        config: {
          subType: 'plugin_version',
          version: '0.0.1',
          operator: 'greater_than_or_equal',
        },
      },
    ],
  },
});
await formService.open(file, app);
await new Promise((resolve) => setTimeout(resolve, 400));
if (!(await app.vault.adapter.exists(outputPath))) {
  throw new Error('plugin version gated direct submit did not execute');
}
return { output: await app.vault.adapter.read(outputPath) };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FSTA-003",
			module: "Startup",
			feature: "startup condition detailed categories",
			entry: "window.__formifyTestHooks.evaluateStartupConditions",
			expected: "时间、文件、系统、脚本四类启动条件子类型可逐项评估",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const referencePath = 'System/formify-tests/${ctx.runId}/fixtures/notes/startup-reference.md';
const leaf = app.workspace.getLeaf(true);
await leaf.openFile(app.vault.getFileByPath(referencePath));
await new Promise((resolve) => setTimeout(resolve, 200));
const now = new Date();
const hour = String(now.getHours()).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');
const today = now.toISOString().slice(0, 10);
const currentDay = now.getDay();
const layoutType = app.workspace.getLeavesOfType('markdown').length > 1 ? 'split' : 'single';
const checks = {
  timeRange: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'time-range', type: 'time', relation: 'and', enabled: true, config: { subType: 'time_range', startTime: hour + ':' + minute, endTime: hour + ':' + minute } }] } }),
  dayOfWeek: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'day', type: 'time', relation: 'and', enabled: true, config: { subType: 'day_of_week', daysOfWeek: [currentDay] } }] } }),
  dateRange: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'date-range', type: 'time', relation: 'and', enabled: true, config: { subType: 'date_range', startDate: today, endDate: today } }] } }),
  lastExecution: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'last-execution', type: 'time', relation: 'and', enabled: true, config: { subType: 'last_execution_interval', intervalMinutes: 1 } }] }, context: { lastExecutionTime: Date.now() - 2 * 60 * 1000 } }),
  fileExists: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'file-exists', type: 'file', relation: 'and', enabled: true, config: { subType: 'file_exists', targetMode: 'specific_file', targetFilePath: referencePath } }] } }),
  fileStatus: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'file-status', type: 'file', relation: 'and', enabled: true, config: { subType: 'file_status', targetMode: 'specific_file', targetFilePath: referencePath, fileStatusChecks: ['is_open', 'is_active'] } }] }, context: { currentFilePath: referencePath } }),
  contentContains: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'content', type: 'file', relation: 'and', enabled: true, config: { subType: 'content_contains', targetMode: 'specific_file', targetFilePath: referencePath, searchText: 'Startup Reference' } }] } }),
  frontmatterProperty: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'frontmatter', type: 'file', relation: 'and', enabled: true, config: { subType: 'frontmatter_property', targetMode: 'specific_file', targetFilePath: referencePath, propertyName: 'status', propertyValue: 'ready', operator: 'equals' } }] } }),
  pluginVersion: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'plugin', type: 'system', relation: 'and', enabled: true, config: { subType: 'plugin_version', version: '0.0.1', operator: 'greater_than_or_equal' } }] } }),
  obsidianVersion: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'obsidian', type: 'system', relation: 'and', enabled: true, config: { subType: 'obsidian_version', version: '1.0.0', operator: 'greater_than_or_equal' } }] } }),
  workspaceLayout: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'layout', type: 'system', relation: 'and', enabled: true, config: { subType: 'workspace_layout', layoutType } }] } }),
  script: await hook.evaluateStartupConditions({ config: { enabled: true, relation: 'and', conditions: [{ id: 'script', type: 'script', relation: 'and', enabled: true, config: { expression: "return !!currentFile && currentFile.path.includes('startup-reference');" } }] }, context: { currentFilePath: referencePath } }),
};
const failed = Object.entries(checks).find(([, value]) => !value?.result?.satisfied)?.[0];
if (failed) throw new Error('startup condition check failed: ' + failed);
return checks;
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "FSTA-001",
			module: "Startup",
			feature: "startup execution and auto-trigger",
			entry: "window.__formifyTestHooks.executeStartupForms",
			expected: "启动表单与 auto-trigger 监控都能真正执行动作并落盘",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const formsBase = 'System/formify-tests/${ctx.runId}/fixtures/forms';
const startupOutput = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/startup-output.md';
const autoTriggerOutput = 'System/formify-tests/${ctx.runId}/fixtures/notes/results/auto-trigger-output.md';
const startupFormPath = formsBase + '/runtime-startup-form.cform';
const autoTriggerFormPath = formsBase + '/runtime-auto-trigger-form.cform';
const upsertJsonFile = async (filePath, value) => {
  const content = JSON.stringify(value, null, 2);
  const existing = app.vault.getFileByPath(filePath);
  if (existing) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(filePath, content);
};
if (await app.vault.adapter.exists(startupOutput)) {
  await app.vault.adapter.remove(startupOutput);
}
if (await app.vault.adapter.exists(autoTriggerOutput)) {
  await app.vault.adapter.remove(autoTriggerOutput);
}
await upsertJsonFile(startupFormPath, {
  id: 'runtime-startup-form',
  fields: [],
  actions: [
    {
      id: 'runtime-startup-output',
      type: 'createFile',
      filePath: startupOutput,
      openPageIn: 'none',
      contentTemplateSource: 'text',
      content: 'startup=ok',
      templateFile: '',
      conflictResolution: 'overwrite',
      createFileMode: 'singleFile',
      batchFilePaths: [],
      folderPath: '',
      batchFolderPaths: [],
    },
  ],
  actionGroups: [],
  actionTriggers: [],
  showSubmitSuccessToast: false,
  enableExecutionTimeout: false,
  executionTimeoutThreshold: 30,
  commandEnabled: false,
  contextMenuEnabled: false,
  runOnStartup: true,
});
await upsertJsonFile(autoTriggerFormPath, {
  id: 'runtime-auto-trigger-form',
  fields: [],
  actions: [
    {
      id: 'runtime-auto-trigger-output',
      type: 'createFile',
      filePath: autoTriggerOutput,
      openPageIn: 'none',
      contentTemplateSource: 'text',
      content: 'auto-trigger=ok',
      templateFile: '',
      conflictResolution: 'overwrite',
      createFileMode: 'singleFile',
      batchFilePaths: [],
      folderPath: '',
      batchFolderPaths: [],
    },
  ],
  actionGroups: [],
  actionTriggers: [],
  showSubmitSuccessToast: false,
  enableExecutionTimeout: false,
  executionTimeoutThreshold: 30,
  commandEnabled: false,
  contextMenuEnabled: false,
  runOnStartup: false,
  startupConditions: {
    enabled: true,
    relation: 'and',
    conditions: [
      {
        id: 'runtime-auto-trigger-condition',
        type: 'script',
        category: 'autoTrigger',
        relation: 'and',
        enabled: true,
        config: {
          expression: 'return true;',
        },
      },
    ],
  },
});
const execution = await hook.executeStartupForms({ resetExecutionFlag: true, runAutoTriggerEvaluation: true });
await new Promise((resolve) => setTimeout(resolve, 400));
if (!(await app.vault.adapter.exists(startupOutput))) throw new Error('startup form did not write expected output');
if (!(await app.vault.adapter.exists(autoTriggerOutput))) throw new Error('auto-trigger evaluation did not write expected output');
return { execution, startupOutput: await app.vault.adapter.read(startupOutput), autoTriggerOutput: await app.vault.adapter.read(autoTriggerOutput) };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "CHAT-004",
			module: "Chat",
			feature: "multi entry points",
			entry: "chat open commands",
			expected: "sidebar/left-sidebar/tab/window/persistent-modal 入口都能触发对应打开逻辑",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const plugin = app.plugins.plugins.formify;
hook.clearEvents();
await plugin.replaceSettings({ chat: { openMode: 'tab' } });
await app.commands.executeCommandById('formify:form-chat-open-sidebar');
await new Promise((resolve) => setTimeout(resolve, 300));
await app.commands.executeCommandById('formify:form-chat-open-left-sidebar');
await new Promise((resolve) => setTimeout(resolve, 300));
await app.commands.executeCommandById('formify:form-chat-open-tab');
await new Promise((resolve) => setTimeout(resolve, 300));
await app.commands.executeCommandById('formify:form-chat-open-window');
await new Promise((resolve) => setTimeout(resolve, 300));
await app.commands.executeCommandById('formify:form-chat-open-persistent-modal');
await new Promise((resolve) => setTimeout(resolve, 400));
const beforeSessionId = hook.getChatState().activeSession?.id;
await app.commands.executeCommandById('formify:form-chat-new-conversation');
await new Promise((resolve) => setTimeout(resolve, 200));
const afterSessionId = hook.getChatState().activeSession?.id;
await app.commands.executeCommandById('formify:form-chat-save-conversation');
await new Promise((resolve) => setTimeout(resolve, 200));
await app.commands.executeCommandById('formify:form-chat-open-history');
await new Promise((resolve) => setTimeout(resolve, 200));
const modes = hook.getEvents('chat-view-activate-requested').map((item) => item.payload?.mode);
const snapshot = hook.getUiSnapshot();
document.querySelector('.chat-persistent-modal-close-btn')?.click();
if (!modes.includes('sidebar') || !modes.includes('left-sidebar') || !modes.includes('tab') || !modes.includes('window')) throw new Error('one or more chat entry commands did not emit activation event');
if (!snapshot.persistentChatModal) throw new Error('persistent chat modal did not open');
if (!snapshot.chatSidebarLeaves && !snapshot.chatTabLeaves) throw new Error('chat views were not attached to workspace');
if (beforeSessionId === afterSessionId) throw new Error('new conversation command did not create a new session');
return { modes, snapshot, beforeSessionId, afterSessionId };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "CHAT-005",
			module: "Chat",
			feature: "context add remove and internal link parsing",
			entry: "window.__formifyTestHooks chat helpers",
			expected: "文件/文件夹/图片上下文增删和内链解析都能生效",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const notesBase = 'System/formify-tests/${ctx.runId}/fixtures/notes';
hook.chatCreateNewSession('supplemental-context');
hook.chatAddSelectedFile(notesBase + '/active-note.md');
hook.chatAddSelectedFolder(notesBase + '/files');
hook.chatAddSelectedImages(['sample-a.png', 'sample-b.png']);
hook.chatAddActiveFile(notesBase + '/active-note.md');
hook.chatRemoveSelectedImage('sample-a.png');
hook.chatRemoveSelectedFile(notesBase + '/active-note.md', true);
hook.chatAddActiveFile(notesBase + '/active-note.md');
const stateAfterManualRemoval = hook.getChatState();
hook.chatAddSelectedFile(notesBase + '/active-note.md');
const state = hook.getChatState();
const providerMessages = await hook.chatBuildProviderMessages({ messages: [{ id: 'user-1', role: 'user', content: 'Summarize linked context', timestamp: Date.now() }] });
const payload = JSON.stringify(providerMessages);
if (!payload.includes('LINK_TARGET_MARKER')) throw new Error('internal link content marker was not resolved into provider messages');
if ((state.selectedImages?.length ?? 0) !== 1) throw new Error('selected image add/remove state mismatch');
if (!(state.selectedFolders?.length > 0)) throw new Error('selected folder state mismatch');
return { stateAfterManualRemoval, state, providerMessages };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "SP-002",
			module: "SystemPrompts",
			feature: "CRUD and feature exclusion",
			entry: "window.__formifyTestHooks system prompt helpers",
			expected: "系统提示词可新增/改写/重排/删除，并保留 excludeFeatures",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const id = 'supplemental-system-prompt-${ctx.runId}';
await hook.upsertSystemPrompt({ id, name: 'Supplemental Prompt', sourceType: 'custom', content: 'System prompt content', enabled: true, excludeFeatures: ['selection_toolbar'], order: 0, createdAt: Date.now(), updatedAt: Date.now() });
let prompts = await hook.listSystemPrompts();
const inserted = prompts.find((item) => item.id === id);
if (!inserted || !(inserted.excludeFeatures ?? []).includes('selection_toolbar')) throw new Error('system prompt excludeFeatures was not persisted');
await hook.reorderSystemPrompts(prompts.map((item) => item.id).reverse());
prompts = await hook.upsertSystemPrompt({ ...inserted, content: 'System prompt updated', enabled: false, updatedAt: Date.now() });
const updated = prompts.find((item) => item.id === id);
if (!updated || updated.enabled !== false || updated.content !== 'System prompt updated') throw new Error('system prompt update mismatch');
const afterDelete = await hook.deleteSystemPrompt(id);
if (afterDelete.some((item) => item.id === id)) throw new Error('system prompt delete mismatch');
return { inserted, updated, afterDeleteCount: afterDelete.length };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "QA-002",
			module: "QuickActions",
			feature: "delete quick action tolerates stale markdown cleanup races",
			entry: "QuickActionDataService.deleteQuickAction with simulated ENOENT",
			expected: "删除快捷操作时旧 Markdown 文件若已被并发移除，不应抛出 ENOENT，且缓存保持一致",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const manager = app.plugins.plugins.formify.featureCoordinator.getChatFeatureManager();
await hook.listQuickActions();
const service = manager?.quickActionDataService ?? manager?.['quickActionDataService'];
if (!service) {
  throw new Error('quickActionDataService-not-ready');
}
const baseTime = Date.now();
const primary = { id: 'qa-delete-primary-${ctx.runId}', name: 'QA Delete Primary', prompt: 'primary', promptSource: 'custom', showInToolbar: true, order: 0, createdAt: baseTime, updatedAt: baseTime, actionType: 'normal', isActionGroup: false, children: [] };
const sibling = { id: 'qa-delete-sibling-${ctx.runId}', name: 'QA Delete Sibling', prompt: 'sibling', promptSource: 'custom', showInToolbar: true, order: 1, createdAt: baseTime + 1, updatedAt: baseTime + 1, actionType: 'normal', isActionGroup: false, children: [] };
await hook.saveQuickAction(primary);
await hook.saveQuickAction(sibling);
const aiDataFolder = app.plugins.plugins.formify.settings.aiDataFolder.replace(/[\\\\/]+$/g, '');
const stalePath = aiDataFolder + '/quick-actions/' + primary.id + '.md';
const originalDelete = app.vault.delete.bind(app.vault);
let injected = false;
app.vault.delete = async (file, force) => {
  if (!injected && file?.path === stalePath) {
    injected = true;
    try {
      await app.vault.adapter.remove(stalePath);
    } catch {}
    throw new Error("ENOENT: no such file or directory, unlink '" + stalePath + "'");
  }
  return await originalDelete(file, force);
};
try {
  await hook.deleteQuickAction(primary.id);
} finally {
  app.vault.delete = originalDelete;
}
const remaining = await hook.listQuickActions();
await hook.deleteQuickAction(sibling.id);
if (remaining.some((item) => item.id === primary.id)) {
  throw new Error('deleted quick action still remains in cache');
}
if (!remaining.some((item) => item.id === sibling.id)) {
  throw new Error('sibling quick action disappeared unexpectedly');
}
if (await app.vault.adapter.exists(stalePath)) {
  throw new Error('stale quick action markdown file still exists after deletion');
}
return { remainingCount: remaining.length, injected };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "QA-003",
			module: "QuickActions",
			feature: "multi-level nesting and toolbar limits",
			entry: "window.__formifyTestHooks quick action helpers",
			expected: "快捷操作支持最多 3 层嵌套，超出时报错，showInToolbar 状态可更新",
			evidencePath,
			partial: true,
			untestedReason: "结果弹窗与流式 UI 仍未纳入本轮自动化",
		},
		`
const hook = window.__formifyTestHooks;
const baseTime = Date.now();
const group1 = { id: 'qa-group-1-${ctx.runId}', name: 'QA Group 1', prompt: '', promptSource: 'custom', showInToolbar: true, order: 0, createdAt: baseTime, updatedAt: baseTime, actionType: 'group', isActionGroup: true, children: [] };
const group2 = { id: 'qa-group-2-${ctx.runId}', name: 'QA Group 2', prompt: '', promptSource: 'custom', showInToolbar: true, order: 1, createdAt: baseTime + 1, updatedAt: baseTime + 1, actionType: 'group', isActionGroup: true, children: [] };
const group3 = { id: 'qa-group-3-${ctx.runId}', name: 'QA Group 3', prompt: '', promptSource: 'custom', showInToolbar: true, order: 2, createdAt: baseTime + 2, updatedAt: baseTime + 2, actionType: 'group', isActionGroup: true, children: [] };
const leaf = { id: 'qa-leaf-${ctx.runId}', name: 'QA Leaf', prompt: 'leaf', promptSource: 'custom', showInToolbar: true, order: 3, createdAt: baseTime + 3, updatedAt: baseTime + 3, actionType: 'normal', isActionGroup: false, children: [] };
await hook.saveQuickAction(group1);
await hook.saveQuickAction(group2);
await hook.saveQuickAction(group3);
await hook.saveQuickAction(leaf);
await hook.moveQuickActionToGroup(group2.id, group1.id);
await hook.moveQuickActionToGroup(group3.id, group2.id);
const level = await hook.getQuickActionNestingLevel(group3.id);
let nestingError = null;
try { await hook.moveQuickActionToGroup(leaf.id, group3.id); } catch (error) { nestingError = error instanceof Error ? error.message : String(error); }
await hook.updateQuickActionShowInToolbar(group1.id, false);
const updated = await hook.listQuickActions();
await hook.deleteQuickAction(group1.id);
await hook.deleteQuickAction(group2.id);
await hook.deleteQuickAction(group3.id);
await hook.deleteQuickAction(leaf.id);
if (level !== 2) throw new Error('quick action nesting level mismatch');
if (!String(nestingError ?? '').includes('最多支持 3 层嵌套')) throw new Error('quick action nesting limit error was not raised');
if (updated.find((item) => item.id === group1.id)?.showInToolbar !== false) throw new Error('quick action toolbar visibility update failed');
return { level, nestingError };
`,
		120000
	);

	await runExtraCase(
		{
			caseId: "EXP-005",
			module: "FileExpiry",
			feature: "popup batch delete move and open file",
			entry: "ExpiryNoticePopup DOM + test hooks",
			expected: "过期文件弹窗可打开文件、批量移动、批量删除",
			evidencePath,
		},
		`
const hook = window.__formifyTestHooks;
const notesBase = 'System/formify-tests/${ctx.runId}/fixtures/notes';
const getByTestId = (testId) => {
  const element = Array.from(document.querySelectorAll('[data-testid]')).find((item) => item.getAttribute('data-testid') === testId);
  if (!(element instanceof HTMLElement)) throw new Error('testid-not-found:' + testId);
  return element;
};
const clickByTestId = (testId) => {
  const element = getByTestId(testId);
  element.click();
};
hook.clearEvents();
hook.showExpiryNotice([{ path: notesBase + '/expiry-open.md', daysExpired: 7 }]);
await new Promise((resolve) => setTimeout(resolve, 300));
clickByTestId('formify-expiry-open-' + notesBase + '/expiry-open.md');
await new Promise((resolve) => setTimeout(resolve, 300));
const openedPath = app.workspace.getActiveFile()?.path ?? null;
if (openedPath !== notesBase + '/expiry-open.md') throw new Error('expiry popup open-file action did not activate target note');
clickByTestId('formify-expiry-close');
await new Promise((resolve) => setTimeout(resolve, 200));

hook.enqueueResponse('folderPicker', notesBase + '/move-destination');
hook.showExpiryNotice([{ path: notesBase + '/expiry-move.md', daysExpired: 9 }]);
await new Promise((resolve) => setTimeout(resolve, 300));
clickByTestId('formify-expiry-checkbox-' + notesBase + '/expiry-move.md');
clickByTestId('formify-expiry-move-selected');
await new Promise((resolve) => setTimeout(resolve, 500));
const movedExists = await app.vault.adapter.exists(notesBase + '/move-destination/expiry-move.md');
if (!movedExists) throw new Error('expiry popup move action did not move target file');
clickByTestId('formify-expiry-close');
await new Promise((resolve) => setTimeout(resolve, 200));

hook.showExpiryNotice([{ path: notesBase + '/expiry-delete.md', daysExpired: 11 }]);
await new Promise((resolve) => setTimeout(resolve, 300));
clickByTestId('formify-expiry-checkbox-' + notesBase + '/expiry-delete.md');
clickByTestId('formify-expiry-delete-selected');
await new Promise((resolve) => setTimeout(resolve, 500));
const deletedExists = await app.vault.adapter.exists(notesBase + '/expiry-delete.md');
if (deletedExists) throw new Error('expiry popup delete action did not delete target file');
return { openedPath, movedExists, deletedExists, events: hook.getEvents() };
`,
		120000
	);
	return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const runId = process.argv[2];
	await runSupplementalSuite(runId);
}
