export enum VariableSource {
    FORM_FIELD = "formField",
    LOOP_VAR = "loopVar",
    AI_OUTPUT = "aiOutput",
    SUGGEST_MODAL = "suggestModal",
    INTERNAL = "internal",
    SYSTEM_RESERVED = "systemReserved"
}

export enum ConflictType {
    DUPLICATE = "duplicate",
    RESERVED = "reserved",
    FORMAT_INVALID = "formatInvalid",
    CROSS_SCOPE = "crossScope",
    SELF_CONFLICT = "selfConflict"
}

export interface VariableLocation {
    fieldId?: string;
    actionId?: string;
    actionType?: string;
    actionGroupId?: string;
    index?: number;
    path?: string;
}

export interface VariableInfo {
    name: string;
    source: VariableSource;
    sourceId?: string;
    description?: string;
    location?: VariableLocation;
    meta?: Record<string, any>;
    isReserved?: boolean;
}

export interface ConflictInfo {
    variableName: string;
    conflictType: ConflictType;
    items: VariableInfo[];
    suggestion?: string;
    messageKey?: string;
    details?: string[];
}

export interface VariableCollectOptions {
    includeInternal?: boolean;
    includeSystemReserved?: boolean;
    includeEmpty?: boolean;
}