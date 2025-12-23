export type ConflictKind = "variable" | "commandId";

export type ConflictItem = {
  filePath: string;
  fileName: string;
  /**
   * 变量冲突时，尽可能提供变量来源路径（例如 actions.0.fields.2）
   */
  detailPath?: string;
  /**
   * 变量冲突时的来源类型（FORM_FIELD / LOOP_VAR / ...）
   */
  source?: string;
};

export type DetectedConflict = {
  kind: ConflictKind;
  /** 冲突名称：变量名或命令ID */
  name: string;
  /** 冲突子类型：变量冲突类型（DUPLICATE/RESERVED/CROSS_SCOPE/SELF_CONFLICT）或固定为 DUPLICATE */
  conflictType: string;
  items: ConflictItem[];
};
