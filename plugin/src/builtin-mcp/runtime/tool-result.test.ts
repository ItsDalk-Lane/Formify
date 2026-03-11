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

	it('should prefix tool errors', () => {
		expect(
			serializeMcpToolResult({
				content: [{ type: 'text', text: 'boom' }],
				isError: true,
			})
		).toBe('[工具执行错误] boom');
	});
});
