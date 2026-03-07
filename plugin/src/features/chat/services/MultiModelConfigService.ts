import { App, EventRef, TAbstractFile, TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import type { CompareGroup } from '../types/multiModel';
import { ensureAIDataFolders, getMultiModelConfigPath } from 'src/utils/AIPathManager';

type ConfigChangeCallback = (data: {
	compareGroups: CompareGroup[];
}) => void;

type ConfigType = 'compare-group';

const FRONTMATTER_DELIMITER = '---';

export class MultiModelConfigService {
	private readonly configFolderPath: string;
	private readonly eventRefs: EventRef[] = [];
	private readonly callbacks = new Set<ConfigChangeCallback>();
	private reloadTimer: number | null = null;

	constructor(
		private readonly app: App,
		private readonly aiDataFolder: string
	) {
		this.configFolderPath = getMultiModelConfigPath(aiDataFolder);
	}

	async initialize(): Promise<void> {
		await ensureAIDataFolders(this.app, this.aiDataFolder);
		this.registerWatchers();
	}

	dispose(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs.length = 0;
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
		this.callbacks.clear();
	}

	async loadCompareGroups(): Promise<CompareGroup[]> {
		const files = await this.listMarkdownFiles();
		const groups: CompareGroup[] = [];
		for (const file of files) {
			const parsed = await this.readCompareGroupFile(file);
			if (parsed) {
				groups.push(parsed);
			}
		}
		return groups.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async saveCompareGroup(group: CompareGroup): Promise<string> {
		await this.ensureFolder();
		const nextGroup: CompareGroup = {
			...group,
			updatedAt: Date.now()
		};
		const existingFile = await this.findConfigFile('compare-group', group.id);
		const targetPath = existingFile?.path ?? this.getCompareGroupFilePath(group.id);
		const content = this.serializeCompareGroup(nextGroup);
		if (existingFile) {
			await this.app.vault.modify(existingFile, content);
			return targetPath;
		}
		await this.app.vault.create(targetPath, content);
		return targetPath;
	}

	async deleteCompareGroup(id: string): Promise<void> {
		const file = await this.findConfigFile('compare-group', id);
		if (file) {
			await this.app.vault.delete(file);
		}
	}

	watchConfigs(callback: ConfigChangeCallback): () => void {
		this.callbacks.add(callback);
		void this.emitConfigChanges(callback);
		return () => {
			this.callbacks.delete(callback);
		};
	}

	private registerWatchers(): void {
		if (this.eventRefs.length > 0) {
			return;
		}

		this.eventRefs.push(
			this.app.vault.on('create', (file) => this.handleConfigFileChange(file)),
			this.app.vault.on('modify', (file) => this.handleConfigFileChange(file)),
			this.app.vault.on('delete', (file) => this.handleConfigFileChange(file)),
			this.app.vault.on('rename', (file, oldPath) => {
				this.handleConfigFileChange(file);
				if (this.isConfigPath(oldPath)) {
					this.scheduleReload();
				}
			})
		);
	}

	private handleConfigFileChange(file: TAbstractFile): void {
		if (this.isConfigPath(file.path)) {
			this.scheduleReload();
		}
	}

	private scheduleReload(): void {
		if (this.reloadTimer !== null) {
			window.clearTimeout(this.reloadTimer);
		}
		this.reloadTimer = window.setTimeout(() => {
			this.reloadTimer = null;
			void this.emitConfigChanges();
		}, 100);
	}

	private async emitConfigChanges(singleCallback?: ConfigChangeCallback): Promise<void> {
		const payload = {
			compareGroups: await this.loadCompareGroups()
		};
		if (singleCallback) {
			singleCallback(payload);
			return;
		}
		this.callbacks.forEach((callback) => callback(payload));
	}

	private async ensureFolder(): Promise<TFolder> {
		await ensureAIDataFolders(this.app, this.aiDataFolder);
		const folder = this.app.vault.getAbstractFileByPath(this.configFolderPath);
		if (!(folder instanceof TFolder)) {
			throw new Error(`多模型配置目录不存在: ${this.configFolderPath}`);
		}
		return folder;
	}

	private async listMarkdownFiles(): Promise<TFile[]> {
		const folder = await this.ensureFolder();
		return folder.children.filter((child): child is TFile => child instanceof TFile && child.extension === 'md');
	}

	private async findConfigFile(type: ConfigType, id: string): Promise<TFile | null> {
		const canonicalPath = this.getCompareGroupFilePath(id);
		const canonical = this.app.vault.getAbstractFileByPath(canonicalPath);
		if (canonical instanceof TFile) {
			return canonical;
		}

		const files = await this.listMarkdownFiles();
		for (const file of files) {
			const frontmatter = await this.readFrontmatter(file);
			if (frontmatter?.type === type && frontmatter.id === id) {
				return file;
			}
		}
		return null;
	}

	private async readCompareGroupFile(file: TFile): Promise<CompareGroup | null> {
		const content = await this.app.vault.read(file);
		return this.parseCompareGroupFromMarkdown(content);
	}

	parseCompareGroupFromMarkdown(content: string): CompareGroup | null {
		const { frontmatter, body } = this.extractFrontmatter(content);
		if (frontmatter?.type !== 'compare-group' || typeof frontmatter.id !== 'string') {
			return null;
		}
		const modelTags = body
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('- '))
			.map((line) => line.replace(/^- /, '').trim())
			.filter(Boolean);

		return {
			id: frontmatter.id,
			name: this.toStringValue(frontmatter.name),
			description: this.toStringValue(frontmatter.description),
			modelTags,
			createdAt: this.toNumberValue(frontmatter.createdAt),
			updatedAt: this.toNumberValue(frontmatter.updatedAt),
			isDefault: this.toBooleanValue(frontmatter.isDefault)
		};
	}

	private serializeCompareGroup(group: CompareGroup): string {
		const frontmatter = stringifyYaml({
			type: 'compare-group',
			id: group.id,
			name: group.name,
			description: group.description,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
			isDefault: group.isDefault
		});
		const modelsBlock = group.modelTags.map((tag) => `- ${tag}`).join('\n');
		return `${FRONTMATTER_DELIMITER}
${frontmatter}${FRONTMATTER_DELIMITER}

## 包含模型

${modelsBlock}
`;
	}

	private extractFrontmatter(content: string): {
		frontmatter: Record<string, unknown> | null;
		body: string;
	} {
		if (!content.startsWith(FRONTMATTER_DELIMITER)) {
			return { frontmatter: null, body: content };
		}

		const secondDelimiterIndex = content.indexOf(FRONTMATTER_DELIMITER, FRONTMATTER_DELIMITER.length);
		if (secondDelimiterIndex === -1) {
			return { frontmatter: null, body: content };
		}

		const frontmatterBlock = content.substring(FRONTMATTER_DELIMITER.length, secondDelimiterIndex).trim();
		const body = content.substring(secondDelimiterIndex + FRONTMATTER_DELIMITER.length).trim();
		const parsed = parseYaml(frontmatterBlock) as Record<string, unknown>;
		return { frontmatter: parsed, body };
	}

	private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
		const content = await this.app.vault.read(file);
		return this.extractFrontmatter(content).frontmatter;
	}

	private isConfigPath(path: string): boolean {
		const normalized = normalizePath(path);
		return normalized === this.configFolderPath || normalized.startsWith(`${this.configFolderPath}/`);
	}

	private getCompareGroupFilePath(id: string): string {
		return normalizePath(`${this.configFolderPath}/compare-group-${id}.md`);
	}

	private toStringValue(value: unknown): string {
		return typeof value === 'string' ? value : '';
	}

	private toNumberValue(value: unknown): number {
		if (typeof value === 'number') {
			return value;
		}
		if (typeof value === 'string') {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		return 0;
	}

	private toBooleanValue(value: unknown): boolean {
		if (typeof value === 'boolean') {
			return value;
		}
		if (typeof value === 'string') {
			return value.trim().toLowerCase() === 'true';
		}
		return false;
	}
}
