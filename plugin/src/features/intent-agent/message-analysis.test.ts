import { MessageSemanticAnalyzer } from './message-analysis';

const createApp = () => {
	const files = [
		{ path: '000.md', name: '000.md', basename: '000' },
		{ path: 'Projects/roadmap.md', name: 'roadmap.md', basename: 'roadmap' },
		{ path: '日报.md', name: '日报.md', basename: '日报' },
		{ path: 'daily/2026-03-10.md', name: '2026-03-10.md', basename: '2026-03-10' },
		{ path: '2026-03-10.md', name: '2026-03-10.md', basename: '2026-03-10' },
		{
			path: 'System/AI Data/chat-history/帮我总结今天的日记-20260310155541.md',
			name: '帮我总结今天的日记-20260310155541.md',
			basename: '帮我总结今天的日记-20260310155541',
		},
		{
			path: 'subfolder/reports/2026-03-10-日报.md',
			name: '2026-03-10-日报.md',
			basename: '2026-03-10-日报',
		},
	];
	const folders = [
		{ path: '000', name: '000', children: [] },
		{ path: 'Projects/000', name: '000', children: [] },
		{ path: 'Archive/000', name: '000', children: [] },
		{ path: 'notes', name: 'notes', children: [] },
	];
	const byPath = new Map<string, unknown>();
	for (const entry of [...files, ...folders]) {
		byPath.set(entry.path, entry);
	}

	return {
		vault: {
			getFiles: () => files,
			getAllLoadedFiles: () => [...files, ...folders],
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
		},
		metadataCache: {
			getFirstLinkpathDest: (link: string) =>
				link === 'Roadmap' ? { path: 'Projects/roadmap.md' } : null,
		},
	} as any;
};

describe('MessageSemanticAnalyzer', () => {
	it('resolves a natural folder reference like "000 号文件夹"', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '给我总结 000 号文件夹中所有文件的内容',
		});

		expect(result.primaryAction).toBe('summarize');
		expect(result.references[0]?.type).toBe('natural_folder');
		expect(result.targetStatus).toBe('ambiguous');
		expect(result.pathResolutions[0]?.candidates).toContain('000');
	});

	it('resolves wiki links through metadata cache', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '帮我总结 [[Roadmap]]',
		});

		expect(result.resolvedTargets).toEqual([{ path: 'Projects/roadmap.md', kind: 'file' }]);
		expect(result.targetStatus).toBe('unique');
	});

	it('resolves explicit paths case-insensitively', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '读取 projects/roadmap.md',
		});

		expect(result.primaryAction).toBe('read');
		expect(result.resolvedTargets).toEqual([{ path: 'Projects/roadmap.md', kind: 'file' }]);
	});

	it('resolves the parent folder from the active file path', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '帮我看看上一级目录里的日报',
			activeFilePath: 'notes/today.md',
		});

		expect(result.pathResolutions[0]?.referenceType).toBe('parent_folder');
		expect(result.resolvedTargets[0]).toEqual({ path: 'notes', kind: 'folder' });
	});

	it('lets an explicit clarification path override an earlier ambiguous natural reference', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '给我总结 000 文件夹\n\n补充说明：Projects/000',
		});

		expect(result.targetStatus).toBe('unique');
		expect(result.resolvedTargets).toContainEqual({ path: 'Projects/000', kind: 'folder' });
	});

	it('resolves today note only when there is a single high-confidence daily candidate', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '帮我总结今天的日记',
		});

		expect(result.targetStatus).toBe('unique');
		expect(result.resolvedTargets).toEqual([{ path: 'daily/2026-03-10.md', kind: 'file' }]);
		expect(result.pathResolutions[0]?.candidates).toEqual(['daily/2026-03-10.md']);
	});

	it('marks missing targets when a natural file reference cannot be resolved', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '帮我总结 不存在的文件',
		});

		expect(result.targetStatus).toBe('missing');
		expect(result.ambiguityReasons).toContain('target_not_found');
	});

	it('flags file and folder target type conflicts', () => {
		const analyzer = new MessageSemanticAnalyzer(createApp());
		const result = analyzer.analyze({
			userMessage: '比较 000 文件夹和 000 文件',
		});

		expect(result.ambiguityReasons).toContain('target_type_conflict');
	});
});
