import {
	DEFAULT_SEARCH_CONTEXT_LINES,
	DEFAULT_SEARCH_MAX_RESULTS,
} from './constants';
import { createObsidianSearchBuiltinRuntime } from './obsidian-search-mcp-server';
import { executeSearch } from './search-engine/search-engine';

jest.mock('./search-engine/search-engine', () => ({
	executeSearch: jest.fn(),
}));

const executeSearchMock = executeSearch as jest.MockedFunction<typeof executeSearch>;

describe('createObsidianSearchBuiltinRuntime', () => {
	beforeEach(() => {
		executeSearchMock.mockReset();
		executeSearchMock.mockResolvedValue({
			query: 'mock-query',
			results: [],
			totalFiles: 0,
			totalMatches: 0,
			truncated: false,
		});
	});

	it('should list all 15 search tools', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		const tools = await runtime.listTools();

		expect(tools).toHaveLength(15);
		expect(tools.map((tool) => tool.name)).toEqual([
			'search_files',
			'search_path',
			'search_folder',
			'search_content',
			'search_tags',
			'search_line',
			'search_block',
			'search_section',
			'search_tasks',
			'search_properties',
			'quick_search',
			'advanced_search',
			'file_only_search',
			'content_only_search',
			'tag_search',
		]);

		await runtime.close();
	});

	it('should wrap multi-word file search queries into operator scope', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		await runtime.callTool('search_files', {
			query: 'daily notes',
		});

		expect(executeSearchMock).toHaveBeenCalledWith(
			expect.anything(),
			'file:(daily notes)',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'mtime-new',
				contextLines: DEFAULT_SEARCH_CONTEXT_LINES,
				explain: false,
			}
		);

		await runtime.close();
	});

	it('should keep OR queries inside line search scope', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		await runtime.callTool('search_line', {
			query: 'foo OR bar',
			contextLines: 3,
		});

		expect(executeSearchMock).toHaveBeenCalledWith(
			expect.anything(),
			'line:(foo OR bar)',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'mtime-new',
				contextLines: 3,
				explain: false,
			}
		);

		await runtime.close();
	});

	it('should select the correct task operator by taskStatus', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		await runtime.callTool('search_tasks', {
			query: 'ship release',
			taskStatus: 'done',
			sortBy: 'path-asc',
		});

		expect(executeSearchMock).toHaveBeenCalledWith(
			expect.anything(),
			'task-done:(ship release)',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'path-asc',
				contextLines: DEFAULT_SEARCH_CONTEXT_LINES,
				explain: false,
			}
		);

		await runtime.close();
	});

	it('should build property queries from comparator inputs', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		await runtime.callTool('search_properties', {
			property: 'rating',
			comparator: '>=',
			value: '5',
			explain: true,
		});

		expect(executeSearchMock).toHaveBeenCalledWith(
			expect.anything(),
			'[rating:>=5]',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'mtime-new',
				contextLines: DEFAULT_SEARCH_CONTEXT_LINES,
				explain: true,
			}
		);

		await runtime.close();
	});

	it('should build file-only and content-only grouped queries', async () => {
		const runtime = await createObsidianSearchBuiltinRuntime({} as any);

		await runtime.callTool('file_only_search', {
			query: '"Release Notes"',
		});
		expect(executeSearchMock).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			'(file:"Release Notes" OR path:"Release Notes" OR folder:"Release Notes")',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'mtime-new',
				contextLines: DEFAULT_SEARCH_CONTEXT_LINES,
				explain: false,
			}
		);

		const rawResult = await runtime.callTool('content_only_search', {
			query: 'foo bar',
		});
		expect(executeSearchMock).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			'(content:(foo bar) OR line:(foo bar) OR block:(foo bar) OR section:(foo bar))',
			{
				maxResults: DEFAULT_SEARCH_MAX_RESULTS,
				sortBy: 'mtime-new',
				contextLines: DEFAULT_SEARCH_CONTEXT_LINES,
				explain: false,
			}
		);
		expect(JSON.parse(rawResult)).toEqual({
			query: 'mock-query',
			results: [],
			totalFiles: 0,
			totalMatches: 0,
			truncated: false,
		});

		await runtime.close();
	});
});
