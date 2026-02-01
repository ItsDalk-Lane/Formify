import { App } from "obsidian";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ObsidianAppContext } from "src/context/obsidianAppContext";
import { localInstance } from "src/i18n/locals";
import { FormConfig } from "src/model/FormConfig";
import { IFormField } from "src/model/field/IFormField";
import { FormFieldType } from "src/model/enums/FormFieldType";
import { FormVisibilies } from "src/service/condition/FormVisibilies";
import { FormIdValues } from "src/service/FormValues";
import { resolveDefaultFormIdValues } from "src/utils/resolveDefaultFormIdValues";
import { getFieldDefaultValue } from "src/utils/getFieldDefaultValue";
import CpsForm from "src/view/shared/CpsForm";
import CpsFormItem from "src/view/shared/CpsFormItem";
import { CpsFormFieldControl } from "src/view/shared/control/CpsFormFieldControl";
import Dialog2 from "../dialog/Dialog2";
import { Tab, TabItem } from "../tab/Tab";
import "./MultiSubmitFormsModal.css";

export interface MultiSubmitFormsModalEntry {
	key: string;
	title: string;
	formConfig: FormConfig;
	fields: IFormField[];
}

export interface MultiSubmitFormsModalResult {
	submitted: boolean;
	valuesByKey?: Record<string, FormIdValues>;
}

export default class MultiSubmitFormsModal {
	private isOpen = false;
	private containerEl: HTMLElement | null = null;
	private resolvePromise: ((result: MultiSubmitFormsModalResult) => void) | null = null;

	constructor(
		private app: App,
		private entries: MultiSubmitFormsModalEntry[]
	) {}

	async open(): Promise<MultiSubmitFormsModalResult> {
		if (this.isOpen) {
			return { submitted: false };
		}
		this.isOpen = true;

		return new Promise<MultiSubmitFormsModalResult>((resolve) => {
			this.resolvePromise = resolve;

			this.containerEl = document.createElement("div");
			this.containerEl.className = "form--MultiSubmitFormsModalContainer";
			document.body.appendChild(this.containerEl);

			const root = createRoot(this.containerEl);

			root.render(
				<StrictMode>
					<MultiSubmitFormsModalContent
						app={this.app}
						entries={this.entries}
						onSubmit={(valuesByKey) => {
							this.isOpen = false;
							this.resolvePromise?.({ submitted: true, valuesByKey });
							this.resolvePromise = null;
							setTimeout(() => {
								root.unmount();
								this.containerEl?.remove();
								this.containerEl = null;
							});
						}}
						onClose={() => {
							this.isOpen = false;
							this.resolvePromise?.({ submitted: false });
							this.resolvePromise = null;
							setTimeout(() => {
								root.unmount();
								this.containerEl?.remove();
								this.containerEl = null;
							});
						}}
					/>
				</StrictMode>
			);
		});
	}
}

