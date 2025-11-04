/**
 * 文本操作类型
 * 定义文本动作支持的操作类型
 */
export enum TextOperationType {
    /**
     * 复制富文本（包含格式和base64图片）
     * 适用于Word、微信公众号等富文本编辑器
     */
    COPY_RICH_TEXT = "COPY_RICH_TEXT",

    /**
     * 复制Markdown格式
     * 将Obsidian内部图片转为标准Markdown链接
     */
    COPY_MARKDOWN = "COPY_MARKDOWN",

    /**
     * 导出为HTML文件
     * 保存为完整的HTML文件，包含样式和图片
     */
    EXPORT_HTML = "EXPORT_HTML",

    /**
     * 复制纯文本（移除所有Markdown格式）
     * 移除所有Markdown文档格式标记，转换为纯文本并复制到剪贴板
     */
    COPY_PLAIN_TEXT = "COPY_PLAIN_TEXT",

    /**
     * 在中英文之间添加空格
     * 自动为中文字符和英文字母之间添加空格
     */
    ADD_SPACES_BETWEEN_CJK_AND_ENGLISH = "ADD_SPACES_BETWEEN_CJK_AND_ENGLISH",
}
