export class App {}
export class TFile {}
export class TFolder {}
export class Component {}
export class WorkspaceLeaf {}
export class MarkdownView {}
export class SuggestModal {}
export class FuzzySuggestModal {}
export class Modal {}
export class Setting {}
export class ToggleComponent {}

export const Platform = {
	isDesktop: true,
};

export const moment = () => ({
	toFormat: () => "",
	plus: () => moment(),
});

export const normalizePath = (value: string) => value;

export class Notice {
	constructor(message?: string) {
		if (message) {
			console.log(message);
		}
	}
}

export const setIcon = () => {};
export const requestUrl = async () => ({ json: async () => ({}) });
export const arrayBufferToBase64 = () => "";
export const debounce = <T extends (...args: any[]) => any>(fn: T): T => fn;
export const getLanguage = () => "en";

