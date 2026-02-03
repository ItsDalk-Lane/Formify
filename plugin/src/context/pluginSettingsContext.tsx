import {
	createContext,
	ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { PluginSettings } from "src/settings/PluginSettings";

export const PluginSettingsContext = createContext<PluginSettings | undefined>(
	undefined
);

export const PluginSettingsStoreContext = createContext<
	PluginSettingsStore | undefined
>(undefined);

export const FormFolderContext = createContext<string | undefined>(undefined);
export const ScriptFolderContext = createContext<string | undefined>(undefined);
export const PromptTemplateFolderContext = createContext<string | undefined>(
	undefined
);
export const TarsSettingsContext = createContext<
	PluginSettings["tars"] | undefined
>(undefined);
export const ChatSettingsContext = createContext<
	PluginSettings["chat"] | undefined
>(undefined);

type PluginSettingsListener = () => void;

export interface PluginSettingsStore {
	getSnapshot: () => PluginSettings;
	setSnapshot: (next: PluginSettings) => void;
	subscribe: (listener: PluginSettingsListener) => () => void;
}

const createPluginSettingsStore = (
	initial: PluginSettings
): PluginSettingsStore => {
	let current = initial;
	const listeners = new Set<PluginSettingsListener>();
	return {
		getSnapshot: () => current,
		setSnapshot: (next) => {
			if (Object.is(current, next)) {
				return;
			}
			current = next;
			listeners.forEach((listener) => listener());
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};

export interface PluginSettingsProviderProps {
	settings: PluginSettings;
	children: ReactNode;
}

export function PluginSettingsProvider({
	settings,
	children,
}: PluginSettingsProviderProps) {
	const storeRef = useRef<PluginSettingsStore>();
	if (!storeRef.current) {
		storeRef.current = createPluginSettingsStore(settings);
	}

	useEffect(() => {
		storeRef.current?.setSnapshot(settings);
	}, [settings]);

	return (
		<PluginSettingsContext.Provider value={settings}>
			<PluginSettingsStoreContext.Provider value={storeRef.current}>
				<FormFolderContext.Provider value={settings.formFolder}>
					<ScriptFolderContext.Provider value={settings.scriptFolder}>
						<PromptTemplateFolderContext.Provider
							value={settings.promptTemplateFolder}
						>
							<TarsSettingsContext.Provider value={settings.tars}>
								<ChatSettingsContext.Provider value={settings.chat}>
									{children}
								</ChatSettingsContext.Provider>
							</TarsSettingsContext.Provider>
						</PromptTemplateFolderContext.Provider>
					</ScriptFolderContext.Provider>
				</FormFolderContext.Provider>
			</PluginSettingsStoreContext.Provider>
		</PluginSettingsContext.Provider>
	);
}

export const usePluginSettings = (): PluginSettings => {
	const context = useContext(PluginSettingsContext);
	if (!context) {
		throw new Error(
			"usePluginSettings must be used within a PluginSettingsContext"
		);
	}
	return context;
};

/**
 * 使用示例:
 * const formFolder = usePluginSettingsSelector((settings) => settings.formFolder);
 */
export function usePluginSettingsSelector<T>(
	selector: (settings: PluginSettings) => T
): T {
	const store = useContext(PluginSettingsStoreContext);
	const context = useContext(PluginSettingsContext);

	const getSnapshot = useCallback(() => {
		if (store) {
			return selector(store.getSnapshot());
		}
		if (!context) {
			throw new Error(
				"usePluginSettingsSelector must be used within a PluginSettingsProvider"
			);
		}
		return selector(context);
	}, [context, selector, store]);

	const subscribe = useCallback(
		(listener: PluginSettingsListener) => {
			if (store) {
				return store.subscribe(listener);
			}
			return () => undefined;
		},
		[store]
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const useFormFolder = (): string => {
	const formFolder = useContext(FormFolderContext);
	if (formFolder !== undefined) {
		return formFolder;
	}
	return usePluginSettings().formFolder;
};

export const useScriptFolder = (): string => {
	const scriptFolder = useContext(ScriptFolderContext);
	if (scriptFolder !== undefined) {
		return scriptFolder;
	}
	return usePluginSettings().scriptFolder;
};

export const usePromptTemplateFolder = (): string => {
	const promptTemplateFolder = useContext(PromptTemplateFolderContext);
	if (promptTemplateFolder !== undefined) {
		return promptTemplateFolder;
	}
	return usePluginSettings().promptTemplateFolder;
};

export const useTarsSettings = (): PluginSettings["tars"] => {
	const tars = useContext(TarsSettingsContext);
	if (tars !== undefined) {
		return tars;
	}
	return usePluginSettings().tars;
};

export const useChatSettings = (): PluginSettings["chat"] => {
	const chat = useContext(ChatSettingsContext);
	if (chat !== undefined) {
		return chat;
	}
	return usePluginSettings().chat;
};
