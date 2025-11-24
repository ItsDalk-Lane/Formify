import { App, Component, MarkdownRenderer } from 'obsidian';

export const renderMarkdownContent = async (
	app: App,
	markdown: string,
	container: HTMLElement,
	component: Component
) => {
	container.empty();
	await MarkdownRenderer.render(app, markdown, container, '', component);
};

