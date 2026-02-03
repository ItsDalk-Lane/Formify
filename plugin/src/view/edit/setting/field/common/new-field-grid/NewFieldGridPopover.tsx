import { useState } from "react";
import { Popover } from "src/component/popover/Popover";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { NewFieldGrid } from "./NewFieldGrid";
import "./NewFieldGridPopover.css";

type Props = {
	onSelect: (fieldType: FormFieldType) => void;
	children: React.ReactNode;
};

export function NewFieldGridPopover({ children, onSelect }: Props) {
	const [open, setOpen] = useState(false);
	const handleSelect = (fieldType: FormFieldType) => {
		onSelect(fieldType);
		setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen} closeOnInteractOutside>
			{children}
			<NewFieldGrid onSelect={handleSelect} />
		</Popover>
	);
}
