/**
 * AI自动补全功能配置
 */

/**
 * 补全显示样式类型
 */
export type DisplayStyle = 'transparent' | 'underline' | 'highlight';

/**
 * 补全后光标位置类型
 */
export type CursorPositionAfter = 'end' | 'stay';

/**
 * 自动补全功能设置接口
 */
export interface AutoCompletionSettings {
	/** 是否启用自动补全功能 */
	enabled: boolean;

	/** 默认使用的AI模型标识符(引用Tars配置的provider的tag) */
	defaultModel: string;

	/** 补全提示词模板 */
	promptTemplate: string;

	/** AI生成温度参数(0-1) */
	temperature: number;

	/** 补全内容最大长度(token数) */
	maxTokens: number;

	/** 请求超时时间(毫秒) */
	requestTimeout: number;

	/** 最大上下文长度(字符数) */
	maxContextLength: number;

	/** 补全显示样式 */
	displayStyle: DisplayStyle;

	/** 补全文本颜色(十六进制) */
	textColor: string;

	/** 补全文本背景色(十六进制) */
	backgroundColor: string;

	/** 补全文本透明度(0-1) */
	textOpacity: number;

	/** 是否自动接受短补全(少于5个字符) */
	autoAcceptShort: boolean;

	/** 补全后光标位置 */
	cursorPositionAfter: CursorPositionAfter;

	/** 防抖延迟时间(毫秒) */
	debounceDelay: number;

	/** 排除的文件扩展名列表 */
	excludeFileTypes: string[];

	/** 排除的文件夹路径列表 */
	excludeFolders: string[];
}

/**
 * 默认自动补全设置
 */
export const DEFAULT_AUTOCOMPLETION_SETTINGS: AutoCompletionSettings = {
	enabled: false,
	defaultModel: '',
	promptTemplate: '请根据以下上下文内容,自然地续写后续文本。只输出续写内容,不要重复上下文:\n\n{{context}}',
	temperature: 0.7,
	maxTokens: 150,
	requestTimeout: 15000,
	maxContextLength: 2000,
	displayStyle: 'transparent',
	textColor: '#87CEEB',
	backgroundColor: '#E6F3FF',
	textOpacity: 0.6,
	autoAcceptShort: false,
	cursorPositionAfter: 'end',
	debounceDelay: 500,
	excludeFileTypes: [],
	excludeFolders: []
};

/**
 * 克隆自动补全设置
 */
export function cloneAutoCompletionSettings(settings?: Partial<AutoCompletionSettings>): AutoCompletionSettings {
	return {
		...DEFAULT_AUTOCOMPLETION_SETTINGS,
		...settings
	};
}
