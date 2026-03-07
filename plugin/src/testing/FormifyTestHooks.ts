import { TFile, TFolder, normalizePath } from "obsidian";
import type FormPlugin from "src/main";
import { FormImportService } from "src/service/FormImportService";
import { FormConfig } from "src/model/FormConfig";
import {
	encodePathAndContent,
	extractContentFromEncodedValue,
	processContentWithMetadata,
} from "src/view/shared/control/FileListControl";
import {
	type ConditionEvaluationContext,
	getStartupConditionService,
} from "src/service/startup-condition/StartupConditionService";
import { getStartupFormService } from "src/service/command/StartupFormService";
import { SystemPromptDataService } from "src/features/tars/system-prompts/SystemPromptDataService";
import type { SystemPromptItem } from "src/features/tars/system-prompts/types";
import { QuickActionDataService } from "src/features/chat/selection-toolbar/QuickActionDataService";
import type {
	ChatMessage,
	ChatSession,
	QuickAction,
	SelectedFile,
	SelectedFolder,
} from "src/features/chat/types/chat";
import { VIEW_TYPE_CHAT_SIDEBAR, VIEW_TYPE_CHAT_TAB } from "src/features/chat/views/ChatView";

type TestResponseChannel =
	| "confirm"
	| "suggestModal"
	| "generateForm"
	| "folderPicker"
	| "exportHtmlFolder";

type TestEventRecord = {
	name: string;
	payload?: unknown;
	timestamp: number;
};

type TestArtifactRecord = TestEventRecord;

type WindowApi = {
	apiVersion: number;
	enabled: boolean;
	getInfo: () => Record<string, unknown>;
	clearEvents: () => void;
	getEvents: (name?: string) => TestEventRecord[];
	clearArtifacts: (kind?: string) => void;
	getArtifacts: (kind?: string) => Record<string, TestArtifactRecord[]> | TestArtifactRecord[];
	enqueueResponse: (channel: TestResponseChannel, value: unknown) => { size: number };
	clearResponses: (channel?: TestResponseChannel) => void;
	getUiSnapshot: () => Record<string, unknown>;
	getOpenFormCandidates: (query?: string) => Array<{ path: string; basename: string }>;
	getFormIntegrationSnapshot: () => Record<string, unknown>;
	refreshFormIntegration: (force?: boolean) => Promise<Record<string, unknown>>;
	runImportScenario: (args: {
		sourcePath: string;
		targetPath?: string;
		importOptions: Record<string, unknown>;
	}) => Promise<Record<string, unknown>>;
	evaluateStartupConditions: (args: {
		config: Record<string, unknown>;
		context?: Partial<ConditionEvaluationContext> & {
			currentFilePath?: string | null;
		};
		category?: string;
	}) => Promise<Record<string, unknown>>;
	executeStartupForms: (args?: { resetExecutionFlag?: boolean; runAutoTriggerEvaluation?: boolean }) => Promise<Record<string, unknown>>;
	evaluateFileListValues: (args: {
		paths: string[];
		includeMetadata: boolean;
	}) => Promise<Array<Record<string, unknown>>>;
	listSystemPrompts: () => Promise<SystemPromptItem[]>;
	upsertSystemPrompt: (prompt: SystemPromptItem) => Promise<SystemPromptItem[]>;
	deleteSystemPrompt: (id: string) => Promise<SystemPromptItem[]>;
	reorderSystemPrompts: (orderedIds: string[]) => Promise<SystemPromptItem[]>;
	listQuickActions: () => Promise<QuickAction[]>;
	saveQuickAction: (quickAction: QuickAction) => Promise<QuickAction[]>;
	deleteQuickAction: (id: string) => Promise<QuickAction[]>;
	moveQuickActionToGroup: (quickActionId: string, targetGroupId: string | null, position?: number) => Promise<QuickAction[]>;
	updateQuickActionGroupChildren: (groupId: string, childrenIds: string[]) => Promise<QuickAction[]>;
	updateQuickActionShowInToolbar: (id: string, showInToolbar: boolean) => Promise<QuickAction[]>;
	getQuickActionNestingLevel: (id: string) => Promise<number>;
	getChatState: () => Record<string, unknown>;
	chatCreateNewSession: (title?: string) => Record<string, unknown>;
	chatAddSelectedFile: (path: string) => Record<string, unknown>;
	chatAddSelectedFolder: (path: string) => Record<string, unknown>;
	chatAddActiveFile: (path?: string | null) => Record<string, unknown>;
	chatRemoveSelectedFile: (path: string, isManualRemoval?: boolean) => Record<string, unknown>;
	chatRemoveSelectedFolder: (path: string) => Record<string, unknown>;
	chatAddSelectedImages: (images: string[]) => Record<string, unknown>;
	chatRemoveSelectedImage: (image: string) => Record<string, unknown>;
	chatBuildProviderMessages: (args: {
		messages: ChatMessage[];
		systemPrompt?: string;
		session?: Partial<ChatSession>;
	}) => Promise<Record<string, unknown>>;
	showExpiryNotice: (files: Array<{ path: string; daysExpired: number }>) => boolean;
};

