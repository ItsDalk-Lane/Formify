import { attachChatInternalLinkHandler } from './markdown';

describe('attachChatInternalLinkHandler', () => {
	it('should open internal links in a new tab from chat markdown', () => {
		const openLinkText = jest.fn();
		const app = {
			workspace: {
				openLinkText,
				getActiveFile: jest.fn(() => ({ path: 'notes/source.md' })),
			},
		} as any;

		const container = document.createElement('div');
		const link = document.createElement('a');
		link.className = 'internal-link';
		link.setAttribute('data-href', 'notes/alpha.md');
		link.textContent = 'Alpha';
		container.appendChild(link);

		attachChatInternalLinkHandler(app, container);

		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(openLinkText).toHaveBeenCalledWith('notes/alpha.md', 'notes/source.md', true);
	});

	it('should ignore non-internal links', () => {
		const openLinkText = jest.fn();
		const app = {
			workspace: {
				openLinkText,
				getActiveFile: jest.fn(() => ({ path: 'notes/source.md' })),
			},
		} as any;

		const container = document.createElement('div');
		const link = document.createElement('a');
		link.href = 'https://example.com';
		link.textContent = 'External';
		container.appendChild(link);

		attachChatInternalLinkHandler(app, container);

		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(openLinkText).not.toHaveBeenCalled();
	});
});
