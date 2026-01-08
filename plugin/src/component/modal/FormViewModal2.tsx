import { App } from "obsidian";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ObsidianAppContext } from "src/context/obsidianAppContext";
import { FormConfig } from "src/model/FormConfig";
import { CpsFormDataView } from "src/view/preview/CpsFormDataView";
import { CpsFormFileView } from "src/view/preview/CpsFormFileView";
import Dialog2 from "../dialog/Dialog2";
import "./FormViewModal.css";

/**
 * 表单模态框打开后的结果
 */
export interface FormModalResult {
	/** 是否成功提交 */
	submitted: boolean;
	/** 提交时的表单状态（仅当 submitted 为 true 时有值） */
	state?: Record<string, any>;
}

export default class FormViewModal2 {
	private isOpen = false;
	private containerEl: HTMLElement | null = null;
	private source: {
		formFilePath?: string;
		formConfig?: FormConfig;
		options?: {
			showOnlyFieldsNeedingInput?: boolean;
			/**
			 * 强制将 afterSubmit 延迟到动作链完成后触发（用于严格串行的“调用表单”场景）
			 */
			deferAfterSubmitUntilFinish?: boolean;
			/**
			 * 嵌套执行：复用父级 AbortController，避免中断父级执行
			 */
			nestedExecution?: boolean;
			/**
			 * 禁用“首个 AI 动作后台执行”优化（严格串行时需要）
			 */
			disableBackgroundExecutionOnAI?: boolean;
		};
	};
	
	/**
	 * Promise resolve 函数，用于等待用户操作完成
	 */
	private resolvePromise: ((result: FormModalResult) => void) | null = null;

	constructor(
		public app: App,
		source: {
			formFilePath?: string;
			formConfig?: FormConfig;
			options?: {
				showOnlyFieldsNeedingInput?: boolean;
			};
		}
	) {
		this.source = source;
	}

	/**
	 * 打开模态框
	 * @returns Promise，在用户提交或取消表单时 resolve
	 */
	async open(): Promise<FormModalResult> {
		if (this.isOpen) {
			return { submitted: false };
		}
		this.isOpen = true;

		return new Promise<FormModalResult>((resolve) => {
			this.resolvePromise = resolve;
			
			// Create container element for the dialog
			this.containerEl = document.createElement("div");
			this.containerEl.className = "form--FormViewModal2Container";
			document.body.appendChild(this.containerEl);

			// Create React root
			const root = createRoot(this.containerEl);

			// Render the FormModalContent component
			root.render(
				<StrictMode>
					<FormModalContent
						app={this.app}
						source={this.source}
						onSubmit={(state) => {
							this.isOpen = false;
							this.resolvePromise?.({ submitted: true, state });
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

	close() {
		this.isOpen = false;
		this.resolvePromise?.({ submitted: false });
		this.resolvePromise = null;
		if (this.containerEl) {
			// Trigger React unmount through a state change in the component
			const event = new CustomEvent("formmodal-close");
			this.containerEl.dispatchEvent(event);
		}
	}
}

// React component for the modal content
function FormModalContent({
	app,
	source,
	onSubmit,
	onClose,
}: {
	app: App;
	source: {
		formFilePath?: string;
		formConfig?: FormConfig;
		options?: {
			showOnlyFieldsNeedingInput?: boolean;
			deferAfterSubmitUntilFinish?: boolean;
			nestedExecution?: boolean;
			disableBackgroundExecutionOnAI?: boolean;
		};
	};
	onSubmit: (state: Record<string, any>) => void;
	onClose: () => void;
}) {
	const [open, setOpen] = useState(true);
	const [title, setTitle] = useState<string | undefined>(undefined);
	const [formConfig, setFormConfig] = useState<FormConfig | undefined>(
		source.formConfig
	);
	const [hasSubmitted, setHasSubmitted] = useState(false);
	/**
	 * 用于严格串行模式：提交后立即隐藏 Dialog（但不关闭），等动作链完成后再真正关闭。
	 * 这样可以保持组件存活，让 afterSubmit 回调能正常触发。
	 */
	const [isHiddenWhileExecuting, setIsHiddenWhileExecuting] = useState(false);
	const shouldCloseOnUserSubmit = source.options?.deferAfterSubmitUntilFinish === true;

	// Effect to handle closing
	useEffect(() => {
		if (!open) {
			// 如果已经提交过，不再调用 onClose（因为 onSubmit 已被调用）
			if (!hasSubmitted) {
				onClose();
			}
		}
	}, [open, onClose, hasSubmitted]);

	// Load form config from file if needed
	useEffect(() => {
		async function loadFormFromFile() {
			if (!source.formFilePath) return;

			try {
				const jsonObj = await app.vault.readJson(source.formFilePath);
				if (jsonObj) {
					const config = jsonObj as FormConfig;
					setFormConfig(config);

					// Set title based on file name
					const fileBaseName = source.formFilePath.split("/").pop();
					setTitle(fileBaseName);
				}
			} catch (error) {
				console.error("Failed to load form config", error);
			}
		}

		if (source.formFilePath && !formConfig) {
			loadFormFromFile();
		}
	}, [source.formFilePath, formConfig]);

	if (!formConfig && !source.formFilePath) {
		return null;
	}
	
	const handleAfterSubmit = (state?: Record<string, any>) => {
		setHasSubmitted(true);
		onSubmit(state || {});
	};

	const handleUserSubmit = () => {
		// 提交瞬间：标记已提交 + 隐藏 UI（但不关闭 Dialog，保持组件存活）
		setHasSubmitted(true);
		setIsHiddenWhileExecuting(true);
	};

	return (
		<Dialog2
			open={open}
			onOpenChange={setOpen}
			title={title}
			dialogClassName={`form--CpsFormModal ${isHiddenWhileExecuting ? 'form--CpsFormModal--hidden' : ''}`}
		>
			{(close) => (
				<ObsidianAppContext.Provider value={app}>
					{source.formFilePath && title && formConfig ? (
						<>
							<CpsFormFileView
								className="form--CpsFormModalContent"
								filePath={source.formFilePath}
								formConfig={formConfig}
								options={{
									hideHeader: true,
									showFilePath: true,
									onUserSubmit: shouldCloseOnUserSubmit
										? () => {
											handleUserSubmit();
										}
										: undefined,
									afterSubmit: (state) => {
										handleAfterSubmit(state);
										close();
									},
									showOnlyFieldsNeedingInput: source.options?.showOnlyFieldsNeedingInput,
									deferAfterSubmitUntilFinish: source.options?.deferAfterSubmitUntilFinish,
									nestedExecution: source.options?.nestedExecution,
									disableBackgroundExecutionOnAI: source.options?.disableBackgroundExecutionOnAI,
								}}
							/>
						</>
					) : formConfig ? (
						<CpsFormDataView
							className="form--CpsFormModalContent"
							formConfig={formConfig}
							options={{
								onUserSubmit: shouldCloseOnUserSubmit
								? () => {
									handleUserSubmit();
								}
								: undefined,
								afterSubmit: (state) => {
									handleAfterSubmit(state);
									close();
								},
								showOnlyFieldsNeedingInput: source.options?.showOnlyFieldsNeedingInput,
								deferAfterSubmitUntilFinish: source.options?.deferAfterSubmitUntilFinish,
								nestedExecution: source.options?.nestedExecution,
								disableBackgroundExecutionOnAI: source.options?.disableBackgroundExecutionOnAI,
							}}
						/>
					) : null}
				</ObsidianAppContext.Provider>
			)}
		</Dialog2>
	);
}