declare global {
	interface Window {
		__formifyTestHooks?: WindowApi | null;
	}
}

let activeFormifyTestHooks: FormifyTestHooks | null = null;

function safePayload(payload: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(payload));
	} catch {
		return payload;
	}
}

function getActiveHooks(): FormifyTestHooks | null {
	return activeFormifyTestHooks?.isEnabled() ? activeFormifyTestHooks : null;
}

export function isFormifyTestHooksEnabled(): boolean {
	return getActiveHooks() !== null;
}

export function recordFormifyTestEvent(name: string, payload?: unknown): void {
	getActiveHooks()?.recordEvent(name, payload);
}

export function recordFormifyTestArtifact(kind: string, payload?: unknown): void {
	getActiveHooks()?.recordArtifact(kind, payload);
}

export function consumeFormifyTestResponse(channel: TestResponseChannel): unknown {
	return getActiveHooks()?.consumeResponse(channel);
}

export class FormifyTestHooks {
	private readonly events: TestEventRecord[] = [];
	private readonly artifacts: Map<string, TestArtifactRecord[]> = new Map();
	private readonly responseQueues: Record<TestResponseChannel, unknown[]> = {
		confirm: [],
		suggestModal: [],
		generateForm: [],
		folderPicker: [],
		exportHtmlFolder: [],
	};
	private windowApi: WindowApi | null = null;

	constructor(private readonly plugin: FormPlugin) {}

	initialize(): void {
		this.syncWindowBinding();
	}

	dispose(): void {
		this.detachWindowBinding();
		this.clearEvents();
		this.clearArtifacts();
		this.clearResponses();
	}

	isEnabled(): boolean {
		return this.plugin.settings.testing?.enableTestHooks === true;
	}

	syncWindowBinding(): void {
		if (this.isEnabled()) {
			this.attachWindowBinding();
			return;
		}
		this.detachWindowBinding();
	}

	recordEvent(name: string, payload?: unknown): void {
		if (!this.isEnabled()) {
			return;
		}
		this.events.push({
			name,
			payload: safePayload(payload),
			timestamp: Date.now(),
		});
		if (this.events.length > 500) {
			this.events.splice(0, this.events.length - 500);
		}
	}

	recordArtifact(kind: string, payload?: unknown): void {
		if (!this.isEnabled()) {
			return;
		}
		const records = this.artifacts.get(kind) ?? [];
		records.push({
			name: kind,
			payload: safePayload(payload),
			timestamp: Date.now(),
		});
		if (records.length > 200) {
			records.splice(0, records.length - 200);
		}
		this.artifacts.set(kind, records);
	}

