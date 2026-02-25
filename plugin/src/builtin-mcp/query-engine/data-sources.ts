import { App, TFile } from 'obsidian';
import {
	QueryFileRecord,
	QueryPropertyRecord,
	QueryPropertyValueRecord,
	QuerySources,
	QueryTagRecord,
	QueryTaskRecord,
} from './types';

type Dict = Record<string, unknown>;

interface ListItemLike {
	task?: string;
	position?: {
		start?: {
			line?: number;
		};
	};
	completed?: boolean;
	checked?: boolean;
	status?: string;
}

const toDict = (value: unknown): Dict | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Dict;
};

const toStringArray = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.map((item) => String(item)).filter((item) => !!item);
	}
	if (typeof value === 'string') {
		return value
			.split(/[,\s]+/)
			.map((item) => item.trim())
			.filter((item) => !!item);
	}
	return [];
};

const extractTagsFromFrontmatter = (frontmatter: Dict | null): string[] => {
	if (!frontmatter) return [];
	const tagsValue = frontmatter.tags ?? frontmatter.tag;
	return toStringArray(tagsValue).map((tag) =>
		tag.startsWith('#') ? tag : `#${tag}`
	);
};

const extractInlineTags = (cache: Dict | null): string[] => {
	if (!cache) return [];
	const tags = cache.tags;
	if (!Array.isArray(tags)) return [];
	return tags
		.map((item) => {
			const dict = toDict(item);
			if (!dict) return '';
			return String(dict.tag ?? '');
		})
		.filter((item) => !!item);
};

const collectTasksFromCache = (
	cache: Dict | null,
	path: string
): QueryTaskRecord[] => {
	if (!cache) return [];
	const listItems = cache.listItems;
	if (!Array.isArray(listItems)) return [];

	const tasks: QueryTaskRecord[] = [];
	for (const item of listItems) {
		const dict = toDict(item) as ListItemLike | null;
		if (!dict) continue;
		const taskText = String(dict.task ?? '').trim();
		if (!taskText) continue;
		const completed = Boolean(
			dict.completed ?? dict.checked ?? /(\[x\]|\[X\])/.test(taskText)
		);
		const line = Number(dict.position?.start?.line ?? 0) + 1;
		tasks.push({
			source: 'task',
			path,
			line: Number.isFinite(line) ? line : 0,
			text: taskText,
			completed,
			status: completed ? 'done' : 'todo',
		});
	}
	return tasks;
};

const taskLinePattern = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;

const collectTasksFromText = (
	content: string,
	path: string
): QueryTaskRecord[] => {
	const tasks: QueryTaskRecord[] = [];
	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const match = line.match(taskLinePattern);
		if (!match) continue;
		const completed = match[1].toLowerCase() === 'x';
		tasks.push({
			source: 'task',
			path,
			line: index + 1,
			text: match[2],
			completed,
			status: completed ? 'done' : 'todo',
		});
	}
	return tasks;
};

const pushPropertyValue = (
	propertyValueRows: QueryPropertyValueRecord[],
	path: string,
	property: string,
	value: unknown
): void => {
	if (Array.isArray(value)) {
		for (const item of value) {
			propertyValueRows.push({
				source: 'property_value',
				path,
				property,
				value: item,
			});
		}
		return;
	}
	propertyValueRows.push({
		source: 'property_value',
		path,
		property,
		value,
	});
};

const buildFileRecord = (file: TFile): QueryFileRecord => {
	return {
		source: 'file',
		path: file.path,
		name: file.name,
		basename: file.basename,
		extension: file.extension,
		parent: file.parent?.path ?? '',
		size: file.stat?.size ?? 0,
		mtime: file.stat?.mtime ?? 0,
		ctime: file.stat?.ctime ?? 0,
	};
};

export async function collectVaultQuerySources(app: App): Promise<QuerySources> {
	const files = app.vault.getFiles();
	const fileRows: QueryFileRecord[] = [];
	const propertyRows: QueryPropertyRecord[] = [];
	const propertyValueRows: QueryPropertyValueRecord[] = [];
	const tagRows: QueryTagRecord[] = [];
	const taskRows: QueryTaskRecord[] = [];

	for (const file of files) {
		fileRows.push(buildFileRecord(file));

		const cacheRaw = app.metadataCache.getFileCache(file);
		const cache = toDict(cacheRaw);
		const frontmatter = toDict(cache?.frontmatter);

		if (frontmatter) {
			for (const [property, value] of Object.entries(frontmatter)) {
				propertyRows.push({
					source: 'property',
					path: file.path,
					property,
					value,
				});
				pushPropertyValue(propertyValueRows, file.path, property, value);
			}
		}

		const tags = new Set<string>([
			...extractInlineTags(cache),
			...extractTagsFromFrontmatter(frontmatter),
		]);
		for (const tag of tags) {
			tagRows.push({
				source: 'tag',
				path: file.path,
				tag,
			});
		}

		const taskFromCache = collectTasksFromCache(cache, file.path);
		if (taskFromCache.length > 0) {
			taskRows.push(...taskFromCache);
			continue;
		}

		if (file.extension.toLowerCase() !== 'md') {
			continue;
		}

		try {
			const content = await app.vault.cachedRead(file);
			taskRows.push(...collectTasksFromText(content, file.path));
		} catch {
			// ignore single-file read failure
		}
	}

	return {
		file: fileRows,
		property: propertyRows,
		tag: tagRows,
		property_value: propertyValueRows,
		task: taskRows,
	};
}
