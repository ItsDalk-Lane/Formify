import {
	checkMayAutonomouslyFetchUrl,
	extractContentFromHtml,
	fetchUrl,
	getRobotsTxtUrl,
	truncateFetchContent,
} from './fetch-mcp-server';

describe('fetch-mcp-server helpers', () => {
	it('should build robots.txt url', () => {
		expect(getRobotsTxtUrl('https://example.com/page?x=1#hash')).toBe(
			'https://example.com/robots.txt'
		);
	});

	it('should extract useful content from html', () => {
		const result = extractContentFromHtml(`
			<html>
				<body>
					<article>
						<h1>Hello</h1>
						<p>World</p>
					</article>
				</body>
			</html>
		`);

		expect(result).toContain('Hello');
		expect(result).toContain('World');
	});

	it('should allow robots.txt 404 and block disallowed paths', async () => {
		await expect(
			checkMayAutonomouslyFetchUrl('https://example.com/page', 'Agent/1.0', {
				request: async () =>
					({
						status: 404,
						text: '',
						headers: {},
					}) as any,
			})
		).resolves.toBeUndefined();

		await expect(
			checkMayAutonomouslyFetchUrl('https://example.com/page', 'Agent/1.0', {
				request: async () =>
					({
						status: 200,
						text: 'User-agent: *\nDisallow: /',
						headers: {},
					}) as any,
			})
		).rejects.toThrow('does not allow autonomous fetching');
	});

	it('should fetch html and truncate content with continuation hint', async () => {
		const { content, prefix } = await fetchUrl(
			'https://example.com/page',
			'Agent/1.0',
			false,
			{
				request: async () =>
					({
						status: 200,
						text: '<html><body><article><h1>Hello</h1><p>World</p></article></body></html>',
						headers: { 'content-type': 'text/html' },
					}) as any,
			}
		);

		expect(prefix).toBe('');
		expect(content).toContain('Hello');

		expect(truncateFetchContent('abcdef', 2, 3)).toBe(
			'cde\n\n<error>Content truncated. Call the fetch tool with a start_index of 5 to get more content.</error>'
		);
	});

	it('should keep raw non-html content with raw prefix', async () => {
		const result = await fetchUrl('https://example.com/data.json', 'Agent/1.0', false, {
			request: async () =>
				({
					status: 200,
					text: '{"ok":true}',
					headers: { 'content-type': 'application/json' },
				}) as any,
		});

		expect(result.prefix).toContain('cannot be simplified');
		expect(result.content).toBe('{"ok":true}');
	});
});
