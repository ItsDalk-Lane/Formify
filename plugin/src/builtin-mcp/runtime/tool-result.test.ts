import { serializeMcpToolResult } from './tool-result';

describe('serializeMcpToolResult', () => {
	it('should join text blocks as plain text', () => {
		expect(
			serializeMcpToolResult({
				content: [
					{ type: 'text', text: 'hello' },
					{ type: 'text', text: 'world' },
				],
			})
		).toBe('hello\nworld');
	});

	it('should serialize non-text blocks to JSON text', () => {
		const result = serializeMcpToolResult({
			content: [
				{ type: 'text', text: 'summary' },
				{ type: 'image', mimeType: 'image/png', data: 'abc' },
				{ type: 'audio', mimeType: 'audio/mpeg', data: 'def' },
			],
		});

		expect(result).toContain('summary');
		expect(result).toContain('"type": "image"');
		expect(result).toContain('"mimeType": "audio/mpeg"');
	});

	it('should prefer structuredContent over text blocks', () => {
		const result = serializeMcpToolResult({
			structuredContent: {
				beta: 2,
				alpha: 1,
			},
			content: [{ type: 'text', text: 'fallback text' }],
		});

		expect(result).toBe('{\n  "alpha": 1,\n  "beta": 2\n}');
	});

	it('should prefix tool errors', () => {
		expect(
			serializeMcpToolResult({
				content: [{ type: 'text', text: 'boom' }],
				isError: true,
			})
		).toBe('[工具执行错误] boom');
	});
});
