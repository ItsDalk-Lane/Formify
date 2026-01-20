import type { FileIntentAnalysis, FileRole } from '../types/chat';

/**
 * 文件意图分析器
 * 通过分析提示词模板特征，判断文件的预期用途
 */
export class FileIntentAnalyzer {

  /**
   * 分析提示词模板特征，推断文件角色
   * @param template 提示词模板内容
   * @returns 文件意图分析结果
   */
  analyzePromptIntent(template: string): FileIntentAnalysis {
    if (!template || template.trim().length === 0) {
      return this.createAnalysis('reference', '空模板，默认作为参考资料', 'low');
    }

    // 规则1: 角色定义类模板 → 文件为待处理数据
    if (this.isRoleDefinitionTemplate(template)) {
      return this.createAnalysis(
        'processing_target',
        '检测到角色定义类提示词，文件应作为待处理数据',
        'high'
      );
    }

    // 规则2: 任务指令类模板 → 根据指令关键词判断
    if (this.isTaskInstructionTemplate(template)) {
      return this.analyzeTaskIntent(template);
    }

    // 规则3: 包含明确文件引用标记
    if (this.hasExplicitFileReference(template)) {
      return this.createAnalysis(
        'processing_target',
        '提示词明确引用了文件内容',
        'high'
      );
    }

    // 规则4: 包含示例相关关键词
    if (this.isExampleTemplate(template)) {
      return this.createAnalysis(
        'example',
        '检测到示例类关键词，文件作为示例参考',
        'medium'
      );
    }

    // 默认: 参考资料角色
    return this.createAnalysis(
      'reference',
      '未检测到明确的处理意图，文件作为参考资料',
      'medium'
    );
  }

  /**
   * 判断是否为角色定义类模板
   * 特征："你是..."、"你扮演..."、"你作为..."等
   */
  private isRoleDefinitionTemplate(template: string): boolean {
    const rolePatterns = [
      // 中文角色定义
      /你\s*是\s*(一位|一个)?/,
      /你\s*扮演\s*/,
      /你\s*作为\s*/,
      /你是\s*(资深|专业|经验丰富|优秀)/,
      /你\s*充当/,
      /作为\s*(一位|一个)?\s*(专业|资深)?/,
      // 英文角色定义
      /you\s+are\s+(a|an)?\s*/i,
      /act\s+as\s+(a|an)?\s*/i,
      /role:\s*\w+/i,
      /persona:\s*\w+/i
    ];
    return rolePatterns.some(pattern => pattern.test(template));
  }

  /**
   * 判断是否为任务指令类模板
   * 特征："请分析..."、"请总结..."、"基于..."等
   */
  private isTaskInstructionTemplate(template: string): boolean {
    const taskPatterns = [
      // 中文任务指令
      /请\s*(分析|总结|提取|生成|创建|处理|翻译|重写|改写)/,
      /(分析|总结|提取|处理)\s*(以下|这篇|上述|下面)/,
      /基于\s*(提供|给定|以下|上述)/,
      /对\s*(以下|这篇|上述).*(进行|执行)/,
      /阅读\s*(以下|这篇|上述)/,
      /根据\s*(以下|这篇|上述)/,
      // 英文任务指令
      /please\s+(analyze|summarize|extract|process|translate)/i,
      /based\s+on\s+(the|this|these)/i,
      /(analyze|summarize|process)\s+(the\s+)?following/i
    ];
    return taskPatterns.some(pattern => pattern.test(template));
  }

  /**
   * 分析任务指令的具体意图
   */
  private analyzeTaskIntent(template: string): FileIntentAnalysis {
    // 处理类关键词（高优先级）
    const processingKeywords = [
      // 中文
      '分析', '处理', '总结', '提取', '生成', '转换', '翻译', '重写', '改写',
      '优化', '修改', '整理', '归纳', '概括', '解读', '解析', '评估', '审阅',
      // 英文
      'analyze', 'process', 'summarize', 'extract', 'generate', 'transform',
      'translate', 'rewrite', 'optimize', 'modify', 'review', 'evaluate'
    ];
    
    const lowerTemplate = template.toLowerCase();
    const hasProcessingKeyword = processingKeywords.some(kw => 
      lowerTemplate.includes(kw.toLowerCase())
    );

    if (hasProcessingKeyword) {
      return this.createAnalysis(
        'processing_target',
        '检测到处理类任务关键词',
        'high'
      );
    }

    // 查询类关键词（中等优先级）
    const queryKeywords = ['查找', '搜索', '检索', '寻找', 'find', 'search', 'lookup'];
    const hasQueryKeyword = queryKeywords.some(kw => 
      lowerTemplate.includes(kw.toLowerCase())
    );

    if (hasQueryKeyword) {
      return this.createAnalysis(
        'reference',
        '检测到查询类任务，文件作为参考数据源',
        'medium'
      );
    }

    return this.createAnalysis(
      'reference',
      '任务类模板，但未明确要求处理文件',
      'medium'
    );
  }

  /**
   * 检测是否包含明确的文件引用标记
   */
  private hasExplicitFileReference(template: string): boolean {
    const referencePatterns = [
      /\{\{.*\}\}/,              // 占位符 {{}}
      /\$\{.*\}/,                // 模板字符串 ${}
      /<file>.*<\/file>/i,       // 文件标签
      /\[文件\]|\[file\]/i,      // 文件引用标记
      /附件|attachment/i,         // 附件关键词
      /以下\s*文件/,              // 明确引用
      /下面\s*的?\s*文件/,
      /用户\s*(提供|上传)\s*的?\s*文件/,
      /文件\s*内容/
    ];
    return referencePatterns.some(pattern => pattern.test(template));
  }

  /**
   * 检测是否为示例类模板
   */
  private isExampleTemplate(template: string): boolean {
    const examplePatterns = [
      /示例|样例|范例|模板/,
      /example|sample|template/i,
      /参照\s*(以下|这个)/,
      /按照\s*(这个|以下)\s*(格式|风格)/,
      /仿照|模仿|学习.*风格/
    ];
    return examplePatterns.some(pattern => pattern.test(template));
  }

  /**
   * 创建分析结果对象
   */
  private createAnalysis(
    role: FileRole, 
    reasoning: string, 
    confidence: 'high' | 'medium' | 'low'
  ): FileIntentAnalysis {
    return { role, reasoning, confidence };
  }

  /**
   * 获取文件角色的本地化名称
   */
  getFileRoleDisplayName(role: FileRole): string {
    const names: Record<FileRole, string> = {
      processing_target: '待处理数据',
      reference: '参考资料',
      example: '示例',
      context: '上下文背景'
    };
    return names[role] ?? '未知';
  }
}
