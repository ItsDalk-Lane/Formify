/**
 * 多表单执行模式
 * 用于配置多个"调用表单"动作的执行方式
 */
export enum FormExecutionMode {
    /**
     * 依次执行（默认）
     * 每个表单提交后，其内部的动作链完整执行完成，才开始下一个表单的打开和执行
     */
    SEQUENTIAL = "sequential",
    
    /**
     * 同时执行
     * 所有表单的界面合并显示，用户一次性提交后，所有表单的动作链同时并行执行
     */
    PARALLEL = "parallel",
}