function MultiSubmitFormsModalContent(props: {
	app: App;
	entries: MultiSubmitFormsModalEntry[];
	onSubmit: (valuesByKey: Record<string, FormIdValues>) => void;
	onClose: () => void;
}) {
	const { app, entries, onSubmit, onClose } = props;
	const [open, setOpen] = useState(true);
	const [hasSubmitted, setHasSubmitted] = useState(false);
	const formId = useMemo(
		() => `form--MultiSubmitFormsModalForm-${Math.random().toString(36).slice(2)}`,
		[]
	);

	const [valuesByKey, setValuesByKey] = useState<Record<string, FormIdValues>>(
		() => {
			const initial: Record<string, FormIdValues> = {};
			for (const entry of entries) {
				initial[entry.key] = resolveDefaultFormIdValues(entry.fields);
			}
			return initial;
		}
	);

	useEffect(() => {
		if (!open) {
			if (!hasSubmitted) {
				onClose();
			}
		}
	}, [open, onClose, hasSubmitted]);

	// entries/fields 变化时，为新增字段补默认值（与 CpsFormRenderView 对齐）
	useEffect(() => {
		setValuesByKey((prev) => {
			const next: Record<string, FormIdValues> = { ...prev };
			let changed = false;

			for (const entry of entries) {
				const current = next[entry.key] ?? {};
				const currentFieldIds = new Set(Object.keys(current));
				const newFieldIds = new Set(entry.fields.map((f) => f.id));

				let hasNewFields = false;
				for (const fieldId of newFieldIds) {
					if (!currentFieldIds.has(fieldId)) {
						hasNewFields = true;
						break;
					}
				}

				if (hasNewFields) {
					const newValues = { ...current };
					entry.fields.forEach((field) => {
						if (!currentFieldIds.has(field.id)) {
							newValues[field.id] = getFieldDefaultValue(field);
						}
					});
					next[entry.key] = newValues;
					changed = true;
				}
			}

			return changed ? next : prev;
		});
	}, [entries]);

	const title = useMemo(() => {
		if (entries.length === 1) {
			return entries[0].title;
		}
		return localInstance.form_display_mode_merged;
	}, [entries]);

	const handleSubmit = () => {
		setHasSubmitted(true);
		onSubmit(valuesByKey);
		setOpen(false);
	};

	// 为每个表单生成标签页内容
	const renderFormContent = useCallback((entry: MultiSubmitFormsModalEntry) => {
		const entryValues = valuesByKey[entry.key] ?? {};
		const visibleFields = FormVisibilies.visibleFields(
			entry.fields,
			entryValues,
			app
		);
		const renderFields = visibleFields.filter(
			(field) => field.type !== FormFieldType.DATABASE
		);

		if (renderFields.length === 0) {
			return (
				<div className="form--MultiSubmitFormsModalEmptyTab">
					{localInstance.no_fields_for_form}
				</div>
			);
		}

		return (
			<CpsForm layout="vertical" className="form--MultiSubmitFormsModalTabContent">
				{renderFields.map((field, index) => (
					<CpsFormItem
						key={field.id}
						required={field.required}
						label={field.label}
						description={field.description}
					>
						<CpsFormFieldControl
							field={field}
							value={entryValues[field.id]}
							autoFocus={index === 0}
							onValueChange={(value) => {
								setValuesByKey((prev) => {
									const current = prev[entry.key] ?? {};
									return {
										...prev,
										[entry.key]: {
											...current,
											[field.id]: value,
										},
									};
								});
							}}
						/>
					</CpsFormItem>
				))}
			</CpsForm>
		);
	}, [valuesByKey, app]);

	// 生成标签页配置
	const tabItems: TabItem[] = useMemo(() => {
		return entries.map((entry) => ({
			id: entry.key,
			title: entry.title,
			content: renderFormContent(entry),
		}));
	}, [entries, renderFormContent]);

	// 单个表单时直接显示内容，多个表单时使用标签页
	const renderContent = () => {
		if (entries.length === 1) {
			return (
				<div className="form--MultiSubmitFormsModalScrollArea">
					{renderFormContent(entries[0])}
				</div>
			);
		}

		return (
			<Tab
				items={tabItems}
				defaultValue={entries[0]?.key}
				className="form--MultiSubmitFormsModalTabs"
			/>
		);
	};

	return (
		<Dialog2
			open={open}
			onOpenChange={setOpen}
			title={title}
			dialogClassName="form--CpsFormModal form--MultiSubmitFormsModal"
			titleRight={
				<button
					className="form--CpsFormPreviewSubmitButton"
					type="submit"
					form={formId}
				>
					{localInstance.submit}
				</button>
			}
		>
			{() => (
				<ObsidianAppContext.Provider value={app}>
					<form
						id={formId}
						className="form--MultiSubmitFormsModalForm"
						onSubmit={(e) => {
							e.preventDefault();
							handleSubmit();
						}}
					>
						<div className="form--MultiSubmitFormsModalBody">
							{renderContent()}
						</div>
					</form>
				</ObsidianAppContext.Provider>
			)}
		</Dialog2>
	);
}
