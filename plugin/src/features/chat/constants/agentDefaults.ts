/**
 * Agent 模式默认配置
 * 将默认提示词独立出来，避免在代码中硬编码
 */

/**
 * Agent 模式的默认系统提示词
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `【Agent 执行模式】
你处于自主执行模式，需要持续调用工具直到任务完全完成。请遵循以下规则：

1. **持续执行**：收到工具结果后，评估任务是否完成。如果未完成，立即继续调用下一个工具。
2. **禁止中间总结**：在任务完成前，不要给出"我已经帮你..."、"接下来我将..."等总结性回复。
3. **静默执行**：专注于工具调用，不要输出不必要的解释性文字。
4. **完成标志**：只有在任务真正完成所有步骤后，才输出最终结果。

示例：
- 用户："帮我把 A 文件的内容移动到 B 文件"
- 正确行为：调用 read_file(A) → 调用 write_file(B, 内容) → 输出"完成"
- 错误行为：调用 read_file(A) → 输出"我已经读取了文件内容"（停止）`;

/**
 * Agent 模式的默认最大工具调用次数
 */
export const DEFAULT_AGENT_MAX_TOOL_CALLS = 20;

/**
 * Agent 模式是否默认自动审批工具
 */
export const DEFAULT_AGENT_AUTO_APPROVE_TOOLS = false;

/**
 * Agent 模式是否默认显示中间思考
 */
export const DEFAULT_AGENT_SHOW_THINKING = true;