	enqueueResponse(channel: TestResponseChannel, value: unknown): { size: number } {
		this.responseQueues[channel].push(value);
		return { size: this.responseQueues[channel].length };
	}

	consumeResponse(channel: TestResponseChannel): unknown {
		const queue = this.responseQueues[channel];
		if (queue.length === 0) {
			return undefined;
		}
		return queue.shift();
	}

	clearEvents(): void {
		this.events.length = 0;
	}

	getEvents(name?: string): TestEventRecord[] {
		return this.events
			.filter((event) => !name || event.name === name)
			.map((event) => ({ ...event }));
	}

	clearArtifacts(kind?: string): void {
		if (!kind) {
			this.artifacts.clear();
			return;
		}
		this.artifacts.delete(kind);
	}

	getArtifacts(kind?: string): Record<string, TestArtifactRecord[]> | TestArtifactRecord[] {
		if (kind) {
			return [...(this.artifacts.get(kind) ?? [])];
		}
		const result: Record<string, TestArtifactRecord[]> = {};
		for (const [key, records] of this.artifacts.entries()) {
			result[key] = [...records];
		}
		return result;
	}

	clearResponses(channel?: TestResponseChannel): void {
		if (channel) {
			this.responseQueues[channel] = [];
			return;
		}
		for (const key of Object.keys(this.responseQueues) as TestResponseChannel[]) {
			this.responseQueues[key] = [];
		}
	}

	private attachWindowBinding(): void {
		if (!this.windowApi) {
			this.windowApi = this.createWindowApi();
		}
		activeFormifyTestHooks = this;
		window.__formifyTestHooks = this.windowApi;
		this.recordEvent("test-hooks-attached", {
			version: this.plugin.manifest.version,
		});
	}

	private detachWindowBinding(): void {
		if (activeFormifyTestHooks === this) {
			activeFormifyTestHooks = null;
		}
		if (window.__formifyTestHooks === this.windowApi) {
			window.__formifyTestHooks = null;
		}
	}

	private createWindowApi(): WindowApi {
		return {
			apiVersion: 1,
			enabled: true,
			getInfo: () => this.getInfo(),
			clearEvents: () => this.clearEvents(),
			getEvents: (name?: string) => this.getEvents(name),
			clearArtifacts: (kind?: string) => this.clearArtifacts(kind),
			getArtifacts: (kind?: string) => this.getArtifacts(kind),
			enqueueResponse: (channel: TestResponseChannel, value: unknown) => this.enqueueResponse(channel, value),
			clearResponses: (channel?: TestResponseChannel) => this.clearResponses(channel),
			getUiSnapshot: () => this.getUiSnapshot(),
			getOpenFormCandidates: (query?: string) => this.getOpenFormCandidates(query),
			getFormIntegrationSnapshot: () => this.getFormIntegrationSnapshot(),
			refreshFormIntegration: async (force?: boolean) => this.refreshFormIntegration(force),
			runImportScenario: async (args) => this.runImportScenario(args),
			evaluateStartupConditions: async (args) => this.evaluateStartupConditions(args),
			executeStartupForms: async (args?: { resetExecutionFlag?: boolean; runAutoTriggerEvaluation?: boolean }) => this.executeStartupForms(args),
			evaluateFileListValues: async (args) => this.evaluateFileListValues(args),
			listSystemPrompts: async () => this.listSystemPrompts(),
			upsertSystemPrompt: async (prompt: SystemPromptItem) => this.upsertSystemPrompt(prompt),
			deleteSystemPrompt: async (id: string) => this.deleteSystemPrompt(id),
			reorderSystemPrompts: async (orderedIds: string[]) => this.reorderSystemPrompts(orderedIds),
			listQuickActions: async () => this.listQuickActions(),
			saveQuickAction: async (quickAction: QuickAction) => this.saveQuickAction(quickAction),
			deleteQuickAction: async (id: string) => this.deleteQuickAction(id),
			moveQuickActionToGroup: async (quickActionId: string, targetGroupId: string | null, position?: number) =>
				this.moveQuickActionToGroup(quickActionId, targetGroupId, position),
			updateQuickActionGroupChildren: async (groupId: string, childrenIds: string[]) =>
				this.updateQuickActionGroupChildren(groupId, childrenIds),
			updateQuickActionShowInToolbar: async (id: string, showInToolbar: boolean) =>
				this.updateQuickActionShowInToolbar(id, showInToolbar),
			getQuickActionNestingLevel: async (id: string) => this.getQuickActionNestingLevel(id),
			getChatState: () => this.getChatState(),
			chatCreateNewSession: (title?: string) => this.chatCreateNewSession(title),
			chatAddSelectedFile: (path: string) => this.chatAddSelectedFile(path),
			chatAddSelectedFolder: (path: string) => this.chatAddSelectedFolder(path),
			chatAddActiveFile: (path?: string | null) => this.chatAddActiveFile(path),
			chatRemoveSelectedFile: (path: string, isManualRemoval?: boolean) => this.chatRemoveSelectedFile(path, isManualRemoval),
			chatRemoveSelectedFolder: (path: string) => this.chatRemoveSelectedFolder(path),
			chatAddSelectedImages: (images: string[]) => this.chatAddSelectedImages(images),
			chatRemoveSelectedImage: (image: string) => this.chatRemoveSelectedImage(image),
			chatBuildProviderMessages: async (args) => this.chatBuildProviderMessages(args),
			showExpiryNotice: (files: Array<{ path: string; daysExpired: number }>) => this.showExpiryNotice(files),
		};
	}

