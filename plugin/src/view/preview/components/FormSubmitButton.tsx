import { forwardRef } from "react";
import { localInstance } from "src/i18n/locals";
import CpsFormButtonLoading from "../animation/CpsFormButtonLoading";

export type FormSubmitButtonProps = {
	submitting: boolean;
};

export const FormSubmitButton = forwardRef<
	HTMLButtonElement,
	FormSubmitButtonProps
>(function FormSubmitButton({ submitting }, ref) {
	return (
		<button
			className="form--CpsFormSubmitButton mod-cta"
			type="submit"
			ref={ref}
			disabled={submitting}
		>
			{submitting ? (
				<CpsFormButtonLoading size={18} />
			) : (
				<>
					{localInstance.submit}
					<span className="form--CpsFormSubmitButtonKey">↵</span>
				</>
			)}
		</button>
	);
});
