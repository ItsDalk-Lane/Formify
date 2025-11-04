import React from "react";
import { TargetMode } from "src/model/enums/TargetMode";
import { localInstance } from "src/i18n/locals";

type TargetModeSelectProps = {
    value: TargetMode;
    onChange: (value: TargetMode) => void;
    disabled?: boolean;
    className?: string;
};

export function TargetModeSelect(props: TargetModeSelectProps) {
    const { value, onChange, disabled, className } = props;

    return (
        <select
            className={`dropdown ${className || ""}`}
            value={value}
            disabled={disabled}
            onChange={(event) => {
                onChange(event.target.value as TargetMode);
            }}
        >
            <option value={TargetMode.CURRENT}>{localInstance.in_current_file}</option>
            <option value={TargetMode.SPECIFIED}>{localInstance.in_specified_file}</option>
        </select>
    );
}

