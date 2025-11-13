import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { localInstance } from "src/i18n/locals";
import { ConfirmPopover } from "src/component/confirm/ConfirmPopover";
import "./CpsFormSetting.css";

export function CpsFormSettingGroup(props: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
	defaultCollapsed?: boolean;
	showBatchActions?: boolean;
	selectMode?: boolean;
	onToggleSelectMode?: () => void;
	onSelectAll?: () => void;
	onSelectNone?: () => void;
	onDeleteSelected?: () => void;
	batchActions?: { all: () => void; none: () => void; delete: () => void };
}) {
	const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true);

	const handleToggleSelectMode = () => {
		if (props.onToggleSelectMode) {
			props.onToggleSelectMode();
		}
	};

	const handleIconClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (props.showBatchActions) {
			handleToggleSelectMode();
		}
	};

	const handleHeaderClick = () => {
		setCollapsed(!collapsed);
	};

	return (
		<div className="form--CpsFormSettingGroup">
			<div
				className="form--SettingGroupHeader"
				onClick={handleHeaderClick}
				style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
			>
				<div style={{ display: "flex", alignItems: "center" }}>
					{props.showBatchActions ? (
						<div
							onClick={handleIconClick}
							style={{
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								marginRight: "8px",
								padding: "4px",
								borderRadius: "4px",
								transition: "background-color 0.2s"
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.backgroundColor = "var(--interactive-hover)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.backgroundColor = "transparent";
							}}
							title={props.selectMode ? localInstance.cancel : localInstance.more}
						>
							{props.icon}
						</div>
					) : (
						props.icon
					)}
					{props.title}
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					{props.showBatchActions && props.selectMode && (
						<>
							<button
								className="form--BatchActionButton"
								onClick={(e) => {
									e.stopPropagation();
									if (props.onSelectAll) props.onSelectAll();
									else if (props.batchActions?.all) props.batchActions.all();
								}}
								title={localInstance.all}
							>
								{localInstance.all}
							</button>
							<button
								className="form--BatchActionButton"
								onClick={(e) => {
									e.stopPropagation();
									if (props.onSelectNone) props.onSelectNone();
									else if (props.batchActions?.none) props.batchActions.none();
								}}
								title={localInstance.none}
							>
								{localInstance.none}
							</button>
							<ConfirmPopover onConfirm={() => {
								if (props.onDeleteSelected) props.onDeleteSelected();
								else if (props.batchActions?.delete) props.batchActions.delete();
							}}>
								<button
									className="form--BatchActionButton"
									onClick={(e) => e.stopPropagation()}
									title={localInstance.delete}
								>
									{localInstance.delete}
								</button>
							</ConfirmPopover>
						</>
					)}
					<div onClick={(e) => e.stopPropagation()}>
						{collapsed ? (
							<ChevronRight size={16} />
						) : (
							<ChevronDown size={16} />
						)}
					</div>
				</div>
			</div>
			{!collapsed && (
				<div className="form--SettingGroupContent">
					{props.children}
				</div>
			)}
		</div>
	);
}
