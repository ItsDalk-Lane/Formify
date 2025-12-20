import { useRef } from "react";

export default function useInputComposition() {
	const isCompositionRef = useRef(false);
	const onCompositionStart = () => {
		isCompositionRef.current = true;
	};

	const onCompositionEnd = () => {
		isCompositionRef.current = false;
	};
	return {
		isCompositionRef,
		onCompositionStart,
		onCompositionEnd,
	};
}
