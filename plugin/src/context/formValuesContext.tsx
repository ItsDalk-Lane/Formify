import {
	createContext,
	Dispatch,
	ReactNode,
	SetStateAction,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { FormIdValues } from "src/service/FormValues";

export type FormValuesDispatch = Dispatch<SetStateAction<FormIdValues>>;

export const FormValuesContext = createContext<FormIdValues | undefined>(
	undefined
);
export const FormValuesDispatchContext = createContext<
	FormValuesDispatch | undefined
>(undefined);
export const FormValuesStoreContext = createContext<FormValuesStore | undefined>(
	undefined
);

type FormValuesListener = () => void;

export interface FormValuesStore {
	getSnapshot: () => FormIdValues;
	setSnapshot: (next: FormIdValues) => void;
	subscribe: (listener: FormValuesListener) => () => void;
}

const createFormValuesStore = (initial: FormIdValues): FormValuesStore => {
	let current = initial;
	const listeners = new Set<FormValuesListener>();
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

export interface FormValuesProviderProps {
	values: FormIdValues;
	onChange: FormValuesDispatch;
	children: ReactNode;
}

export function FormValuesProvider({
	values,
	onChange,
	children,
}: FormValuesProviderProps) {
	const storeRef = useRef<FormValuesStore>();
	if (!storeRef.current) {
		storeRef.current = createFormValuesStore(values);
	}

	useEffect(() => {
		storeRef.current?.setSnapshot(values);
	}, [values]);

	return (
		<FormValuesContext.Provider value={values}>
			<FormValuesDispatchContext.Provider value={onChange}>
				<FormValuesStoreContext.Provider value={storeRef.current}>
					{children}
				</FormValuesStoreContext.Provider>
			</FormValuesDispatchContext.Provider>
		</FormValuesContext.Provider>
	);
}

export function useFormValues(): FormIdValues {
	const values = useContext(FormValuesContext);
	if (!values) {
		throw new Error(
			"useFormValues must be used within a FormValuesProvider"
		);
	}
	return values;
}

export function useFormValuesDispatch(): FormValuesDispatch {
	const dispatch = useContext(FormValuesDispatchContext);
	if (!dispatch) {
		throw new Error(
			"useFormValuesDispatch must be used within a FormValuesProvider"
		);
	}
	return dispatch;
}

/**
 * 使用示例:
 * const title = useFormValueSelector((values) => values["title"]);
 */
export function useFormValueSelector<T>(
	selector: (values: FormIdValues) => T
): T {
	const store = useContext(FormValuesStoreContext);
	const values = useContext(FormValuesContext);

	const getSnapshot = useCallback(() => {
		if (store) {
			return selector(store.getSnapshot());
		}
		if (!values) {
			throw new Error(
				"useFormValueSelector must be used within a FormValuesProvider"
			);
		}
		return selector(values);
	}, [selector, store, values]);

	const subscribe = useCallback(
		(listener: FormValuesListener) => {
			if (store) {
				return store.subscribe(listener);
			}
			return () => undefined;
		},
		[store]
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
