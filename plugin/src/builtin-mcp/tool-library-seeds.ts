import {
	BUILTIN_MEMORY_SERVER_ID,
	BUILTIN_MEMORY_SERVER_NAME,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_ID,
	BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_ID,
	BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME,
	BUILTIN_TOOL_SEARCH_SERVER_ID,
	BUILTIN_TOOL_SEARCH_SERVER_NAME,
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
} from './constants';
import type { ToolLibraryExample, ToolLibrarySeed } from './tool-library-types';

type BodySections = {
	avoid?: string[];
	confusions?: string[];
	notes?: string[];
};

type SeedSpec = {
	name: string;
	keywords: string[];
	scenarios: string[];
	decisionGuide: string[];
	capabilities: string[];
	examples: ToolLibraryExample[];
	summary: string;
	body?: BodySections;
};

const buildBody = (summary: string, sections?: BodySections): string => {
	const blocks = [summary.trim()];

	if (sections?.avoid?.length) {
		blocks.push(`## 不适用场景\n${sections.avoid.map((item) => `- ${item}`).join('\n')}`);
	}

	if (sections?.confusions?.length) {
		blocks.push(`## 常见混淆\n${sections.confusions.map((item) => `- ${item}`).join('\n')}`);
	}

	if (sections?.notes?.length) {
		blocks.push(`## 使用提醒\n${sections.notes.map((item) => `- ${item}`).join('\n')}`);
	}

	return blocks.join('\n\n');
};

const defineSeed = (
	serverId: string,
	serverName: string,
	category: string,
	spec: SeedSpec
): ToolLibrarySeed => ({
	name: spec.name,
	serverId,
	serverName,
	category,
	keywords: spec.keywords,
	scenarios: spec.scenarios,
	decisionGuide: spec.decisionGuide,
	capabilities: spec.capabilities,
	examples: spec.examples,
	body: buildBody(spec.summary, spec.body),
});

const vaultFileSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'file', {
		name: 'read_file',
		keywords: ['读取文件', '查看文件内容', 'read file', '文件片段', '读取笔记'],
		scenarios: ['查看某个文件的正文', '只读取文件的一部分内容', '先确认文件内容再决定后续操作'],
		decisionGuide: ['当目标是读取指定文件内容时优先使用它。', '如果你还不知道路径，应先用搜索工具或 list_directory 定位文件。'],
		capabilities: ['读取完整文件', '支持 offset/length 截取', '适合精确查看单个文件'],
		examples: [
			{
				title: '读取会议记录前 500 个字符',
				args: { path: 'Projects/会议记录.md', offset: 0, length: 500 },
				summary: '先快速确认文件开头内容。',
			},
		],
		summary: '用于读取 Vault 中某个已知路径文件的内容；如果你已经知道文件路径，这是最直接的查看工具。',
		body: {
			avoid: ['不要用它做全库搜索。', '不要在只知道文件名关键字时直接调用。'],
			confusions: ['与 search_content 的区别是：read_file 需要已知路径，search_content 负责找内容。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'file', {
		name: 'write_file',
		keywords: ['写入文件', '创建文件', '更新文件', 'append file', 'write file'],
		scenarios: ['把内容写进指定笔记', '新建一份 markdown 文件', '向现有文件末尾追加内容'],
		decisionGuide: ['当目标是创建或改写某个文件时使用它。', '如果只想移动/重命名文件，不要用它，改用 move_file。'],
		capabilities: ['覆盖写入', '追加写入', '自动创建缺失父目录'],
		examples: [
			{
				title: '创建日报文件',
				args: { path: 'Daily/2026-03-08.md', content: '# 2026-03-08\n', mode: 'write' },
				summary: '创建新文件并写入正文。',
			},
		],
		summary: '用于创建文件或写入文件正文，适合明确知道目标路径并需要真正落盘的场景。',
		body: {
			avoid: ['不要把它当成“打开文件”工具。', '不要用它删除旧内容之外的文件结构。'],
			confusions: ['与 read_file 相反，它会修改 Vault。', '与 move_file 不同，它不会保留原文件内容和路径关系。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'file', {
		name: 'delete_file',
		keywords: ['删除文件', '删除目录', 'remove file', '删除笔记', '清理文件夹'],
		scenarios: ['删除一篇无用笔记', '递归删除某个临时目录', '清理明确指定的文件路径'],
		decisionGuide: ['只有在明确需要删除文件或文件夹时使用它。', '如果只是移动到新位置，不要删除后再重写，改用 move_file。'],
		capabilities: ['删除文件', '删除文件夹', '支持 force 递归删除'],
		examples: [
			{
				title: '删除临时目录',
				args: { path: 'Temp/草稿', force: true },
				summary: '递归删除整个目录。',
			},
		],
		summary: '这是破坏性工具，只适合路径已确认、用户明确要求删除的场景。',
		body: {
			avoid: ['不适合做“可能删除”或模糊清理。', '不适合先搜索再决定是否删除的探索阶段。'],
			notes: ['执行前应尽量确认路径和删除范围。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'file', {
		name: 'move_file',
		keywords: ['移动文件', '重命名文件', 'rename file', 'move file', '整理路径'],
		scenarios: ['把笔记移到新目录', '修改文件名', '整理 Vault 路径结构'],
		decisionGuide: ['当目标是保留原内容但改变路径或名称时使用它。', '如果要改正文内容，应配合 read_file/write_file。'],
		capabilities: ['移动文件', '重命名文件', '移动文件夹'],
		examples: [
			{
				title: '重命名会议记录',
				args: { source: 'Inbox/meeting.md', destination: 'Projects/会议记录.md' },
				summary: '保留文件内容，仅调整路径。',
			},
		],
		summary: '用于路径层面的变更：移动和重命名，而不是修改正文。',
		body: {
			confusions: ['与 write_file 不同，它不写内容。', '与 open_file 不同，它会改变实际存储位置。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'file', {
		name: 'list_directory',
		keywords: ['列出目录', '查看文件夹', 'list directory', '浏览目录', '目录清单'],
		scenarios: ['查看某目录下有哪些文件', '配合 regex 过滤名称', '先浏览目录再决定操作对象'],
		decisionGuide: ['当你知道目录但不知道具体文件时使用它。', '如果要全库按内容搜索，改用搜索类工具。'],
		capabilities: ['列出直接子项', '返回文件与文件夹元信息', '支持 regex 名称过滤'],
		examples: [
			{
				title: '查看 Projects 目录',
				args: { path: 'Projects' },
				summary: '返回目录下的直接子项。',
			},
		],
		summary: '适合目录级浏览，不适合在大量文件正文中查关键词。',
		body: {
			confusions: ['与 search_folder 的区别是：list_directory 需要已知目录路径，search_folder 负责模糊找文件夹。'],
		},
	}),
];

const vaultNavSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'nav', {
		name: 'open_file',
		keywords: ['打开文件', '打开笔记', 'open file', '在 Obsidian 打开'],
		scenarios: ['把某篇笔记打开到界面中', '切换到指定文件', '让用户在 Obsidian 里看到目标文档'],
		decisionGuide: ['当目标是导航到文件界面而不是读取文本时使用它。', '如果只需要文本内容，优先 read_file。'],
		capabilities: ['打开文件', '支持新面板打开', '用于界面导航'],
		examples: [
			{
				title: '在新面板打开文档',
				args: { path: 'Projects/Roadmap.md', new_panel: true },
				summary: '在 Obsidian 新分栏里打开文件。',
			},
		],
		summary: '这是导航工具，不返回文件正文，适合把用户带到某个文件位置。',
		body: {
			confusions: ['与 read_file 不同，open_file 侧重界面导航，不是内容读取。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'nav', {
		name: 'get_first_link_path',
		keywords: ['解析内部链接', 'wiki 链接路径', '解析双链', 'link path'],
		scenarios: ['把 [[页面]] 解析成真实路径', '处理内部链接后继续 read_file/open_file', '确认链接指向的目标文件'],
		decisionGuide: ['当输入是 Obsidian 内部链接文本时使用它。', '如果已经有实际路径，则不需要先解析链接。'],
		capabilities: ['解析 wiki link', '兼容当前活动文件上下文', '返回真实文件路径'],
		examples: [
			{
				title: '解析内部链接',
				args: { internalLink: 'Roadmap' },
				summary: '返回当前上下文里第一个匹配路径。',
			},
		],
		summary: '它负责把内部链接文本转成路径，通常作为 read_file 或 open_file 的前置步骤。',
		body: {
			confusions: ['不要用它做全库搜索。', '它只负责“链接解析”，不负责读取目标文件。'],
		},
	}),
];

const vaultQuerySeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'query', {
		name: 'query_vault',
		keywords: ['查询 vault', '元数据查询', 'dsl 查询', 'query vault', '聚合统计'],
		scenarios: ['按元数据做结构化筛选', '对文件集合做 count/sum/groupBy', '需要 DSL 查询而不是关键词搜索'],
		decisionGuide: ['当目标是结构化查询、聚合或排序时使用它。', '如果只是普通关键词搜索，优先搜索类工具。'],
		capabilities: ['基于 DSL 的结构化查询', '支持聚合统计', '可对元数据做复杂过滤'],
		examples: [
			{
				title: '统计已完成项目数量',
				args: { expression: "from('files').where(f => f.properties.status === 'done').count()" },
				summary: '使用 DSL 做结构化统计。',
			},
		],
		summary: '适合“像查询数据库一样”查询 Vault 元数据，而不是用自然语言关键字翻文件。',
		body: {
			confusions: ['与 search_properties 的区别是：query_vault 适合复杂结构化查询和聚合，search_properties 更像快速属性筛选。'],
		},
	}),
];

const vaultScriptSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'script', {
		name: 'execute_script',
		keywords: ['执行脚本', 'javascript 脚本', 'script', '自定义逻辑', '批量调用工具'],
		scenarios: ['需要组合多个工具并写逻辑', '一次调用中做循环或条件判断', '已有明确脚本片段要在沙箱运行'],
		decisionGuide: ['只有在单个现成工具不够、需要编排逻辑时才使用它。', '能用普通工具直接完成时不要先上脚本。'],
		capabilities: ['运行 JavaScript', '调用其他 MCP 工具', '支持编排复杂步骤'],
		examples: [
			{
				title: '脚本里调用读取工具',
				args: { script: "const text = await call_tool('read_file', { path: 'Inbox/todo.md' }); return text;" },
				summary: '在沙箱里编排其他工具。',
			},
		],
		summary: '它适合“工具编排”而不是“单步操作”；如果你已经知道明确的单个工具，就不要多包一层脚本。',
		body: {
			avoid: ['不要用它替代 read_file、write_file 这类已有明确职责的工具。'],
			confusions: ['与 call_shell 不同，execute_script 在沙箱里执行 JavaScript，不直接跑系统 shell。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'script', {
		name: 'call_shell',
		keywords: ['执行命令', 'shell', 'terminal', '命令行', 'call shell'],
		scenarios: ['需要在桌面端运行 shell 命令', '调用 git、npm、ls 等系统命令', '工作目录要指向 Vault 或其子目录'],
		decisionGuide: ['当任务必须依赖系统命令时使用它。', '如果只是在 Vault 内读写文件，优先用专门的 Vault 工具。'],
		capabilities: ['运行 shell 命令', '支持设置 cwd', '返回 stdout/stderr/exitCode'],
		examples: [
			{
				title: '列出当前目录文件',
				args: { command: 'ls', cwd: 'Projects' },
				summary: '在 Vault 子目录执行命令。',
			},
		],
		summary: '这是桌面端系统命令工具，适合必须依赖外部命令的任务。',
		body: {
			avoid: ['不适合移动端。', '不适合用来替代现成的 Vault 文件工具。'],
			confusions: ['与 execute_script 不同，它直接调用系统 shell。'],
		},
	}),
];

const vaultUtilSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'util', {
		name: 'now',
		keywords: ['当前时间', '时间转换', '时区时间', 'now', 'timezone'],
		scenarios: ['获取当前时间', '在时区间转换时间', '给计划或日志补当前时间戳'],
		decisionGuide: ['当你需要可靠时间信息而不是模型猜测时使用它。', '如果任务与时间无关，不要调用。'],
		capabilities: ['返回当前时间', '支持格式化', '支持时区转换'],
		examples: [
			{
				title: '查询上海当前时间',
				args: { timezone: 'Asia/Shanghai' },
				summary: '返回结构化时区时间信息。',
			},
		],
		summary: '适合所有需要精确时间或时区换算的场景。',
		body: {
			confusions: ['与 write_plan 不同，now 只提供时间信息，不维护计划。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'util', {
		name: 'write_plan',
		keywords: ['写计划', '任务计划', 'plan', '更新计划', '任务拆解'],
		scenarios: ['创建结构化任务计划', '更新当前步骤状态', '让计划面板与会话同步'],
		decisionGuide: ['当任务需要显式计划状态时使用它。', '不要用它替代普通文本回复。'],
		capabilities: ['创建计划', '更新任务状态', '支持 acceptance criteria 和 outcome'],
		examples: [
			{
				title: '创建两步计划',
				args: {
					title: '清理标签',
					tasks: [
						{ name: '扫描重复标签', status: 'in_progress' },
						{ name: '合并标签', status: 'todo' },
					],
				},
				summary: '创建或更新内存态任务计划。',
			},
		],
		summary: '用于维护会话级计划状态，适合多步骤任务，不适合文件搜索或内容修改。',
		body: {
			confusions: ['与 delegate_to_agent 不同，write_plan 不执行任务，只维护计划。'],
		},
	}),
	defineSeed(BUILTIN_VAULT_SERVER_ID, BUILTIN_VAULT_SERVER_NAME, 'util', {
		name: 'delegate_to_agent',
		keywords: ['委托代理', 'delegate', '子代理', 'agent'],
		scenarios: ['把任务转交给已注册代理', '需要调用内置代理能力', '由代理接手后续执行'],
		decisionGuide: ['只有在确实存在合适代理时才使用它。', '普通文件操作或搜索不要绕到代理。'],
		capabilities: ['向代理派发任务', '返回代理执行结果', '适合代理分工场景'],
		examples: [
			{
				title: '委托默认代理',
				args: { id: 'builtin.echo', task: '回显当前任务说明' },
				summary: '把任务交给指定代理。',
			},
		],
		summary: '这是代理分发工具，不是普通执行工具；只有在代理协作链路里才值得调用。',
		body: {
			avoid: ['不适合简单单步任务。'],
		},
	}),
];

const searchSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_files',
		keywords: ['文件名搜索', '按文件名查找', 'search files', '标题搜索'],
		scenarios: ['只知道文档标题或文件名', '想按文件名查找笔记', '不想搜索正文'],
		decisionGuide: ['当目标是文件名而不是正文时使用它。', '如果关键词可能在正文里，改用 search_content 或 quick_search。'],
		capabilities: ['只匹配 file: 范围', '适合标题命名规范的 Vault', '支持高级子查询'],
		examples: [
			{
				title: '按文件名找日报',
				args: { query: '日报 2026', maxResults: 10 },
				summary: '仅在文件名范围查找。',
			},
		],
		summary: '专门按文件名查找，不会检索正文内容。',
		body: {
			confusions: ['与 search_path 的区别是：search_files 看文件名，search_path 看完整路径。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_path',
		keywords: ['路径搜索', '目录层级搜索', 'search path', '完整路径'],
		scenarios: ['已知路径片段', '想按目录层级定位文件', '文件名不稳定但路径结构稳定'],
		decisionGuide: ['当你记得目录结构或路径片段时使用它。', '如果只记得标题，优先 search_files。'],
		capabilities: ['匹配完整 path:', '适合目录组织型 Vault', '支持复杂路径子查询'],
		examples: [
			{
				title: '查找 Projects 路径下文件',
				args: { query: 'Projects/ClientA' },
				summary: '按完整路径片段搜索。',
			},
		],
		summary: '适合根据目录结构找文件，重点是路径而非正文。',
		body: {
			confusions: ['与 search_folder 相比，search_path 更适合匹配完整路径片段。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_folder',
		keywords: ['文件夹搜索', '按目录名查找', 'search folder', '目录名称'],
		scenarios: ['只记得文件夹名', '想找某个文件夹或其下文件', '按目录名称定位资料'],
		decisionGuide: ['当关键字针对“文件夹名称”时使用它。', '如果你要浏览已知目录内容，优先 list_directory。'],
		capabilities: ['匹配 folder:', '适合目录名称搜索', '可返回位于该目录的文件'],
		examples: [
			{
				title: '查找 Archive 文件夹相关内容',
				args: { query: 'Archive' },
				summary: '按文件夹名称搜索。',
			},
		],
		summary: '它关注目录名，而不是文件名或正文。',
		body: {
			confusions: ['与 list_directory 不同，search_folder 可做模糊目录搜索。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_content',
		keywords: ['正文搜索', '内容搜索', 'search content', '全文搜索', '文本搜索'],
		scenarios: ['按正文关键字找笔记', '明确信息在正文而不是标题', '需要在文章内容中定位信息'],
		decisionGuide: ['当核心目标是正文内容匹配时使用它。', '如果需要标签、属性或任务专门语义，优先对应专用工具。'],
		capabilities: ['只匹配 content:', '适合全文关键字搜索', '不会匹配文件名与路径'],
		examples: [
			{
				title: '按正文搜索上线方案',
				args: { query: '上线方案', contextLines: 2 },
				summary: '只在正文里找关键字。',
			},
		],
		summary: '这是最常用的正文搜索工具，适合“内容在文中”的场景。',
		body: {
			confusions: ['与 quick_search 的区别是：search_content 明确限定正文范围。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_tags',
		keywords: ['标签搜索', 'tag 搜索', 'search tags', '#tag'],
		scenarios: ['按标签组织内容', '查找拥有某标签的笔记', '用户明确提到 tag 或 #标签'],
		decisionGuide: ['只要需求显式围绕标签，就优先它。', '如果只是正文里包含井号文本，不一定是标签场景。'],
		capabilities: ['匹配 tag:', '支持 #tag 与普通关键词', '适合标签驱动检索'],
		examples: [
			{
				title: '查找 #project 标签',
				args: { query: '#project' },
				summary: '按标签返回相关文件。',
			},
		],
		summary: '专门处理标签搜索，不要把普通正文关键字错交给它。',
		body: {
			confusions: ['与 tag_search 功能相近；优先保留一种命名时，search_tags 更强调操作符语义。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_line',
		keywords: ['同一行搜索', '行级搜索', 'search line', '同行匹配'],
		scenarios: ['要求关键词出现在同一行', '日志/表格/清单按行匹配', '想减少跨段误命中'],
		decisionGuide: ['当“同一行内同时满足条件”是关键限制时使用它。', '普通全文搜索不必上升到 line 级别。'],
		capabilities: ['限定 line:', '适合同一行组合条件', '减少跨行误匹配'],
		examples: [
			{
				title: '搜索同一行包含 foo 和 bar',
				args: { query: 'foo OR bar' },
				summary: '把查询限定在单行范围。',
			},
		],
		summary: '当匹配范围必须锁在单行时使用，适合日志、CSV 风格文本和任务清单。',
		body: {
			confusions: ['与 search_block / search_section 相比，它的范围最小。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_block',
		keywords: ['块级搜索', '同一块搜索', 'search block', 'markdown block'],
		scenarios: ['要求关键词出现在同一个 Markdown 块', '列表项或段落块内组合匹配', '不希望跨块误命中'],
		decisionGuide: ['当范围应是一个 Markdown block 时使用它。', '如果要整章范围，改用 search_section。'],
		capabilities: ['限定 block:', '适合同一段或列表块匹配', '比 line 更宽、比 section 更窄'],
		examples: [
			{
				title: '在同一块内搜索规格与预算',
				args: { query: '规格 预算' },
				summary: '限制匹配出现在一个 Markdown 块内。',
			},
		],
		summary: '适合段落、列表块、引用块等块级范围搜索。',
		body: {
			confusions: ['与 search_line 相比更宽，与 search_section 相比更窄。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_section',
		keywords: ['章节搜索', '标题下搜索', 'search section', '同一章节'],
		scenarios: ['要求命中内容位于同一标题章节', '按标题区块查找', '不希望跨章节误匹配'],
		decisionGuide: ['当搜索范围应是某个 Markdown 标题章节时使用它。', '如果无需章节约束，search_content 更简单。'],
		capabilities: ['限定 section:', '适合标题结构化文档', '支持章节级组合匹配'],
		examples: [
			{
				title: '在同一章节里找风险和缓解',
				args: { query: '风险 缓解' },
				summary: '把匹配限制在一个 Markdown 章节。',
			},
		],
		summary: '适合按标题结构组织的文档，要求多个条件出现在同一章节内。',
		body: {
			confusions: ['与 search_content 相比，search_section 会额外约束章节边界。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_tasks',
		keywords: ['任务搜索', '待办搜索', 'task 搜索', 'todo 搜索', '已完成任务'],
		scenarios: ['查找未完成任务', '筛选已完成任务', '围绕 Markdown 任务项检索'],
		decisionGuide: ['当用户提到任务、待办、完成状态时优先它。', '不要用普通正文搜索替代任务语义搜索。'],
		capabilities: ['支持 all/todo/done 三种模式', '匹配 task: 语义', '适合清单类场景'],
		examples: [
			{
				title: '查找未完成发布任务',
				args: { query: '发布', taskStatus: 'todo' },
				summary: '按任务状态筛选任务项。',
			},
		],
		summary: '专门搜索任务项，尤其适合“未完成/已完成”这类状态型需求。',
		body: {
			confusions: ['与 search_content 不同，它理解 Markdown task 的状态语义。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'search_properties',
		keywords: ['属性搜索', 'frontmatter 搜索', 'property 搜索', '元数据筛选', '字段筛选'],
		scenarios: ['按 frontmatter 字段筛选文件', '查找某属性存在或为空', '做简单数值比较'],
		decisionGuide: ['当需求明确提到 frontmatter 属性、字段值、比较条件时使用它。', '复杂聚合统计改用 query_vault。'],
		capabilities: ['属性存在判断', '属性值比较', '支持 null 和数值比较'],
		examples: [
			{
				title: '查找 rating >= 5',
				args: { property: 'rating', comparator: '>=', value: '5' },
				summary: '按 frontmatter 字段做比较。',
			},
		],
		summary: '用于快速 frontmatter 属性筛选，比 query_vault 更轻量。',
		body: {
			confusions: ['与 query_vault 相比，它更简单、更聚焦属性过滤。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'quick_search',
		keywords: ['快速搜索', '关键词搜索', 'quick search', '简单逻辑搜索'],
		scenarios: ['需要通用关键词搜索', '想用 AND/OR/NOT、引号或正则快速检索', '还不确定是否需要专门操作符'],
		decisionGuide: ['当需求是通用搜索且不想先指定范围时使用它。', '一旦明确范围是标签/属性/任务，应换成专用工具。'],
		capabilities: ['通用关键词搜索', '支持 AND/OR/NOT', '支持引号和正则'],
		examples: [
			{
				title: '快速组合搜索',
				args: { query: '发布 AND "上线方案"' },
				summary: '做不限定范围的通用搜索。',
			},
		],
		summary: '它是通用兜底搜索入口，适合先快速试探结果，再决定是否切换到更专用的搜索工具。',
		body: {
			confusions: ['与 advanced_search 相比，quick_search 更偏常用快捷写法。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'advanced_search',
		keywords: ['高级搜索', '完整 Obsidian 搜索', 'advanced search', '复杂查询'],
		scenarios: ['需要完整 Obsidian 搜索语法', '想组合多个操作符和属性条件', '快速搜索不够表达需求'],
		decisionGuide: ['当需求已经明确要用复杂 Obsidian 搜索语法时使用它。', '简单关键词搜索不必直接上 advanced。'],
		capabilities: ['完整搜索语法', '支持复杂操作符组合', '适合专家级查询'],
		examples: [
			{
				title: '组合路径和标签搜索',
				args: { query: 'path:(Projects) AND tag:#active' },
				summary: '使用完整 Obsidian 搜索语法。',
			},
		],
		summary: '这是最自由也最复杂的搜索入口，适合已经明确要写完整 Obsidian 查询语法的场景。',
		body: {
			confusions: ['与 quick_search 相比，它更强但也更重。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'file_only_search',
		keywords: ['仅文件搜索', '只搜文件名路径', 'file only search', '不搜正文'],
		scenarios: ['只想搜文件名、路径、文件夹', '明确排除正文内容', '做文件定位而不是内容定位'],
		decisionGuide: ['当需求是“定位文件”且明确不搜正文时使用它。', '如果还想匹配正文，改用 quick_search 或 content_only_search。'],
		capabilities: ['合并 file/path/folder 三种范围', '专注文件定位', '排除正文噪音'],
		examples: [
			{
				title: '仅按文件侧信息查找发布文档',
				args: { query: 'Release Notes' },
				summary: '只匹配文件名、路径和目录名。',
			},
		],
		summary: '适合“找文件在哪”而不是“找内容写了什么”。',
		body: {
			confusions: ['与 content_only_search 互为镜像：一个只搜文件侧，一个只搜内容侧。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'content_only_search',
		keywords: ['仅内容搜索', '只搜正文', 'content only search', '排除文件名路径'],
		scenarios: ['只关心正文内容', '不希望文件名/路径干扰结果', '正文级范围组合搜索'],
		decisionGuide: ['当明确要排除文件名和路径噪音时使用它。', '如果只想搜纯正文不限行块章节，也可以直接用 search_content。'],
		capabilities: ['组合 content/line/block/section', '排除文件名与路径', '适合内容导向检索'],
		examples: [
			{
				title: '只在正文范围搜索 API 限流',
				args: { query: 'API 限流' },
				summary: '不匹配标题和路径。',
			},
		],
		summary: '适合内容检索优先、且不想被标题命名误导的场景。',
		body: {
			confusions: ['与 file_only_search 相反，它完全聚焦正文。'],
		},
	}),
	defineSeed(BUILTIN_OBSIDIAN_SEARCH_SERVER_ID, BUILTIN_OBSIDIAN_SEARCH_SERVER_NAME, 'search', {
		name: 'tag_search',
		keywords: ['标签专用搜索', 'tag search', '按标签查找', '#标签'],
		scenarios: ['模型想明确使用标签专用工具', '用户语言里强调标签组织', '按标签维度浏览内容'],
		decisionGuide: ['标签场景可与 search_tags 二选一，优先保持语义一致。', '非标签场景不要误用。'],
		capabilities: ['标签专用搜索', '语义上强调标签场景', '适合作为标签检索别名'],
		examples: [
			{
				title: '查找带 #meeting 的笔记',
				args: { query: '#meeting' },
				summary: '按标签查找内容。',
			},
		],
		summary: '它和 search_tags 很接近，适合在“标签专用搜索”语义下明确调用。',
		body: {
			confusions: ['与 search_tags 基本同域；如果只是一般标签检索，任选其一即可。'],
		},
	}),
];

const memorySeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'create_entities',
		keywords: ['创建实体', 'memory entity', '知识图谱实体', '添加实体'],
		scenarios: ['向记忆图谱写入新实体', '建立人物/项目/概念节点', '持久化命名对象'],
		decisionGuide: ['当需要新增实体节点时使用它。', '如果只是给已有实体补事实，改用 add_observations。'],
		capabilities: ['批量创建实体', '为实体附带观察内容', '建立长期记忆节点'],
		examples: [
			{
				title: '创建项目实体',
				args: { entities: [{ name: 'Formify', entityType: 'project', observations: ['是一个 Obsidian 插件'] }] },
				summary: '把新对象写入知识图谱。',
			},
		],
		summary: '用于建立知识图谱里的“节点”，适合把稳定对象写入长期记忆。',
		body: {
			confusions: ['与 create_relations 不同，它创建的是节点，不是边。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'create_relations',
		keywords: ['创建关系', '关系边', 'memory relation', '实体关系'],
		scenarios: ['连接两个已有实体', '写入主动语态关系', '补充实体间联系'],
		decisionGuide: ['当实体已经存在，只是缺少关系边时使用它。', '如果实体不存在，应先 create_entities。'],
		capabilities: ['批量创建关系', '表达实体间联系', '适合图谱结构化记忆'],
		examples: [
			{
				title: '连接项目和作者',
				args: { relations: [{ from: 'Formify', to: 'vran', relationType: 'is maintained by' }] },
				summary: '为现有实体补一条关系。',
			},
		],
		summary: '用于知识图谱里的“边”，表达实体之间的结构化关系。',
		body: {
			confusions: ['与 add_observations 不同，关系不是自由文本事实，而是 from/to/relationType 结构。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'add_observations',
		keywords: ['添加观察', '补充事实', 'memory observations', '追加记忆'],
		scenarios: ['给已有实体补新事实', '持续更新实体观察内容', '记录实体的自由文本特征'],
		decisionGuide: ['实体已存在且只需要补充事实时使用它。', '如果实体本身还不存在，不要直接加观察。'],
		capabilities: ['批量追加观察内容', '去重新增事实', '适合自由文本记忆'],
		examples: [
			{
				title: '给项目补观察',
				args: { observations: [{ entityName: 'Formify', contents: ['内置 4 个 MCP server'] }] },
				summary: '向现有实体补充新事实。',
			},
		],
		summary: '它负责给已有实体追加自由文本事实，是知识图谱里最常见的更新工具之一。',
		body: {
			confusions: ['与 create_entities 的区别是：add_observations 不创建新节点。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'delete_entities',
		keywords: ['删除实体', '移除记忆节点', 'delete entity', '清理图谱实体'],
		scenarios: ['删除错误实体', '清理过期节点', '同时移除相关关系'],
		decisionGuide: ['仅在确定实体应该被彻底移除时使用它。', '如果只是删一条事实，不要删整个实体。'],
		capabilities: ['删除实体', '连带删除关联关系', '适合图谱清理'],
		examples: [
			{
				title: '删除错误实体',
				args: { entityNames: ['临时项目'] },
				summary: '彻底移除实体及关系。',
			},
		],
		summary: '这是破坏性记忆工具，只适合明确要删除整个实体及其边的场景。',
		body: {
			avoid: ['如果只想删某条观察，改用 delete_observations。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'delete_observations',
		keywords: ['删除观察', '删除事实', 'remove observation', '清理记忆内容'],
		scenarios: ['删除实体上的错误事实', '保留实体但修正观察内容', '细粒度清理记忆'],
		decisionGuide: ['当实体要保留，只删其中某些事实时使用它。', '不要为删一条观察而删除整个实体。'],
		capabilities: ['删除指定观察内容', '保留实体节点', '适合细粒度修正'],
		examples: [
			{
				title: '删除错误观察',
				args: { deletions: [{ entityName: 'Formify', observations: ['支持 100 个工具'] }] },
				summary: '只移除指定事实。',
			},
		],
		summary: '它比 delete_entities 更保守，适合修正记忆内容而不是清空对象。',
		body: {
			confusions: ['与 delete_entities 的边界：一个删事实，一个删节点。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'delete_relations',
		keywords: ['删除关系', '删除边', 'remove relation', '清理实体关系'],
		scenarios: ['修正错误实体关系', '保留实体但移除连接', '图谱边清理'],
		decisionGuide: ['当错的是关系边而不是实体本身时使用它。', '如果还需要关系内容改写，应先删后重建。'],
		capabilities: ['删除关系边', '保留实体节点', '适合图结构修正'],
		examples: [
			{
				title: '删除旧关系',
				args: { relations: [{ from: 'Formify', to: '旧仓库', relationType: 'depends on' }] },
				summary: '移除指定关系边。',
			},
		],
		summary: '用于修正图谱中的连接关系，不会删除实体本身。',
		body: {
			confusions: ['与 create_relations 成对出现。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'read_graph',
		keywords: ['读取图谱', '完整记忆图谱', 'read graph', 'memory 全量'],
		scenarios: ['查看完整知识图谱', '调试 memory 数据', '先整体了解当前记忆状态'],
		decisionGuide: ['当你需要全量视图时使用它。', '如果只想按关键词找一部分实体，优先 search_nodes。'],
		capabilities: ['读取所有实体与关系', '返回全量图谱', '适合调试与总览'],
		examples: [
			{
				title: '读取完整图谱',
				args: {},
				summary: '获取所有实体与关系。',
			},
		],
		summary: '适合总览或调试当前 memory 状态，但在图谱较大时会比局部搜索更重。',
		body: {
			confusions: ['与 open_nodes/search_nodes 相比，它是全量读取。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'search_nodes',
		keywords: ['搜索节点', 'memory 搜索', '按关键词找实体', 'search nodes'],
		scenarios: ['按名称或事实搜索实体', '在图谱中找相关节点', '先缩小记忆范围再操作'],
		decisionGuide: ['当你只知道关键词，不知道实体名时使用它。', '如果已经知道确切实体名，open_nodes 更直接。'],
		capabilities: ['关键词搜索实体', '同时返回相关关系', '适合图谱局部检索'],
		examples: [
			{
				title: '搜索项目节点',
				args: { query: 'Formify' },
				summary: '按关键词找相关实体。',
			},
		],
		summary: '它是 memory 的局部检索入口，适合先找节点再决定后续读写。',
		body: {
			confusions: ['与 read_graph 相比，search_nodes 更轻量。'],
		},
	}),
	defineSeed(BUILTIN_MEMORY_SERVER_ID, BUILTIN_MEMORY_SERVER_NAME, 'memory', {
		name: 'open_nodes',
		keywords: ['打开节点', '按名称读取实体', 'open nodes', '实体详情'],
		scenarios: ['已知实体名，想读取其详情', '按确切名字获取节点和关系', '从 search_nodes 结果继续展开'],
		decisionGuide: ['当实体名已知且明确时使用它。', '不知道名称时先 search_nodes。'],
		capabilities: ['按名称读取节点', '返回相关关系', '适合精确取数'],
		examples: [
			{
				title: '读取两个实体',
				args: { names: ['Formify', 'vran'] },
				summary: '按名称打开指定节点。',
			},
		],
		summary: '适合“我已经知道要看哪几个实体”的场景，是精确读取而不是模糊搜索。',
		body: {
			confusions: ['与 search_nodes 的区别是：open_nodes 依赖确切名称。'],
		},
	}),
];

const thinkingSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_SEQUENTIAL_THINKING_SERVER_ID, BUILTIN_SEQUENTIAL_THINKING_SERVER_NAME, 'thinking', {
		name: 'sequentialthinking',
		keywords: ['顺序思考', '逐步分析', '复杂推理', 'sequential thinking', '推理分步'],
		scenarios: ['复杂问题需要分步推理', '设计方案需要持续修正', '多阶段分析需要显式记录 thought'],
		decisionGuide: ['当问题复杂、容易中途改思路时使用它。', '简单单步问题不要硬上 sequentialthinking。'],
		capabilities: ['分步记录 thought', '支持修订与分支', '适合复杂分析与验证'],
		examples: [
			{
				title: '记录第一步分析',
				args: {
					thought: '先确认需求里的边界条件。',
					thoughtNumber: 1,
					totalThoughts: 4,
					nextThoughtNeeded: true,
				},
				summary: '开始一次分步思考流程。',
			},
		],
		summary: '适合复杂推理、规划和反思性分析，不适合简单读取或搜索。',
		body: {
			confusions: ['它不是文件或搜索工具，而是显式思考工具。'],
		},
	}),
];

const toolSearchSeeds: ToolLibrarySeed[] = [
	defineSeed(BUILTIN_TOOL_SEARCH_SERVER_ID, BUILTIN_TOOL_SEARCH_SERVER_NAME, 'tool-search', {
		name: 'find_tool',
		keywords: ['找工具', '不知道用哪个工具', 'tool routing', '工具选择', 'find tool'],
		scenarios: ['不确定该调用哪个 MCP 工具', '想先看候选工具及决策指南', '搜索场景里难以区分 15 个搜索工具'],
		decisionGuide: ['只要你对工具选择没有把握，就先调用它。', '锁定具体工具后，再调用真实执行工具。'],
		capabilities: ['按任务描述匹配工具', '返回分数排序', '展示决策指南和示例'],
		examples: [
			{
				title: '搜索“未完成任务”该用什么工具',
				args: { task: '我想找所有未完成的任务', limit: 3 },
				summary: '先找最适合的执行工具。',
			},
		],
		summary: '这是工具选择入口，专门解决“我不知道该调用哪个工具”的问题。',
		body: {
			confusions: ['它只负责选工具，不执行真正业务操作。'],
		},
	}),
	defineSeed(BUILTIN_TOOL_SEARCH_SERVER_ID, BUILTIN_TOOL_SEARCH_SERVER_NAME, 'tool-search', {
		name: 'get_tool_info',
		keywords: ['工具详情', '工具用法', 'tool info', '完整指南'],
		scenarios: ['已经知道工具名，但想看完整参数和示例', '确认某工具的边界和不适用场景', '需要单工具说明书'],
		decisionGuide: ['当工具名已经明确时使用它。', '如果连工具名都不确定，应先用 find_tool。'],
		capabilities: ['返回单工具完整指南', '包含参数、示例、决策建议', '适合执行前确认用法'],
		examples: [
			{
				title: '查看 search_tasks 的完整说明',
				args: { name: 'search_tasks' },
				summary: '获取单个工具的完整指南。',
			},
		],
		summary: '适合“已经知道工具名，但还要确认怎么用”的场景。',
		body: {
			confusions: ['与 list_tools 相比，它只看单个工具。'],
		},
	}),
	defineSeed(BUILTIN_TOOL_SEARCH_SERVER_ID, BUILTIN_TOOL_SEARCH_SERVER_NAME, 'tool-search', {
		name: 'list_tools',
		keywords: ['列出工具', '工具清单', 'list tools', '按分类浏览工具'],
		scenarios: ['想看某个 server 的全部工具', '按分类浏览工具全集', '需要人工扫一遍可用工具'],
		decisionGuide: ['当目标是“浏览全集”而不是“按任务匹配”时使用它。', '任务导向选择应优先 find_tool。'],
		capabilities: ['列出全部工具', '支持按 serverId/category 过滤', '按稳定顺序展示'],
		examples: [
			{
				title: '列出所有 search 类工具',
				args: { categories: ['search'] },
				summary: '按分类浏览工具列表。',
			},
		],
		summary: '它适合浏览工具全集，是人工理解工具库的入口。',
		body: {
			confusions: ['与 find_tool 相比，list_tools 不做任务匹配和打分。'],
		},
	}),
];

export const TOOL_LIBRARY_SEEDS: ToolLibrarySeed[] = [
	...vaultFileSeeds,
	...vaultNavSeeds,
	...vaultQuerySeeds,
	...vaultScriptSeeds,
	...vaultUtilSeeds,
	...searchSeeds,
	...memorySeeds,
	...thinkingSeeds,
	...toolSearchSeeds,
];

export const getToolLibrarySeed = (name: string): ToolLibrarySeed | undefined => {
	return TOOL_LIBRARY_SEEDS.find((seed) => seed.name === name);
};
