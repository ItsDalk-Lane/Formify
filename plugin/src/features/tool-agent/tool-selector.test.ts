import { ToolSelector } from './tool-selector';

describe('ToolSelector', () => {
	it('returns suggested tools first when provided', () => {
		const selector = new ToolSelector();
		const result = selector.selectTools('随便做点什么', {
			suggestedTools: ['read_file', 'search_content'],
		});

		expect(result.map((item) => item.tool.name)).toEqual([
			'read_file',
			'search_content',
		]);
	});

	it('uses domain and intent hints to narrow candidates before fallback scoring', () => {
		const selector = new ToolSelector();
		const result = selector.selectTools('记住这个偏好', {
			domain: 'memory',
			intentType: 'memory_store',
			complexity: 'simple',
		});

		expect(result.length).toBeGreaterThan(0);
		expect(result[0].tool.serverId).toBe('__builtin__:mcp-memory');
	});

	it('respects likelyServerIds when selecting builtin tools', () => {
		const selector = new ToolSelector();
		const result = selector.selectTools('读取当前文件内容', {
			likelyServerIds: ['__builtin__:vault-tools'],
		});

		expect(result.every((item) => item.tool.serverId === '__builtin__:vault-tools')).toBe(true);
	});
});
