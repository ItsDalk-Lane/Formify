import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import "./CpsFormSetting.css";

export function CpsFormSettingGroup(props: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
	defaultCollapsed?: boolean;
}) {
	const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? true);

	return (
		<div className="form--CpsFormSettingGroup">
			<div 
				className="form--SettingGroupHeader"
				onClick={() => setCollapsed(!collapsed)}
				style={{ cursor: "pointer" }}
			>
				{props.icon}
				{props.title}
				<div style={{ marginLeft: "auto" }}>
					{collapsed ? (
						<ChevronRight size={16} />
					) : (
						<ChevronDown size={16} />
					)}
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
