import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import CpsForm from "src/view/shared/CpsForm";
import { CreateFileSetting } from "./create-file/CreateFileSetting";
import { GenerateFormSetting } from "./generate-form/OpenFormSetting";
import { InsertTextSetting } from "./insert-text/InsertTextSetting";
import { RunScriptSetting } from "./run-script/RunScriptSetting";
import { SuggestModalSetting } from "./suggest-modal/SuggestModalSetting";
import { UpdateFrontmatterSetting } from "./update-frontmatter/UpdateFrontmatterSetting";
import { WaitSetting } from "./wait/WaitSetting";
import { CustomTitleSetting } from "./common/CustomTitleSetting";
import { RunCommandSetting } from "./run-command/RunCommandSetting";
import { ButtonSetting } from "./button/ButtonSetting";
import { TextSetting } from "./text/TextSetting";
import { AISetting } from "./ai/AISetting";
import { LoopSetting } from "./loop/LoopSetting";
import { CollectDataSetting } from "./collect-data/CollectDataSetting";
import { FormConfig } from "src/model/FormConfig";

export default function CpsFormActionDetailSetting(props: {
	value: IFormAction;
	onChange: (value: IFormAction) => void;
	formConfig: FormConfig;
}) {
	const { value, onChange, formConfig } = props;

	return (
		<CpsForm layout="horizontal">
			<CustomTitleSetting value={value} onChange={onChange} />
			<CreateFileSetting value={value} onChange={onChange} />
			<InsertTextSetting value={value} onChange={onChange} />
			<TextSetting value={value} onChange={onChange} />
			<UpdateFrontmatterSetting value={value} onChange={onChange} />
			<AISetting value={value} onChange={onChange} />
			<RunScriptSetting value={value} onChange={onChange} />
			<SuggestModalSetting value={value} onChange={onChange} />
			<RunCommandSetting value={value} onChange={onChange} />
			<GenerateFormSetting value={value} onChange={onChange} />
			<WaitSetting value={value} onChange={onChange} />
			<ButtonSetting value={value} onChange={onChange} />
			<LoopSetting value={value} onChange={onChange} formConfig={formConfig} />
			<CollectDataSetting value={value} onChange={onChange} />
		</CpsForm>
	);
}
