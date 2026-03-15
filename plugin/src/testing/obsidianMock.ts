import * as yaml from 'yaml';

type MockCache = Map<PropertyKey, unknown>;

const createFallbackExport = (
	property: PropertyKey,
	cache: MockCache
): unknown => {
	if (cache.has(property)) {
		return cache.get(property);
	}

	const name = String(property);
	let value: unknown;

	if (name === '__esModule') {
		value = true;
	} else if (name === 'parseYaml') {
		value = (input: string) => yaml.parse(input);
	} else if (name === 'stringifyYaml') {
		value = (input: unknown) => yaml.stringify(input);
	} else if (name === 'normalizePath') {
		value = (input: string) => input;
	} else if (name === 'requestUrl') {
		value = jest.fn(async () => ({ json: {}, text: '' }));
	} else if (name === 'Notice') {
		value = jest.fn();
	} else if (/^[A-Z]/.test(name)) {
		value = class {};
	} else {
		value = jest.fn();
	}

	cache.set(property, value);
	return value;
};

export const createObsidianMock = (): Record<string, unknown> => {
	const cache: MockCache = new Map();
	return new Proxy(
		{},
		{
			get(_target, property) {
				return createFallbackExport(property, cache);
			},
		}
	);
};
