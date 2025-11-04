/**
 * 文本转换工具类
 * 提供各种文本格式转换功能
 */
export class TextConverter {
    /**
     * 移除所有Markdown格式标记，转换为纯文本
     * @param content Markdown内容
     * @returns 纯文本内容
     */
    static removeAllMarkdownFormats(content: string): string {
        let result = content;

        // 移除frontmatter格式符号（保留内容）
        // 匹配 ---\n 内容 \n--- 并保留中间的内容
        result = result.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/m, "$1\n");

        // 移除HTML注释格式符号（保留内容）
        result = result.replace(/<!--([\s\S]*?)-->/g, "$1");

        // 移除Obsidian注释格式符号（保留内容）
        result = result.replace(/%%\s*([\s\S]*?)\s*%%/g, "$1");

        // 移除代码块（保留内容）
        result = result.replace(/```[\s\S]*?\n([\s\S]*?)```/g, "$1");

        // 移除行内代码（保留内容）
        result = result.replace(/`([^`]+?)`/g, "$1");

        // 移除标题标记（保留内容）
        result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

        // 移除加粗（保留内容）
        result = result.replace(/\*\*(.+?)\*\*/g, "$1");
        result = result.replace(/__(.+?)__/g, "$1");

        // 移除斜体（保留内容）
        result = result.replace(/\*(.+?)\*/g, "$1");
        result = result.replace(/_(.+?)_/g, "$1");

        // 移除删除线（保留内容）
        result = result.replace(/~~(.+?)~~/g, "$1");

        // 移除高亮（保留内容）
        result = result.replace(/==(.+?)==/g, "$1");

        // 移除链接（保留链接文本）
        result = result.replace(/\[([^\]]*?)\]\([^)]*?\)/g, "$1");

        // 移除图片（保留alt文本）
        result = result.replace(/!\[([^\]]*?)\]\([^)]*?\)/g, "$1");

        // 移除Obsidian内部链接（保留链接文本）
        result = result.replace(/\[\[([^\]|]*?)(?:\|([^\]]*?))?\]\]/g, (match, link, alias) => {
            return alias || link;
        });

        // 移除Obsidian嵌入（保留名称）
        result = result.replace(/!\[\[([^\]]*?)\]\]/g, "$1");

        // 移除引用标记（保留内容）
        result = result.replace(/^>+\s?(.*)$/gm, "$1");

        // 移除列表标记（保留内容）
        result = result.replace(/^\s*([-+*]|\d+[.)])\s+/gm, "");

        // 移除任务列表标记（保留内容）
        result = result.replace(/^\s*- \[[ xX]\]\s+/gm, "");

        // 移除表格（转换为简单文本）
        result = result.replace(/^\|(.+?)\|$/gm, (match, content) => {
            return content.replace(/\s*\|\s*/g, " ").trim();
        });
        result = result.replace(/^\s*[:|-]+\s*$/gm, "");

        // 移除脚注引用
        result = result.replace(/\[\^[^\]]+?\]/g, "");
        result = result.replace(/^\[\^[^\]]+?\]:.*$/gm, "");

        // 移除数学公式（保留内容）
        result = result.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
        result = result.replace(/\$(.+?)\$/g, "$1");

        // 移除分隔线
        result = result.replace(/^[-*_]{3,}\s*$/gm, "");

        // 移除标签
        result = result.replace(/#[\w\u4e00-\u9fa5]+/g, "");

        // 清理多余的空行（保留最多一个空行）
        result = result.replace(/\n{3,}/g, "\n\n");

        // 清理行首行尾空白
        result = result.trim();

        return result;
    }

    /**
     * 在中文字符和英文字母之间添加空格
     * @param content 原始内容
     * @returns 处理后的内容
     */
    static addSpacesBetweenCJKAndEnglish(content: string): string {
        let result = content;

        // 中文字符范围（包含CJK统一表意文字和扩展）
        // \u4e00-\u9fff: CJK统一表意文字
        // \u3400-\u4dbf: CJK扩展A
        // \uf900-\ufaff: CJK兼容表意文字
        const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
        
        // 英文字母和数字
        const alphanumericRegex = /[a-zA-Z0-9]/;

        // 在中文后面添加空格（如果后面紧跟英文/数字）
        result = result.replace(
            /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])([a-zA-Z0-9])/g,
            "$1 $2"
        );

        // 在英文/数字后面添加空格（如果后面紧跟中文）
        result = result.replace(
            /([a-zA-Z0-9])([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g,
            "$1 $2"
        );

        // 处理已有空格的情况，避免重复添加空格
        result = result.replace(/  +/g, " ");

        return result;
    }

    /**
     * 组合处理：先移除格式，再添加空格
     * @param content 原始内容
     * @returns 处理后的内容
     */
    static convertToPlainTextWithSpacing(content: string): string {
        let result = this.removeAllMarkdownFormats(content);
        result = this.addSpacesBetweenCJKAndEnglish(result);
        return result;
    }
}
