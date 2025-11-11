import { IFormField } from "../IFormField";

export interface BaseTimeField extends IFormField {
    defaultValueType: TimeFieldDefaultValueType;
    enableSecondPrecision?: boolean;  // 是否启用秒级精度控制（仅适用于 TIME 类型字段）
}

export enum TimeFieldDefaultValueType {
    CURRENT = "current",
    CUSTOM = "custom",
}