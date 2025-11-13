import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
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
	onDeleteSelected?: () => void;
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
						<ConfirmPopover onConfirm={() => {
							if (props.onDeleteSelected) props.onDeleteSelected();
						}}>
							<button
								className="form--BatchActionButton"
								onClick={(e) => e.stopPropagation()}
								title={localInstance.delete}
							>
								<Trash2 size={16} />
							</button>
						</ConfirmPopover>
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