	private getInfo(): Record<string, unknown> {
		return {
			enabled: this.isEnabled(),
			version: this.plugin.manifest.version,
			eventCount: this.events.length,
			artifactKinds: Array.from(this.artifacts.keys()),
		};
	}

	private getUiSnapshot(): Record<string, unknown> {
		return {
			openFormModal: Boolean(document.querySelector("[data-testid='formify-open-form-modal']")),
			importDialog: Boolean(document.querySelector("[data-testid='formify-import-dialog']")),
			expiryPopup: Boolean(document.querySelector("[data-testid='formify-expiry-popup']")),
			persistentChatModal: Boolean(document.querySelector(".chat-persistent-modal")),
			temporaryChatModal: Boolean(document.querySelector(".chat-modal")),
			chatSidebarLeaves: this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT_SIDEBAR).length,
			chatTabLeaves: this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT_TAB).length,
			activeFilePath: this.plugin.app.workspace.getActiveFile()?.path ?? null,
		};
	}

	private getOpenFormCandidates(query?: string): Array<{ path: string; basename: string }> {
		const normalizedQuery = (query ?? "").trim().toLowerCase();
		return this.plugin.app.vault
			.getFiles()
			.filter((file) => file.extension === "cform")
			.filter((file) => {
				if (!normalizedQuery) {
					return true;
				}
				return file.basename.toLowerCase().includes(normalizedQuery);
			})
			.map((file) => ({
				path: file.path,
				basename: file.basename,
			}));
	}

	private getFormIntegrationSnapshot(): Record<string, unknown> {
		const service = (this.plugin as any).services?.formIntegrationService as {
			formCommandIdsByPath?: Map<string, string>;
			triggerCommandIdsByPath?: Map<string, Set<string>>;
		};
		const formEntries = Array.from(service?.formCommandIdsByPath?.entries?.() ?? []).map(([path, commandId]) => ({
			path,
			commandId,
			fullCommandId: `form:${commandId}`,
		}));
		const triggerEntries = Array.from(service?.triggerCommandIdsByPath?.entries?.() ?? []).map(([path, ids]) => ({
			path,
			commandIds: Array.from(ids).map((id) => `form-trigger:${id}`),
		}));
		return {
			formEntries,
			triggerEntries,
			formCount: formEntries.length,
			triggerCount: triggerEntries.reduce((count, entry) => count + entry.commandIds.length, 0),
		};
	}

	private async refreshFormIntegration(force?: boolean): Promise<Record<string, unknown>> {
		await (this.plugin as any).services.formIntegrationService.initialize(this.plugin, force === true);
		return this.getFormIntegrationSnapshot();
	}

	private async runImportScenario(args: {
		sourcePath: string;
		targetPath?: string;
		importOptions: Record<string, unknown>;
	}): Promise<Record<string, unknown>> {
		const importService = new FormImportService(this.plugin.app);
		const importAny = importService as any;
		const sourceConfig = await this.readFormConfig(args.sourcePath);
		const targetConfig = args.targetPath ? await this.readFormConfig(args.targetPath) : undefined;
		const validation = await importAny.validateImport(sourceConfig, args.importOptions);
		const conflicts = await importAny.detectConflicts(sourceConfig, targetConfig);
		const result = await importService.importForm(
			args.sourcePath,
			args.importOptions as any,
			targetConfig
		);

		const importedFields = result.importedConfig?.fields ?? [];
		const sourceFields = sourceConfig.fields ?? [];
		const importedActions = result.importedConfig?.actions ?? [];
		const sourceActions = sourceConfig.actions ?? [];
		const idsChanged =
			importedFields.every((field, index) => !sourceFields[index] || field.id !== sourceFields[index].id) &&
			importedActions.every((action, index) => !sourceActions[index] || action.id !== sourceActions[index].id);
		const deepCopied =
			importedFields.every((field, index) => !sourceFields[index] || field !== sourceFields[index]) &&
			importedActions.every((action, index) => !sourceActions[index] || action !== sourceActions[index]);

		return {
			validation,
			conflicts,
			result,
			analysis: {
				idsChanged,
				deepCopied,
				importedFieldCount: importedFields.length,
				importedActionCount: importedActions.length,
			},
		};
	}

	private async evaluateStartupConditions(args: {
		config: Record<string, unknown>;
		context?: Partial<ConditionEvaluationContext> & {
			currentFilePath?: string | null;
		};
		category?: string;
	}): Promise<Record<string, unknown>> {
		const currentFile = args.context?.currentFilePath
			? this.plugin.app.vault.getAbstractFileByPath(args.context.currentFilePath)
			: undefined;
		const context: ConditionEvaluationContext = {
			app: this.plugin.app,
			currentFile: currentFile instanceof TFile ? currentFile : this.plugin.app.workspace.getActiveFile(),
			formFilePath: args.context?.formFilePath,
			lastExecutionTime: args.context?.lastExecutionTime,
			pluginVersion: args.context?.pluginVersion ?? this.plugin.manifest.version,
			formConfig: args.context?.formConfig,
		};
		const result = await getStartupConditionService().evaluateConditions(
			args.config as any,
			context,
			args.category
		);
		return { result };
	}

	private async executeStartupForms(args?: { resetExecutionFlag?: boolean; runAutoTriggerEvaluation?: boolean }): Promise<Record<string, unknown>> {
		const service = getStartupFormService(this.plugin.app) as any;
		const autoTriggerService = (this.plugin as any).services?.autoTriggerService as
			| {
					initialize?: (plugin: FormPlugin, formService: unknown, force?: boolean) => Promise<void>;
					monitoredForms?: Map<string, unknown>;
					monitoredTriggers?: Map<string, unknown>;
					evaluateAllOnce?: () => Promise<unknown>;
			  }
			| undefined;
		if (args?.resetExecutionFlag) {
			service.isExecuted = false;
		}
		await autoTriggerService?.initialize?.(this.plugin, (this.plugin as any).services?.formService, true);
		service.setPluginVersion(this.plugin.manifest.version);
		await service.executeStartupForms();
		let autoTriggerResult: unknown = null;
		if (args?.runAutoTriggerEvaluation) {
			autoTriggerResult = await autoTriggerService?.evaluateAllOnce?.();
		}
		return {
			isExecuted: Boolean(service.isExecuted),
			autoTriggerResult,
			monitoredForms: autoTriggerService?.monitoredForms?.size ?? null,
			monitoredTriggers: autoTriggerService?.monitoredTriggers?.size ?? null,
		};
	}

	private async evaluateFileListValues(args: {
		paths: string[];
		includeMetadata: boolean;
	}): Promise<Array<Record<string, unknown>>> {
		const results: Array<Record<string, unknown>> = [];
		for (const rawPath of args.paths) {
			const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(rawPath));
			if (!(file instanceof TFile)) {
				results.push({
					path: rawPath,
					error: "file-not-found",
				});
				continue;
			}
			const content = await this.plugin.app.vault.read(file);
			const processed = processContentWithMetadata(content, args.includeMetadata);
			const encoded = encodePathAndContent(file.path, processed);
			results.push({
				path: file.path,
				includeMetadata: args.includeMetadata,
				processed,
				encoded,
				extracted: extractContentFromEncodedValue(encoded, args.includeMetadata),
			});
		}
		return results;
	}

	private async listSystemPrompts(): Promise<SystemPromptItem[]> {
		return await SystemPromptDataService.getInstance(this.plugin.app).getSortedPrompts();
	}

	private async upsertSystemPrompt(prompt: SystemPromptItem): Promise<SystemPromptItem[]> {
		const service = SystemPromptDataService.getInstance(this.plugin.app);
		await service.upsertPrompt(prompt);
		return await service.getSortedPrompts();
	}

	private async deleteSystemPrompt(id: string): Promise<SystemPromptItem[]> {
		const service = SystemPromptDataService.getInstance(this.plugin.app);
		await service.deletePrompt(id);
		return await service.getSortedPrompts();
	}

	private async reorderSystemPrompts(orderedIds: string[]): Promise<SystemPromptItem[]> {
		const service = SystemPromptDataService.getInstance(this.plugin.app);
		await service.reorderPrompts(orderedIds);
		return await service.getSortedPrompts();
	}

	private async listQuickActions(): Promise<QuickAction[]> {
		return await QuickActionDataService.getInstance(this.plugin.app).getSortedQuickActions();
	}

	private async saveQuickAction(quickAction: QuickAction): Promise<QuickAction[]> {
		const service = QuickActionDataService.getInstance(this.plugin.app);
		await service.saveQuickAction(quickAction);
		return await service.getSortedQuickActions();
	}

	private async deleteQuickAction(id: string): Promise<QuickAction[]> {
		const service = QuickActionDataService.getInstance(this.plugin.app);
		await service.deleteQuickAction(id);
		return await service.getSortedQuickActions();
	}

	private async moveQuickActionToGroup(
		quickActionId: string,
		targetGroupId: string | null,
		position?: number
	): Promise<QuickAction[]> {
		const service = QuickActionDataService.getInstance(this.plugin.app);
		await service.moveQuickActionToGroup(quickActionId, targetGroupId, position);
		return await service.getSortedQuickActions();
	}

	private async updateQuickActionGroupChildren(groupId: string, childrenIds: string[]): Promise<QuickAction[]> {
		const service = QuickActionDataService.getInstance(this.plugin.app);
		await service.updateQuickActionGroupChildren(groupId, childrenIds);
		return await service.getSortedQuickActions();
	}

	private async updateQuickActionShowInToolbar(id: string, showInToolbar: boolean): Promise<QuickAction[]> {
		const service = QuickActionDataService.getInstance(this.plugin.app);
		await service.updateQuickActionShowInToolbar(id, showInToolbar);
		return await service.getSortedQuickActions();
	}

	private async getQuickActionNestingLevel(id: string): Promise<number> {
		return await QuickActionDataService.getInstance(this.plugin.app).getNestingLevel(id);
	}

	private getChatService(): any {
		const manager = this.plugin.featureCoordinator.getChatFeatureManager();
		if (!manager) {
			throw new Error("chat-feature-manager-not-ready");
		}
		return manager.getService();
	}

	private getChatState(): Record<string, unknown> {
		return safePayload(this.getChatService().getState()) as Record<string, unknown>;
	}

	private chatCreateNewSession(title?: string): Record<string, unknown> {
		const service = this.getChatService();
		service.createNewSession(title);
		return this.getChatState();
	}

	private chatAddSelectedFile(path: string): Record<string, unknown> {
		const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) {
			throw new Error(`file-not-found:${path}`);
		}
		this.getChatService().addSelectedFile(file);
		return this.getChatState();
	}

	private chatAddSelectedFolder(path: string): Record<string, unknown> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(folder instanceof TFolder)) {
			throw new Error(`folder-not-found:${path}`);
		}
		this.getChatService().addSelectedFolder(folder);
		return this.getChatState();
	}

	private chatAddActiveFile(path?: string | null): Record<string, unknown> {
		const file = path
			? this.plugin.app.vault.getAbstractFileByPath(normalizePath(path))
			: this.plugin.app.workspace.getActiveFile();
		this.getChatService().addActiveFile(file instanceof TFile ? file : null);
		return this.getChatState();
	}

	private chatRemoveSelectedFile(path: string, isManualRemoval: boolean = true): Record<string, unknown> {
		this.getChatService().removeSelectedFile(path, isManualRemoval);
		return this.getChatState();
	}

	private chatRemoveSelectedFolder(path: string): Record<string, unknown> {
		this.getChatService().removeSelectedFolder(path);
		return this.getChatState();
	}

	private chatAddSelectedImages(images: string[]): Record<string, unknown> {
		this.getChatService().addSelectedImages(images);
		return this.getChatState();
	}

	private chatRemoveSelectedImage(image: string): Record<string, unknown> {
		this.getChatService().removeSelectedImage(image);
		return this.getChatState();
	}

	private async chatBuildProviderMessages(args: {
		messages: ChatMessage[];
		systemPrompt?: string;
		session?: Partial<ChatSession>;
	}): Promise<Record<string, unknown>> {
		const service = this.getChatService();
		const activeSession = service.getActiveSession();
		if (!activeSession) {
			throw new Error("chat-session-not-ready");
		}
		const session: ChatSession = {
			...safePayload(activeSession),
			...(args.session ?? {}),
			selectedFiles: ((args.session?.selectedFiles ?? activeSession.selectedFiles ?? service.getState().selectedFiles) as SelectedFile[]),
			selectedFolders: ((args.session?.selectedFolders ?? activeSession.selectedFolders ?? service.getState().selectedFolders) as SelectedFolder[]),
			messages: args.messages,
		};
		const providerMessages = await service.buildProviderMessagesForAgent(args.messages, session, args.systemPrompt);
		return {
			count: providerMessages.length,
			messages: safePayload(providerMessages),
		};
	}

	private showExpiryNotice(files: Array<{ path: string; daysExpired: number }>): boolean {
		const manager = (this.plugin as any).expiryNoticeManager as {
			show?: (files: Array<{ filePath: string; daysSinceAccess: number }>) => void;
		} | null;
		if (!manager?.show) {
			return false;
		}
		manager.show(
			files.map((file) => ({
				filePath: file.path,
				daysSinceAccess: file.daysExpired,
			}))
		);
		return true;
	}

	private async readFormConfig(path: string): Promise<FormConfig> {
		const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) {
			throw new Error(`form-file-not-found:${path}`);
		}
		const raw = await this.plugin.app.vault.read(file);
		return FormConfig.fromJSON(JSON.parse(raw));
	}
}
