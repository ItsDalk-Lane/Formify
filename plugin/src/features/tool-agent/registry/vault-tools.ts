import {
	BUILTIN_VAULT_SERVER_ID,
	BUILTIN_VAULT_SERVER_NAME,
} from 'src/builtin-mcp/constants';
import {
	defineTool,
	enumSchema,
	englishAndChinese,
	guide,
	jsonArray,
	jsonBoolean,
	jsonInteger,
	jsonObject,
	jsonString,
	parameterExample,
} from './helpers';
import type { ToolDefinition } from './types';

const serverId = BUILTIN_VAULT_SERVER_ID;
const serverName = BUILTIN_VAULT_SERVER_NAME;

export const vaultToolDefinitions: ToolDefinition[] = [
	defineTool({
		name: 'read_file',
		serverId,
		serverName,
		category: 'file_read',
		summary: 'Read a text file from the Vault, either fully or as a character range.',
		coreCapabilities: [
			'Read the full contents of a known Vault file path.',
			'Support partial reads with `offset` and `length` for large files.',
			'Return the raw source text, including Markdown and frontmatter.',
			'Work well as a safe pre-step before any file mutation.',
		],
		limitations: [
			'Cannot access files outside the current Vault.',
			'Only meaningful for text-like files; binary content is not useful.',
			'Requires a concrete relative path instead of fuzzy file names.',
			'Does not search for files or inspect directory structure by itself.',
		],
		scenarios: {
			primary: [
				'User asks to inspect a known note or config file.',
				'Agent needs current file contents before applying a rewrite.',
				'Agent wants to summarize or analyze a specific note.',
			],
			secondary: [
				'Preview the start of a large file before deciding whether to keep reading.',
				'Read a template or generated output that another tool just created.',
				'Confirm whether a resolved wiki link points at the expected content.',
			],
			antiPatterns: [
				'Do not use it when the path is unknown; search first.',
				'Do not use it for file metadata or directory listings.',
				'Do not treat it as a binary asset extractor.',
			],
		},
		inputSchema: jsonObject(
			{
				path: jsonString('Relative path from the Vault root.'),
				offset: jsonInteger('Character offset to start reading from.', {
					minimum: 0,
				}),
				length: jsonInteger('Maximum character count to read.', {
					minimum: 0,
				}),
			},
			['path']
		),
		parameterGuide: {
			path: guide(
				'Vault-relative file path.',
				[
					parameterExample('daily/2026-03-09.md', 'Read a daily note.'),
					parameterExample('projects/roadmap.md', 'Read a project document.'),
				],
				[
					'Use `/` separators and keep the path relative to the Vault root.',
					'Resolve wiki links with `get_first_link_path` when needed.',
				],
				{
					commonMistakes: [
						'Passing an absolute OS path.',
						'Omitting the file extension when the Vault contains ambiguous matches.',
					],
				}
			),
			offset: guide(
				'Character offset for partial reads.',
				[
					parameterExample(0, 'Read from the beginning.'),
					parameterExample(5000, 'Jump into the middle of a large note.'),
				],
				[
					'Combine with `length` for paging.',
					'Leave it out for normal full-file reads.',
				],
				{
					defaultBehavior: 'Defaults to 0.',
				}
			),
			length: guide(
				'Maximum number of characters to return.',
				[
					parameterExample(1000, 'Quick preview.'),
					parameterExample(4000, 'Read a medium-sized chunk.'),
				],
				[
					'Use a smaller value first when you suspect the file is large.',
					'If omitted, the tool returns the remaining content from `offset` onward.',
				],
				{
					defaultBehavior: 'Read until the end of the file.',
				}
			),
		},
		bestPractices: [
			'Read before write whenever you need to preserve surrounding user content.',
			'Use partial reads for large files to keep the tool loop efficient.',
			'Pair it with search or link-resolution tools instead of guessing paths.',
		],
		performanceTips: [
			'Prefer `length`-limited previews for large documents.',
			'Use `query_vault` or search tools instead of repeatedly reading many files blindly.',
		],
		safetyNotes: [
			'This is read-only and does not mutate user data.',
			'Returned text may contain secrets or private notes; summarize carefully.',
		],
		commonCombinations: [
			{
				tools: ['search_content', 'read_file'],
				pattern: 'Search then inspect',
				example: 'Find notes about a topic first, then read the most relevant file fully.',
			},
			{
				tools: ['get_first_link_path', 'read_file'],
				pattern: 'Resolve link then read',
				example: 'Turn `[[Roadmap]]` into a real path before reading the note.',
			},
			{
				tools: ['read_file', 'write_file'],
				pattern: 'Read-modify-write',
				example: 'Load current text, edit it in memory, then write back the updated content.',
			},
		],
		prerequisites: [
			'Use `search_files`, `search_path`, or `list_directory` if the exact path is not known.',
			'Use `get_first_link_path` when the user provides a wiki-link style target.',
		],
		followUps: [
			'Use `write_file` if the user wants to update the content after inspection.',
			'Use `open_file` when the result should also be shown in the Obsidian UI.',
		],
		returnType: {
			description: 'Returns file text as a string or a string slice when range arguments are provided.',
			examples: [
				{
					scenario: 'Normal Markdown note',
					output: '# Sprint Review\n\n- Item 1\n- Item 2',
				},
				{
					scenario: 'Offset read',
					output: '...middle section text...',
				},
			],
			errorCases: [
				{
					condition: 'Path does not exist',
					errorMessage: 'File not found or path does not exist.',
					resolution: 'Verify the path with search or directory listing tools.',
				},
				{
					condition: 'Target is not a readable text file',
					errorMessage: 'Returned text is empty, garbled, or rejected.',
					resolution: 'Use a different workflow for binary assets.',
				},
				{
					condition: 'Path points outside the Vault',
					errorMessage: 'Vault path assertion failed.',
					resolution: 'Pass a relative Vault path only.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'read file',
			'read note',
			'file content',
			'open text',
			'读取文件',
			'查看内容',
			'读取笔记',
			'文件正文'
		),
		intentPatterns: englishAndChinese(
			'read the file',
			'show me the contents',
			'open this note and read it',
			'读取文件',
			'查看这个笔记',
			'文件里写了什么'
		),
	}),
	defineTool({
		name: 'write_file',
		serverId,
		serverName,
		category: 'file_write',
		summary: 'Create a Vault file or overwrite/append text to an existing file.',
		coreCapabilities: [
			'Create a new text file when the target path does not exist.',
			'Overwrite an existing file with `mode=write`.',
			'Append new text to the end of an existing file with `mode=append`.',
			'Automatically create missing parent folders.',
		],
		limitations: [
			'Requires the final target path and exact content.',
			'Does not preserve previous content when `mode=write` unless the caller read and merged it first.',
			'Cannot safely edit binary files.',
			'Does not rename or move files while preserving paths; use `move_file` for that.',
		],
		scenarios: {
			primary: [
				'Create a new note with provided content.',
				'Rewrite a file after computing updated content.',
				'Append a meeting log or summary to an existing file.',
			],
			secondary: [
				'Generate a helper file or export file under a known folder.',
				'Write a template-instantiated note after prior analysis.',
				'Store a plan snapshot or structured text artifact.',
			],
			antiPatterns: [
				'Do not use `write` mode if you only need to rename or move a file.',
				'Do not overwrite existing content without reading it first when context matters.',
				'Do not use it for uncertain targets or speculative destructive changes.',
			],
		},
		inputSchema: jsonObject(
			{
				path: jsonString('Relative path from the Vault root.'),
				content: jsonString('Text content to write.'),
				mode: enumSchema('Write mode.', ['write', 'append']),
			},
			['path', 'content']
		),
		parameterGuide: {
			path: guide(
				'Vault-relative file path to create or update.',
				[
					parameterExample('inbox/meeting-notes.md', 'Create a new inbox note.'),
					parameterExample('daily/2026-03-09.md', 'Update an existing daily note.'),
				],
				[
					'Choose the final path up front; parent folders are created automatically.',
					'Use `move_file` later if the user wants to reorganize an already-written file.',
				],
				{
					commonMistakes: [
						'Passing an absolute OS path.',
						'Writing to a folder path instead of a file path.',
					],
				}
			),
			content: guide(
				'Full text payload to persist.',
				[
					parameterExample('# Meeting\n\nSummary...', 'Create a fresh note body.'),
					parameterExample('\n- New action item', 'Append a new list item when used with `append`.'),
				],
				[
					'For partial edits, read the file first and build the final content explicitly.',
					'Preserve user formatting if the task is an update rather than a rewrite.',
				]
			),
			mode: guide(
				'Controls whether content replaces or appends.',
				[
					parameterExample('write', 'Replace the file or create it from scratch.'),
					parameterExample('append', 'Add to the end of an existing note.'),
				],
				[
					'Default to `write` unless the task explicitly asks to append.',
					'Append is safer for incremental logs and journals.',
				],
				{
					defaultBehavior: 'Defaults to `write`.',
				}
			),
		},
		bestPractices: [
			'Read existing content before destructive rewrites.',
			'Keep the caller responsible for constructing the full final text.',
			'Use append only when the desired insertion location is the end of file.',
		],
		performanceTips: [
			'Batch content generation in memory before a single write.',
			'Avoid write-append-write oscillation in the same tool loop.',
		],
		safetyNotes: [
			'This mutates user data and should respect read-only constraints.',
			'Overwrites are irreversible inside the tool loop unless the caller stored the old content.',
		],
		commonCombinations: [
			{
				tools: ['read_file', 'write_file'],
				pattern: 'Safe update',
				example: 'Read the current note, merge changes, then overwrite with the new full text.',
			},
			{
				tools: ['search_files', 'write_file'],
				pattern: 'Locate then create/update',
				example: 'Find the intended destination note by name before writing to it.',
			},
			{
				tools: ['write_file', 'open_file'],
				pattern: 'Write then reveal',
				example: 'Create a note and immediately open it in the UI for the user.',
			},
		],
		prerequisites: [
			'Use `read_file` if existing content must be preserved or merged.',
			'Use search or directory tools if the destination path is still uncertain.',
		],
		followUps: [
			'Use `open_file` to show the newly written note.',
			'Use `move_file` if the file should be relocated after creation.',
		],
		returnType: {
			description: 'Returns a small JSON object describing the write, including path, mode, creation flag, and bytes written.',
			examples: [
				{
					scenario: 'New file created',
					output: '{"path":"inbox/meeting.md","mode":"write","created":true,"bytes":128}',
				},
				{
					scenario: 'Append to existing file',
					output: '{"path":"daily/2026-03-09.md","mode":"append","created":false,"bytes":42}',
				},
			],
			errorCases: [
				{
					condition: 'Target path is actually a folder',
					errorMessage: '目标路径是文件夹',
					resolution: 'Provide a file path with a filename, not a directory path.',
				},
				{
					condition: 'Path is outside the Vault',
					errorMessage: 'Vault path assertion failed.',
					resolution: 'Use a relative Vault path only.',
				},
				{
					condition: 'Desktop or Vault write permission issue',
					errorMessage: 'Write failed with adapter or permission error.',
					resolution: 'Retry with a valid writable path inside the Vault.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'write file',
			'create file',
			'append file',
			'写入文件',
			'创建笔记',
			'追加内容',
			'保存文件'
		),
		intentPatterns: englishAndChinese(
			'create a note',
			'write this content to a file',
			'append this to the note',
			'创建新笔记',
			'写入到文件',
			'把内容追加进去'
		),
	}),
	defineTool({
		name: 'delete_file',
		serverId,
		serverName,
		category: 'file_manage',
		summary: 'Delete a Vault file or folder, with optional recursive deletion for folders.',
		coreCapabilities: [
			'Delete a single file by path.',
			'Delete a folder tree when `force=true`.',
			'Delete an empty folder when `force=false`.',
			'Return structured confirmation of what was removed.',
		],
		limitations: [
			'Destructive operation with no built-in undo in the tool loop.',
			'Requires an exact file or folder path.',
			'Cannot selectively prune folder contents; it removes the specified target.',
			'Will fail when a non-empty folder is deleted with `force=false`.',
		],
		scenarios: {
			primary: [
				'User explicitly asks to delete a file or cleanup folder.',
				'Remove a temporary output folder after confirmation.',
				'Delete a note that was just created by mistake.',
			],
			secondary: [
				'Remove stale generated artifacts after migration.',
				'Delete a draft note before recreating it elsewhere.',
				'Prune a known scratch directory during maintenance.',
			],
			antiPatterns: [
				'Do not use it when the user asked to archive or move a file.',
				'Do not infer the path from vague language.',
				'Do not delete top-level or system paths without explicit confirmation and safeguards.',
			],
		},
		inputSchema: jsonObject(
			{
				path: jsonString('File or folder path to delete.'),
				force: jsonBoolean('Whether folder deletion should recurse.'),
			},
			['path']
		),
		parameterGuide: {
			path: guide(
				'Exact file or folder path to remove.',
				[
					parameterExample('tmp/report.md', 'Delete one generated file.'),
					parameterExample('tmp/build-cache', 'Delete a temporary folder tree.'),
				],
				[
					'Double-check the target before destructive operations.',
					'Prefer `move_file` if the goal is relocation rather than deletion.',
				],
				{
					commonMistakes: [
						'Passing the Vault root or an overly broad folder.',
						'Deleting a folder when only one file should be removed.',
					],
				}
			),
			force: guide(
				'Controls recursive folder deletion.',
				[
					parameterExample(true, 'Delete a folder and everything under it.'),
					parameterExample(false, 'Only allow deletion if the folder is empty.'),
				],
				[
					'Use `false` when you want an extra safety barrier for folders.',
					'This flag does not matter for files.',
				],
				{
					defaultBehavior: 'Defaults to `true`.',
				}
			),
		},
		bestPractices: [
			'Only call it after the path is explicit and validated.',
			'Consider listing or reading the target first when the user request is ambiguous.',
			'Use `force=false` when deleting folders unless recursive deletion is clearly intended.',
		],
		performanceTips: [
			'Delete the narrowest possible target to avoid expensive folder recursion.',
			'Prefer one folder deletion over many file deletions when the intent is full cleanup.',
		],
		safetyNotes: [
			'This is a destructive write tool and must be blocked in read-only mode.',
			'Extra path guards are required for root folders and AI data folders.',
		],
		commonCombinations: [
			{
				tools: ['list_directory', 'delete_file'],
				pattern: 'Inspect then delete',
				example: 'List a temp folder, confirm the target, then delete it.',
			},
			{
				tools: ['read_file', 'delete_file'],
				pattern: 'Archive mentally then remove',
				example: 'Read a draft for confirmation before deleting it permanently.',
			},
			{
				tools: ['move_file', 'delete_file'],
				pattern: 'Relocate and prune',
				example: 'Move the keep-worthy file, then delete the empty old folder.',
			},
		],
		prerequisites: [
			'Use `list_directory` for folders when you need confidence about contents.',
			'Use `move_file` instead if the task is really a rename or relocation.',
		],
		followUps: [
			'Use `list_directory` again to verify cleanup.',
			'Use `write_file` only if the user wants a replacement artifact created afterward.',
		],
		returnType: {
			description: 'Returns JSON with deleted path, target type, and whether recursive deletion was used.',
			examples: [
				{
					scenario: 'Delete file',
					output: '{"path":"tmp/report.md","type":"file","deleted":true}',
				},
				{
					scenario: 'Delete folder',
					output: '{"path":"tmp/cache","type":"folder","deleted":true,"force":true}',
				},
			],
			errorCases: [
				{
					condition: 'Path does not exist',
					errorMessage: '路径不存在',
					resolution: 'Verify the path before deleting.',
				},
				{
					condition: 'Folder is not empty and force is false',
					errorMessage: '文件夹非空，且 force=false',
					resolution: 'Retry with `force=true` only if recursive deletion is intended.',
				},
				{
					condition: 'Path guard rejects a protected location',
					errorMessage: 'Deletion blocked by safety check.',
					resolution: 'Choose a narrower target or avoid protected system folders.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'delete file',
			'remove folder',
			'cleanup file',
			'删除文件',
			'删除目录',
			'清理草稿'
		),
		intentPatterns: englishAndChinese(
			'delete this note',
			'remove the folder',
			'clean up these files',
			'删除这个笔记',
			'把目录删掉',
			'清理这些文件'
		),
	}),
	defineTool({
		name: 'move_file',
		serverId,
		serverName,
		category: 'file_manage',
		summary: 'Move or rename a Vault file or folder without rewriting its content.',
		coreCapabilities: [
			'Rename a file in place by changing its destination path.',
			'Move a file to another folder while preserving content.',
			'Move or rename folders as a path-level operation.',
			'Ensure parent folders exist before the move.',
		],
		limitations: [
			'Requires both source and destination paths.',
			'Will fail if the destination already exists.',
			'Does not modify file contents.',
			'Does not merge directories or resolve naming conflicts automatically.',
		],
		scenarios: {
			primary: [
				'User wants to rename a note.',
				'Move a file from inbox to project folder.',
				'Reorganize a folder structure without editing content.',
			],
			secondary: [
				'Promote a draft into a published folder.',
				'Standardize naming after content generation is complete.',
				'Clean up folder hierarchy while preserving backlinks and note bodies.',
			],
			antiPatterns: [
				'Do not use it for content updates.',
				'Do not overwrite an existing destination by guessing conflict policy.',
				'Do not simulate deletion plus rewrite when a move is sufficient.',
			],
		},
		inputSchema: jsonObject(
			{
				source: jsonString('Existing file or folder path.'),
				destination: jsonString('New file or folder path.'),
			},
			['source', 'destination']
		),
		parameterGuide: {
			source: guide(
				'Current path of the file or folder.',
				[
					parameterExample('inbox/meeting.md', 'Rename or relocate a note.'),
					parameterExample('drafts/article', 'Move a folder tree.'),
				],
				[
					'Make sure the source exists before moving.',
					'Use Vault-relative paths only.',
				]
			),
			destination: guide(
				'Desired new path.',
				[
					parameterExample('projects/meeting-notes.md', 'Rename and move in one step.'),
					parameterExample('published/article', 'Promote a folder into a new location.'),
				],
				[
					'Choose a destination that does not already exist.',
					'Use `write_file` separately if content must also change.',
				],
				{
					commonMistakes: [
						'Setting destination equal to an existing unrelated file.',
						'Using destination as a folder path when a filename is required.',
					],
				}
			),
		},
		bestPractices: [
			'Prefer move/rename over delete-and-recreate when content should remain intact.',
			'Read the file before moving only if content validation is also needed.',
			'Check for destination conflicts before issuing the move.',
		],
		performanceTips: [
			'Perform one move after all content edits are done to avoid repeated path churn.',
			'Use folder moves for large reorganizations instead of moving files individually when appropriate.',
		],
		safetyNotes: [
			'This mutates Vault structure and should be blocked in read-only mode.',
			'Moving shared folders can have broad effects on user organization.',
		],
		commonCombinations: [
			{
				tools: ['read_file', 'move_file'],
				pattern: 'Validate then move',
				example: 'Confirm a draft is the correct file before relocating it.',
			},
			{
				tools: ['write_file', 'move_file'],
				pattern: 'Create then relocate',
				example: 'Generate a file in a staging folder, then move it to the final destination.',
			},
			{
				tools: ['search_files', 'move_file'],
				pattern: 'Find then reorganize',
				example: 'Search for the target note by name and move it once found.',
			},
		],
		prerequisites: [
			'Use search or listing tools if the source path is still fuzzy.',
			'Use `write_file` separately if the note content also needs changes.',
		],
		followUps: [
			'Use `open_file` to show the file in its new location.',
			'Use `list_directory` to verify destination folder contents.',
		],
		returnType: {
			description: 'Returns JSON describing the old path, new path, and move status.',
			examples: [
				{
					scenario: 'Rename note',
					output: '{"source":"inbox/meeting.md","destination":"projects/meeting-notes.md","moved":true}',
				},
			],
			errorCases: [
				{
					condition: 'Source path does not exist',
					errorMessage: '源路径不存在',
					resolution: 'Locate the correct source path first.',
				},
				{
					condition: 'Destination already exists',
					errorMessage: '目标路径已存在',
					resolution: 'Choose a new destination or handle the conflict separately.',
				},
				{
					condition: 'Path guard rejects source or destination',
					errorMessage: 'Vault path assertion failed.',
					resolution: 'Use relative Vault paths only.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'move file',
			'rename note',
			'relocate folder',
			'移动文件',
			'重命名笔记',
			'整理路径'
		),
		intentPatterns: englishAndChinese(
			'rename this file',
			'move the note to another folder',
			'重命名这个文件',
			'把笔记移到项目目录',
			'整理一下路径'
		),
	}),
	defineTool({
		name: 'list_directory',
		serverId,
		serverName,
		category: 'navigation',
		summary: 'List the direct children of a Vault folder, optionally filtered by regex.',
		coreCapabilities: [
			'List direct files and folders under a known directory.',
			'Return item metadata such as type, size, and timestamps for files.',
			'Apply an optional regular-expression name filter.',
			'Help narrow targets before reads, writes, moves, or deletes.',
		],
		limitations: [
			'Only lists one directory level at a time.',
			'Requires a concrete folder path rather than fuzzy search intent.',
			'Regex filters operate on item names, not file content.',
			'Does not rank semantic relevance like search tools do.',
		],
		scenarios: {
			primary: [
				'Browse a known folder before choosing a file.',
				'Inspect direct children in a project or inbox folder.',
				'Confirm whether a file already exists in a destination folder.',
			],
			secondary: [
				'Use regex to filter notes by naming pattern.',
				'Verify cleanup after delete or move operations.',
				'Navigate folder structure step by step.',
			],
			antiPatterns: [
				'Do not use it as a full-vault search tool.',
				'Do not expect recursive folder traversal from one call.',
				'Do not use regex when a content query is actually needed.',
			],
		},
		inputSchema: jsonObject({
			path: jsonString('Folder path, relative to the Vault root. Empty means the Vault root.'),
			regex: jsonString('Optional JavaScript regular expression to filter item names.'),
		}),
		parameterGuide: {
			path: guide(
				'Folder path to inspect.',
				[
					parameterExample('', 'List the Vault root.'),
					parameterExample('projects', 'List direct children of the projects folder.'),
				],
				[
					'Leave empty to inspect the Vault root.',
					'Use one call per depth level when navigating nested folders.',
				],
				{
					defaultBehavior: 'Defaults to the Vault root.',
				}
			),
			regex: guide(
				'Optional item-name filter.',
				[
					parameterExample('^2026-', 'Show items whose names start with 2026-.'),
					parameterExample('\\.md$', 'Show Markdown files only.'),
				],
				[
					'Regex is applied to immediate child names only.',
					'Leave it out if you want the full directory listing.',
				],
				{
					commonMistakes: [
						'Using content keywords instead of filename patterns.',
						'Forgetting to escape backslashes in JSON strings.',
					],
				}
			),
		},
		bestPractices: [
			'Use it when the folder is known but the target file is not.',
			'Combine regex with predictable naming conventions for fast narrowing.',
			'Verify destination folders with this tool before moving or writing files.',
		],
		performanceTips: [
			'Prefer direct known folders over repeatedly listing the Vault root.',
			'Use regex to shrink large folders when only a subset matters.',
		],
		safetyNotes: [
			'Read-only operation.',
			'Large folder listings may need truncation before being sent back to the model.',
		],
		commonCombinations: [
			{
				tools: ['list_directory', 'read_file'],
				pattern: 'Browse then read',
				example: 'List a folder, pick the relevant note, then read it.',
			},
			{
				tools: ['list_directory', 'move_file'],
				pattern: 'Check destination then move',
				example: 'Inspect a destination folder before relocating a note into it.',
			},
			{
				tools: ['list_directory', 'delete_file'],
				pattern: 'Inspect then cleanup',
				example: 'List a temp folder and delete confirmed stale files or subfolders.',
			},
		],
		prerequisites: [
			'Use `search_folder` or `search_path` if the folder path is not known.',
		],
		followUps: [
			'Use `read_file`, `open_file`, `move_file`, or `delete_file` on a selected child path.',
		],
		returnType: {
			description: 'Returns JSON with the inspected path, an `items` array, and a direct-child count.',
			examples: [
				{
					scenario: 'Folder with files',
					output: '{"path":"projects","items":[{"name":"roadmap.md","path":"projects/roadmap.md","type":"file"}],"count":1}',
				},
			],
			errorCases: [
				{
					condition: 'Folder path does not exist',
					errorMessage: 'Folder not found.',
					resolution: 'Search for the correct folder path first.',
				},
				{
					condition: 'Regex is invalid',
					errorMessage: 'Invalid regular expression.',
					resolution: 'Pass a valid JavaScript regex string or omit the filter.',
				},
				{
					condition: 'Path is a file instead of a folder',
					errorMessage: 'Expected a folder path.',
					resolution: 'Use `read_file` or `open_file` for files.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'list directory',
			'browse folder',
			'folder contents',
			'列目录',
			'查看文件夹',
			'目录清单'
		),
		intentPatterns: englishAndChinese(
			'what is in this folder',
			'list the directory',
			'查看这个文件夹',
			'列出目录内容',
			'这个目录下有什么'
		),
	}),
	defineTool({
		name: 'open_file',
		serverId,
		serverName,
		category: 'navigation',
		summary: 'Open a Vault file in the Obsidian UI, optionally in a new pane.',
		coreCapabilities: [
			'Open a file in the current pane or a new pane.',
			'Bridge tool execution with visible UI navigation.',
			'Return confirmation that the file was opened.',
			'Work well after search or file creation workflows.',
		],
		limitations: [
			'Does not return file contents.',
			'Requires an exact file path.',
			'Only meaningful when UI navigation is relevant.',
			'Cannot open folders or external OS files.',
		],
		scenarios: {
			primary: [
				'User wants the note visibly opened in Obsidian.',
				'Agent just created a note and should reveal it.',
				'Agent found the right file and now wants to navigate there.',
			],
			secondary: [
				'Open in a new pane for side-by-side comparison.',
				'Navigate after resolving a wiki link path.',
				'Jump to a file after renaming or moving it.',
			],
			antiPatterns: [
				'Do not use it when the user only needs file text.',
				'Do not expect it to confirm file semantics beyond UI navigation.',
				'Do not use it for fuzzy search; path must already be known.',
			],
		},
		inputSchema: jsonObject(
			{
				path: jsonString('Relative file path from the Vault root.'),
				new_panel: jsonBoolean('Whether to open in a new pane.'),
			},
			['path']
		),
		parameterGuide: {
			path: guide(
				'File path to open.',
				[
					parameterExample('projects/roadmap.md', 'Open a project note.'),
				],
				[
					'Resolve wiki links first when needed.',
					'Use a real file path, not a folder path.',
				]
			),
			new_panel: guide(
				'Whether to open in a new editor pane.',
				[
					parameterExample(false, 'Reuse the current pane.'),
					parameterExample(true, 'Open side by side.'),
				],
				[
					'Use `true` when preserving the current editor context matters.',
				],
				{
					defaultBehavior: 'Defaults to `false`.',
				}
			),
		},
		bestPractices: [
			'Use it only when navigation is part of the user-visible task outcome.',
			'Pair it with search or creation tools that provide the final path.',
			'Open in a new pane when the current note should remain visible.',
		],
		performanceTips: [
			'Avoid opening many files in one loop unless the user explicitly requested it.',
		],
		safetyNotes: [
			'UI navigation only; it does not modify note content.',
		],
		commonCombinations: [
			{
				tools: ['search_files', 'open_file'],
				pattern: 'Find then open',
				example: 'Search by title, then open the best-matching note.',
			},
			{
				tools: ['write_file', 'open_file'],
				pattern: 'Create then reveal',
				example: 'Create a note and open it immediately for the user.',
			},
			{
				tools: ['move_file', 'open_file'],
				pattern: 'Reorganize then reveal',
				example: 'Move a note and show it in its new location.',
			},
		],
		prerequisites: [
			'Use `search_files`, `search_path`, or `get_first_link_path` if the path is not known.',
		],
		followUps: [
			'Use `read_file` separately if the content also needs to be analyzed.',
		],
		returnType: {
			description: 'Returns JSON with opened path, pane mode, and success flag.',
			examples: [
				{
					scenario: 'Open in new pane',
					output: '{"path":"projects/roadmap.md","new_panel":true,"opened":true}',
				},
			],
			errorCases: [
				{
					condition: 'Path does not exist',
					errorMessage: 'File not found.',
					resolution: 'Locate the file path before opening it.',
				},
				{
					condition: 'Path is not a file',
					errorMessage: 'Expected a file path.',
					resolution: 'Provide a note file instead of a folder.',
				},
				{
					condition: 'Path lies outside Vault constraints',
					errorMessage: 'Vault path assertion failed.',
					resolution: 'Use a relative Vault path only.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'open file',
			'open note',
			'navigate file',
			'打开文件',
			'打开笔记',
			'跳转到文件'
		),
		intentPatterns: englishAndChinese(
			'open this note',
			'show the file in obsidian',
			'打开这个笔记',
			'在 Obsidian 里打开',
			'帮我跳转过去'
		),
	}),
	defineTool({
		name: 'get_first_link_path',
		serverId,
		serverName,
		category: 'navigation',
		summary: 'Resolve a wiki-link style internal link into the first matching Vault file path.',
		coreCapabilities: [
			'Resolve `[[Note]]` style references to actual Vault file paths.',
			'Use the active file as context for relative or ambiguous resolution.',
			'Strip aliases and heading fragments automatically.',
			'Return a concrete path suitable for follow-up file tools.',
		],
		limitations: [
			'Only resolves Obsidian internal links, not arbitrary search text.',
			'Returns the first matching destination, which may still be ambiguous in duplicate-name Vaults.',
			'Does not read or open the resolved file by itself.',
			'May return `null` when nothing matches.',
		],
		scenarios: {
			primary: [
				'User provides a wiki-link target instead of a file path.',
				'Agent needs to convert an internal link before reading or opening a note.',
				'Active-file-relative link resolution matters.',
			],
			secondary: [
				'Normalize user text that includes alias or heading syntax.',
				'Check whether a wiki link currently resolves in the Vault.',
				'Bridge between natural Obsidian references and path-based tools.',
			],
			antiPatterns: [
				'Do not use it as a generic fuzzy search tool.',
				'Do not expect multiple matches; it only returns one path.',
				'Do not use it when the actual file path is already known.',
			],
		},
		inputSchema: jsonObject(
			{
				internalLink: jsonString('Wiki-link text without surrounding `[[ ]]`.'),
			},
			['internalLink']
		),
		parameterGuide: {
			internalLink: guide(
				'Obsidian internal link text.',
				[
					parameterExample('Roadmap', 'Resolve a plain note name.'),
					parameterExample('Roadmap|Alias', 'Alias is ignored during resolution.'),
				],
				[
					'You can pass the raw inner text without surrounding brackets.',
					'Heading fragments and aliases are stripped automatically.',
				],
				{
					commonMistakes: [
						'Passing an absolute path instead of a wiki-link name.',
						'Expecting it to return file content rather than a path.',
					],
				}
			),
		},
		bestPractices: [
			'Use it as a bridge from human-style wiki links to path-based tools.',
			'Follow immediately with `read_file` or `open_file` when the path resolves.',
			'Handle `null` explicitly when the link has no destination.',
		],
		performanceTips: [
			'Prefer direct paths when available; link resolution is for wiki-link inputs only.',
		],
		safetyNotes: [
			'Read-only operation.',
		],
		commonCombinations: [
			{
				tools: ['get_first_link_path', 'read_file'],
				pattern: 'Resolve then read',
				example: 'Resolve `Roadmap` to a path, then read the note text.',
			},
			{
				tools: ['get_first_link_path', 'open_file'],
				pattern: 'Resolve then open',
				example: 'Resolve a link from user input and open the note in Obsidian.',
			},
			{
				tools: ['search_content', 'get_first_link_path'],
				pattern: 'Find reference then normalize',
				example: 'Search notes that mention a wiki link, then resolve the chosen reference.',
			},
		],
		prerequisites: [
			'Use this only when the input is a wiki-link-like note reference rather than a real path.',
		],
		followUps: [
			'Use `read_file` or `open_file` with the returned path.',
		],
		returnType: {
			description: 'Returns a resolved Vault path string or `null` when no destination exists.',
			examples: [
				{
					scenario: 'Link resolves',
					output: 'projects/Roadmap.md',
				},
				{
					scenario: 'No match',
					output: 'null',
				},
			],
			errorCases: [
				{
					condition: 'No file matches the link',
					errorMessage: 'Returns null.',
					resolution: 'Search for the target note by name or confirm the link text.',
				},
				{
					condition: 'Link is malformed or empty',
					errorMessage: 'Validation error for required string.',
					resolution: 'Pass the inner wiki-link text only.',
				},
				{
					condition: 'Ambiguous duplicate notes',
					errorMessage: 'First match may not be the intended target.',
					resolution: 'Use a more specific path-oriented workflow when ambiguity matters.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'resolve link',
			'wiki link path',
			'internal link',
			'解析双链',
			'解析内部链接',
			'wiki 链接路径'
		),
		intentPatterns: englishAndChinese(
			'resolve this wikilink',
			'what path does this link point to',
			'解析这个双链',
			'这个内部链接指向哪里',
			'把链接变成路径'
		),
	}),
	defineTool({
		name: 'query_vault',
		serverId,
		serverName,
		category: 'query',
		summary: 'Run a JavaScript DSL query over Vault metadata for structured filtering, sorting, and aggregation.',
		coreCapabilities: [
			'Query Vault metadata with a DSL expression.',
			'Support structured operations such as filtering, grouping, sorting, counting, and aggregation.',
			'Return tabular or aggregated results without reading note bodies one by one.',
			'Handle cases where metadata logic is more precise than keyword search.',
		],
		limitations: [
			'Requires a valid query expression rather than natural language.',
			'Focused on indexed metadata and query sources, not arbitrary prose reasoning.',
			'Not the right first tool for fuzzy content discovery.',
			'Expression errors or long-running queries can fail fast under sandbox limits.',
		],
		scenarios: {
			primary: [
				'Need structured filtering on frontmatter or indexed file metadata.',
				'Need counts, grouping, or ordering rather than plain search hits.',
				'Need a database-like answer from Vault records.',
			],
			secondary: [
				'Validate assumptions before expensive file-by-file operations.',
				'Build reports or dashboards from metadata.',
				'Identify a precise working set before reading or writing files.',
			],
			antiPatterns: [
				'Do not use it when plain keyword search is enough.',
				'Do not ask it to interpret vague natural-language instructions.',
				'Do not expect it to mutate the Vault.',
			],
		},
		inputSchema: jsonObject(
			{
				expression: jsonString('JavaScript DSL query expression.'),
			},
			['expression']
		),
		parameterGuide: {
			expression: guide(
				'The full DSL expression to execute.',
				[
					parameterExample(
						"from('files').where(f => f.properties.status === 'done').count()",
						'Count finished notes by metadata.'
					),
					parameterExample(
						"from('files').where(f => f.tags.includes('#project')).orderBy(f => f.path)",
						'List tagged files in path order.'
					),
				],
				[
					'Write the expression explicitly; this tool is not a natural-language translator.',
					'Use search tools first if you are still exploring the data shape.',
				],
				{
					commonMistakes: [
						'Passing a plain-language question instead of DSL code.',
						'Using body-text assumptions that are not available in the metadata query sources.',
					],
				}
			),
		},
		bestPractices: [
			'Prefer this tool when you need exact metadata semantics or aggregation.',
			'Keep expressions focused and test assumptions with simpler filters first.',
			'Use the result set to drive later `read_file` calls only for the selected paths.',
		],
		performanceTips: [
			'Metadata queries are usually cheaper than brute-force reading many notes.',
			'Use aggregation in the query itself rather than returning overly large intermediate sets.',
		],
		safetyNotes: [
			'Read-only structured query.',
			'Expression execution is sandboxed and time-limited.',
		],
		commonCombinations: [
			{
				tools: ['query_vault', 'read_file'],
				pattern: 'Query then inspect',
				example: 'Use a metadata query to isolate target notes, then read the chosen ones.',
			},
			{
				tools: ['query_vault', 'write_plan'],
				pattern: 'Query then plan',
				example: 'Query outstanding work items and turn the result into an execution plan.',
			},
			{
				tools: ['query_vault', 'write_file'],
				pattern: 'Report generation',
				example: 'Query aggregate data and write the report to a new note.',
			},
		],
		prerequisites: [
			'Prefer search tools if you do not yet know the relevant metadata fields.',
		],
		followUps: [
			'Use `read_file` for any records that need body-level inspection after metadata selection.',
		],
		returnType: {
			description: 'Returns query results from the DSL sandbox, often as JSON-like structured data serialized to text.',
			examples: [
				{
					scenario: 'Aggregate count',
					output: '42',
				},
				{
					scenario: 'Selected records',
					output: '[{"path":"projects/roadmap.md","status":"active"}]',
				},
			],
			errorCases: [
				{
					condition: 'Expression syntax or runtime error',
					errorMessage: 'Sandbox query execution failed.',
					resolution: 'Fix the DSL expression and retry with a simpler query first.',
				},
				{
					condition: 'Query exceeds timeout or row limits',
					errorMessage: 'Query timed out or exceeded max rows.',
					resolution: 'Narrow the query or aggregate earlier.',
				},
				{
					condition: 'Referenced field does not exist',
					errorMessage: 'Undefined property or runtime exception.',
					resolution: 'Check field names and inspect sample records first.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'query vault',
			'metadata query',
			'aggregate notes',
			'查询 Vault',
			'元数据查询',
			'结构化筛选'
		),
		intentPatterns: englishAndChinese(
			'run a metadata query',
			'count notes with this property',
			'按属性做统计',
			'结构化查询这些笔记',
			'统计满足条件的文件'
		),
	}),
	defineTool({
		name: 'execute_script',
		serverId,
		serverName,
		category: 'script',
		summary: 'Execute sandboxed JavaScript that can orchestrate other built-in tools and simple logic.',
		coreCapabilities: [
			'Run JavaScript inside the plugin sandbox.',
			'Call other registered tools through `call_tool(name, args)`.',
			'Handle loops, branching, and orchestration that one tool call cannot express.',
			'Use `moment()` helpers in scripted workflows.',
		],
		limitations: [
			'Should not replace direct tools for simple one-step actions.',
			'Bound by the script runtime sandbox and timeout behavior.',
			'Needs a complete script payload, not vague intent.',
			'Can only call tools available inside the Vault built-in runtime.',
		],
		scenarios: {
			primary: [
				'Need to orchestrate several built-in tools with branching logic.',
				'Need a small custom loop or transformation that direct tools cannot express.',
				'Already have a concrete script snippet to run.',
			],
			secondary: [
				'Perform repeated operations over a computed file list.',
				'Build derived content by combining several tool results.',
				'Prototype a more complex workflow before creating a dedicated tool.',
			],
			antiPatterns: [
				'Do not use it for simple read/write/search tasks with direct tools.',
				'Do not enable it in locked-down or read-only environments unless explicitly allowed.',
				'Do not treat it as a shell replacement.',
			],
		},
		inputSchema: jsonObject(
			{
				script: jsonString('JavaScript source to run in the script runtime.'),
			},
			['script']
		),
		parameterGuide: {
			script: guide(
				'Complete JavaScript source text.',
				[
					parameterExample(
						"const text = await call_tool('read_file', { path: 'inbox/todo.md' }); return text;",
						'Read a file from script code.'
					),
					parameterExample(
						"const listing = await call_tool('list_directory', { path: 'daily' }); return listing;",
						'Compose another tool call in script logic.'
					),
				],
				[
					'Keep scripts short and focused on orchestration.',
					'Prefer direct tools unless control flow is the actual requirement.',
				],
				{
					commonMistakes: [
						'Passing prose instead of executable JavaScript.',
						'Using shell syntax instead of JavaScript.',
					],
				}
			),
		},
		bestPractices: [
			'Reach for scripts only when control flow is necessary.',
			'Keep scripts deterministic and explicit about called tools.',
			'Return compact results that the model can easily reason about.',
		],
		performanceTips: [
			'One focused script is better than many fragmented scripts in the same loop.',
			'Avoid reading or writing the same file repeatedly inside the script.',
		],
		safetyNotes: [
			'Script execution should be blocked unless `allowScript` is enabled.',
			'Scripts can chain multiple tool calls, so review them as higher-risk operations.',
		],
		commonCombinations: [
			{
				tools: ['execute_script', 'read_file'],
				pattern: 'Scripted orchestration',
				example: 'Script loops over several known paths and reads each one.',
			},
			{
				tools: ['execute_script', 'write_file'],
				pattern: 'Transform then persist',
				example: 'Script computes derived text, then writes a generated note.',
			},
			{
				tools: ['execute_script', 'write_plan'],
				pattern: 'Scripted planning helper',
				example: 'Script gathers state and returns data used for plan updates.',
			},
		],
		prerequisites: [
			'Confirm that direct tools cannot express the workflow cleanly enough.',
		],
		followUps: [
			'Use direct file or planning tools for explicit follow-up mutations when possible.',
		],
		returnType: {
			description: 'Returns the script result serialized to text by the script runtime.',
			examples: [
				{
					scenario: 'Return a string',
					output: 'Processed 3 files successfully.',
				},
				{
					scenario: 'Return an object',
					output: '{"count":3,"paths":["a.md","b.md","c.md"]}',
				},
			],
			errorCases: [
				{
					condition: 'Script syntax or runtime error',
					errorMessage: 'Script execution failed with stack or message.',
					resolution: 'Fix the JavaScript and retry.',
				},
				{
					condition: 'Nested tool call fails inside script',
					errorMessage: 'Underlying tool error bubbles through script runtime.',
					resolution: 'Inspect the inner tool call arguments and reduce scope.',
				},
				{
					condition: 'Sandbox timeout or disallowed capability',
					errorMessage: 'Script runtime blocked or timed out.',
					resolution: 'Use direct tools or simplify the orchestration.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'execute script',
			'javascript tool',
			'sandbox script',
			'执行脚本',
			'运行 JavaScript',
			'工具编排'
		),
		intentPatterns: englishAndChinese(
			'run this script',
			'use javascript to orchestrate',
			'执行一段脚本',
			'用脚本处理',
			'需要循环调用工具'
		),
	}),
	defineTool({
		name: 'call_shell',
		serverId,
		serverName,
		category: 'script',
		summary: 'Run a desktop shell command, optionally in a Vault-relative working directory.',
		coreCapabilities: [
			'Execute a shell command on desktop builds.',
			'Allow Vault-relative or absolute working directories.',
			'Return stdout, stderr, cwd, and exit code as structured text.',
			'Enable workflows that require external CLI tools such as git or npm.',
		],
		limitations: [
			'Unsupported on non-desktop environments.',
			'Requires explicit opt-in because it reaches the host shell.',
			'Does not provide semantic understanding of command safety by itself.',
			'Long-running or noisy commands are bounded by timeout and buffer limits.',
		],
		scenarios: {
			primary: [
				'Need a real OS command such as `git status`, `ls`, or `npm test`.',
				'Need CLI output that is not exposed by existing Vault tools.',
				'Need to operate on a Vault-relative working directory.',
			],
			secondary: [
				'Inspect repository state before summarizing changes.',
				'Run a narrow build or test command.',
				'Call a local CLI helper that the user already relies on.',
			],
			antiPatterns: [
				'Do not use it when a safer dedicated Vault tool exists.',
				'Do not pass destructive shell commands without explicit allowance.',
				'Do not assume desktop support in every runtime.',
			],
		},
		inputSchema: jsonObject(
			{
				command: jsonString('Shell command to execute.'),
				cwd: jsonString('Optional working directory; relative paths are resolved under the Vault root.'),
			},
			['command']
		),
		parameterGuide: {
			command: guide(
				'Shell command line.',
				[
					parameterExample('git status --short', 'Inspect repository state.'),
					parameterExample('npm test -- --runInBand', 'Run a narrow test command.'),
				],
				[
					'Use focused commands with predictable output.',
					'Prefer read-only inspection commands unless the user explicitly requested mutation.',
				],
				{
					commonMistakes: [
						'Passing destructive commands by default.',
						'Using shell when a built-in tool could do the same job more safely.',
					],
				}
			),
			cwd: guide(
				'Working directory for the command.',
				[
					parameterExample('projects', 'Run inside a Vault subfolder.'),
					parameterExample('/absolute/path', 'Run in an explicit absolute path when truly required.'),
				],
				[
					'Leave empty to use the Vault root absolute path.',
					'Relative values are resolved against the Vault root.',
				],
				{
					defaultBehavior: 'Defaults to the Vault root.',
				}
			),
		},
		bestPractices: [
			'Keep commands narrow, inspectable, and relevant to the user request.',
			'Prefer repository-status commands before running mutating build or git commands.',
			'Capture and summarize stderr as part of the result interpretation.',
		],
		performanceTips: [
			'Avoid commands that stream huge outputs when a filtered variant exists.',
			'Choose a narrow `cwd` to reduce accidental cross-project effects.',
		],
		safetyNotes: [
			'Must be blocked unless `allowShell` is enabled.',
			'Should be filtered for obviously dangerous patterns like recursive deletion of broad paths.',
		],
		commonCombinations: [
			{
				tools: ['call_shell', 'write_file'],
				pattern: 'Command then persist',
				example: 'Run a diagnostic command and write the summarized output into a note.',
			},
			{
				tools: ['call_shell', 'read_file'],
				pattern: 'Inspect repo then inspect file',
				example: 'Use shell to locate changed files, then read a specific one in the Vault.',
			},
			{
				tools: ['call_shell', 'write_plan'],
				pattern: 'Command-driven execution plan',
				example: 'Run tests, then update the active plan based on failures.',
			},
		],
		prerequisites: [
			'Confirm that a built-in Vault or search tool cannot already satisfy the request.',
		],
		followUps: [
			'Use file tools if shell output needs to be converted into note content.',
		],
		returnType: {
			description: 'Returns JSON-like output with `supported`, `cwd`, `stdout`, `stderr`, and `exitCode`.',
			examples: [
				{
					scenario: 'Desktop command success',
					output: '{"supported":true,"cwd":"/vault","stdout":"M file.ts","stderr":"","exitCode":0}',
				},
				{
					scenario: 'Non-desktop runtime',
					output: '{"supported":false,"message":"call_shell 仅支持桌面端","stdout":"","stderr":"","exitCode":-1}',
				},
			],
			errorCases: [
				{
					condition: 'Desktop runtime unavailable',
					errorMessage: 'call_shell 仅支持桌面端',
					resolution: 'Skip shell usage or use non-shell tools.',
				},
				{
					condition: 'Base path cannot be resolved',
					errorMessage: '无法获取 Vault 根目录绝对路径',
					resolution: 'Retry only in a filesystem-backed desktop Vault.',
				},
				{
					condition: 'Command exits non-zero',
					errorMessage: 'exitCode is non-zero with stderr output.',
					resolution: 'Inspect stderr and either fix the command or report the failure.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'call shell',
			'run command',
			'terminal command',
			'执行命令',
			'终端命令',
			'运行 shell'
		),
		intentPatterns: englishAndChinese(
			'run this command',
			'use the shell',
			'执行这个命令',
			'帮我跑一下终端命令',
			'用 shell 看看'
		),
	}),
	defineTool({
		name: 'now',
		serverId,
		serverName,
		category: 'utility',
		summary: 'Get the current time or convert a time between time zones with structured output.',
		coreCapabilities: [
			'Return the current time in a requested format.',
			'Return structured time information for a specified IANA time zone.',
			'Convert a `HH:MM` time between source and target time zones.',
			'Provide reliable temporal data instead of model guesses.',
		],
		limitations: [
			'Only handles current-time lookup or simple one-time-zone conversion.',
			'Timezone conversion mode requires all three conversion arguments.',
			'`timezone` mode cannot be mixed with conversion arguments.',
			'Not a scheduling or calendar planning tool by itself.',
		],
		scenarios: {
			primary: [
				'Need exact current time or date in a specific zone.',
				'Need to convert a meeting time between time zones.',
				'Need a trustworthy timestamp for notes, plans, or summaries.',
			],
			secondary: [
				'Label a generated report with the current time.',
				'Check local time before creating date-based notes.',
				'Resolve ambiguity around user references like "today" or "this evening".',
			],
			antiPatterns: [
				'Do not use it for recurring schedule logic or plan management.',
				'Do not mix current-time mode with conversion mode arguments.',
				'Do not guess time zones when the user asked for exact conversion.',
			],
		},
		inputSchema: jsonObject({
			format: jsonString('Moment.js format string.'),
			timezone: jsonString('IANA time zone name for current-time mode.'),
			source_timezone: jsonString('IANA source time zone for conversion mode.'),
			time: jsonString('24-hour time string like HH:MM for conversion mode.'),
			target_timezone: jsonString('IANA target time zone for conversion mode.'),
		}),
		parameterGuide: {
			format: guide(
				'Output format for plain current-time mode.',
				[
					parameterExample('YYYY-MM-DD HH:mm:ss ddd', 'Default human-readable timestamp.'),
					parameterExample('YYYY-MM-DD', 'Date-only output.'),
				],
				[
					'Useful when you only need a formatted string and not structured timezone info.',
				],
				{
					defaultBehavior: 'Defaults to `YYYY-MM-DD HH:mm:ss ddd`.',
				}
			),
			timezone: guide(
				'IANA timezone for current-time lookup.',
				[
					parameterExample('Asia/Shanghai', 'Get Shanghai current time.'),
					parameterExample('America/New_York', 'Get New York current time.'),
				],
				[
					'Use this mode when you need "current time in X".',
					'Do not combine with conversion arguments.',
				]
			),
			source_timezone: guide(
				'Source timezone for conversion mode.',
				[
					parameterExample('Europe/London', 'Convert from London time.'),
				],
				[
					'Must be used together with `time` and `target_timezone`.',
				]
			),
			time: guide(
				'Local time in `HH:MM` format for conversion mode.',
				[
					parameterExample('14:30', 'Convert 2:30 PM in the source zone.'),
				],
				[
					'Use 24-hour time for deterministic conversion.',
				]
			),
			target_timezone: guide(
				'Destination timezone for conversion mode.',
				[
					parameterExample('America/Los_Angeles', 'Convert into Pacific time.'),
				],
				[
					'Must be used together with `source_timezone` and `time`.',
				]
			),
		},
		bestPractices: [
			'Use the tool whenever exact time matters; do not rely on model memory.',
			'Use timezone mode for "what time is it there?" and conversion mode for "what does 14:30 become there?".',
			'Surface absolute dates and times in follow-up text when ambiguity matters.',
		],
		performanceTips: [
			'One call can resolve a timezone question more reliably than lengthy prompt reasoning.',
		],
		safetyNotes: [
			'Read-only utility tool.',
		],
		commonCombinations: [
			{
				tools: ['now', 'write_file'],
				pattern: 'Timestamp then write',
				example: 'Get the current date, then create a timestamped note.',
			},
			{
				tools: ['now', 'write_plan'],
				pattern: 'Time-aware plan update',
				example: 'Record the current time before updating a live plan or status note.',
			},
			{
				tools: ['now', 'read_file'],
				pattern: 'Time-contextual analysis',
				example: 'Read a daily note after resolving the correct current date.',
			},
		],
		prerequisites: [
			'Choose either current-time mode or conversion mode before calling the tool.',
		],
		followUps: [
			'Use the returned date or converted time in later file writes or summaries.',
		],
		returnType: {
			description: 'Returns either a formatted string or structured timezone/conversion data depending on mode.',
			examples: [
				{
					scenario: 'Plain current time',
					output: '2026-03-09 10:30:00 Mon',
				},
				{
					scenario: 'Timezone conversion',
					output: '{"source_timezone":"Europe/London","target_timezone":"America/New_York","source_time":"14:30","target_time":"09:30"}',
				},
			],
			errorCases: [
				{
					condition: 'Timezone mode mixed with conversion args',
					errorMessage: 'Argument conflict: timezone cannot be used together with source_timezone/time/target_timezone',
					resolution: 'Choose one mode only.',
				},
				{
					condition: 'Conversion mode missing required args',
					errorMessage: 'Missing required arguments for conversion mode',
					resolution: 'Provide all of `source_timezone`, `time`, and `target_timezone`.',
				},
				{
					condition: 'Timezone name is invalid',
					errorMessage: 'Timezone parsing or formatting failed.',
					resolution: 'Use valid IANA timezone names.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'current time',
			'timezone conversion',
			'what time is it',
			'当前时间',
			'时区转换',
			'现在几点'
		),
		intentPatterns: englishAndChinese(
			'what time is it in shanghai',
			'convert 14:30 to new york time',
			'现在上海几点',
			'把 14:30 转成纽约时间',
			'给我当前时间'
		),
	}),
	defineTool({
		name: 'write_plan',
		serverId,
		serverName,
		category: 'planning',
		summary: 'Create or update the live in-memory execution plan for the current chat workflow.',
		coreCapabilities: [
			'Create a structured task plan with statuses.',
			'Update task progress during long multi-step work.',
			'Store acceptance criteria and outcomes for each step.',
			'Keep the chat session and plan snapshot in sync.',
		],
		limitations: [
			'It tracks plan state but does not perform the planned work itself.',
			'Plan data is session-scoped rather than a Vault note by default.',
			'Requires at least one task entry.',
			'Statuses are limited to the supported enum values.',
		],
		scenarios: {
			primary: [
				'Need explicit multi-step task tracking inside the session.',
				'Need to update progress after completing a work stage.',
				'Need acceptance criteria or outcomes attached to work items.',
			],
			secondary: [
				'Keep long-running implementation work organized.',
				'Make a hidden execution plan before tool-heavy work.',
				'Capture intermediate outcomes for plan continuity.',
			],
			antiPatterns: [
				'Do not use it as a substitute for real file writes or tool execution.',
				'Do not overuse it for one-step tasks.',
				'Do not delegate work to it; it only records plan state.',
			],
		},
		inputSchema: jsonObject(
			{
				title: jsonString('Optional plan title.'),
				description: jsonString('Optional plan description.'),
				tasks: jsonArray(
					'List of plan tasks.',
					jsonObject(
						{
							name: jsonString('Task name.'),
							status: enumSchema('Task status.', ['todo', 'in_progress', 'done', 'skipped']),
							acceptance_criteria: jsonArray('Optional acceptance criteria.', jsonString('Criterion text.')),
							outcome: jsonString('Optional task outcome summary.'),
						},
						['name', 'status']
					)
				),
			},
			['tasks']
		),
		parameterGuide: {
			title: guide(
				'Optional title for the plan.',
				[
					parameterExample('Refactor tool agent', 'Name the workstream clearly.'),
				],
				[
					'Use a stable title across updates so plan continuity is clear.',
				]
			),
			description: guide(
				'Optional high-level plan description.',
				[
					parameterExample('Replace two-phase tool search with a dedicated execution agent.', 'Add context for the plan.'),
				],
				[
					'Keep it concise; the real progress lives in tasks.',
				]
			),
			tasks: guide(
				'Ordered task list with statuses.',
				[
					parameterExample(
						[
							{ name: 'Analyze code', status: 'done' },
							{ name: 'Implement agent', status: 'in_progress' },
						],
						'Two-step plan update.'
					),
				],
				[
					'Represent the whole current plan in one call, not just the changed task.',
					'Use `acceptance_criteria` and `outcome` when the task needs explicit completion evidence.',
				],
				{
					commonMistakes: [
						'Calling it with an empty task list.',
						'Expecting it to run the tasks automatically.',
					],
				}
			),
		},
		bestPractices: [
			'Use it for genuinely multi-step work where plan continuity matters.',
			'Update statuses as soon as progress changes to keep the plan truthful.',
			'Record outcomes when a task is done or skipped to preserve context.',
		],
		performanceTips: [
			'One coherent plan update is better than many tiny status churn calls.',
		],
		safetyNotes: [
			'This mutates live session state, not Vault content.',
			'Read-only constraints may still allow it depending on policy, but planning mutations should be intentional.',
		],
		commonCombinations: [
			{
				tools: ['write_plan', 'read_file'],
				pattern: 'Plan then execute',
				example: 'Write an execution plan, then read files as each step proceeds.',
			},
			{
				tools: ['write_plan', 'query_vault'],
				pattern: 'Structured planning workflow',
				example: 'Plan the task, query metadata for targets, then update plan status.',
			},
			{
				tools: ['write_plan', 'delegate_to_agent'],
				pattern: 'Plan and delegate',
				example: 'Track the plan while handing a subtask to another agent.',
			},
		],
		prerequisites: [
			'Use it when the session benefits from explicit tracked steps rather than implicit reasoning only.',
		],
		followUps: [
			'Update the same plan after major milestones or completion changes.',
		],
		returnType: {
			description: 'Returns the full normalized plan snapshot with derived summary counts.',
			examples: [
				{
					scenario: 'Two-task plan',
					output: '{"title":"Refactor","tasks":[{"name":"Analyze","status":"done"},{"name":"Implement","status":"in_progress"}],"summary":{"total":2,"todo":0,"inProgress":1,"done":1,"skipped":0}}',
				},
			],
			errorCases: [
				{
					condition: 'Tasks array is empty',
					errorMessage: 'Validation error for minimum one task.',
					resolution: 'Provide at least one task.',
				},
				{
					condition: 'Invalid task status',
					errorMessage: 'Status must be one of todo/in_progress/done/skipped.',
					resolution: 'Use supported status values only.',
				},
				{
					condition: 'Malformed task object',
					errorMessage: 'Missing required `name` or `status`.',
					resolution: 'Send complete task objects.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'write plan',
			'update plan',
			'task tracking',
			'写计划',
			'更新计划',
			'任务拆解'
		),
		intentPatterns: englishAndChinese(
			'create a plan',
			'update the task plan',
			'写一个执行计划',
			'更新当前计划',
			'拆分成几个步骤'
		),
	}),
	defineTool({
		name: 'delegate_to_agent',
		serverId,
		serverName,
		category: 'agent',
		summary: 'Delegate a task to a registered agent handler and return that agent’s result.',
		coreCapabilities: [
			'Dispatch a task to a named registered agent id.',
			'Return the delegated agent result as structured text.',
			'Enable agent-to-agent separation when a specialized handler exists.',
			'Keep delegation explicit via id and task payload.',
		],
		limitations: [
			'Only works for agents registered in the current runtime.',
			'Current built-in runtime only registers `builtin.echo` by default.',
			'Does not discover or compose agent graphs automatically.',
			'Delegation quality depends entirely on the registered handler implementation.',
		],
		scenarios: {
			primary: [
				'Need to hand work to an explicitly registered specialist agent.',
				'Need to test or use the built-in delegation hook.',
				'Need a clean boundary between current orchestration and delegated execution.',
			],
			secondary: [
				'Prototype future agent collaboration patterns.',
				'Call a no-op or echo agent for routing validation.',
				'Separate planning from execution ownership where handlers exist.',
			],
			antiPatterns: [
				'Do not use it for simple file or search work that direct tools can do immediately.',
				'Do not assume rich agent capabilities unless the target id is actually registered.',
				'Do not use it as a replacement for `write_plan` or `execute_script`.',
			],
		},
		inputSchema: jsonObject(
			{
				id: jsonString('Registered agent id.'),
				task: jsonString('Delegated task description.'),
			},
			['id', 'task']
		),
		parameterGuide: {
			id: guide(
				'Registered agent identifier.',
				[
					parameterExample('builtin.echo', 'Use the default built-in echo agent.'),
				],
				[
					'Check that the runtime actually registered the agent.',
					'Do not guess unsupported ids.',
				],
				{
					commonMistakes: [
						'Assuming arbitrary agent ids exist.',
					],
				}
			),
			task: guide(
				'Task text to send to the delegated agent.',
				[
					parameterExample('Summarize the current task state.', 'Simple delegated request.'),
				],
				[
					'Be explicit; the delegated handler receives only the task and id context.',
				]
			),
		},
		bestPractices: [
			'Use it only when the target agent is known and purposeful.',
			'Keep delegated tasks self-contained because handler context is limited.',
			'Treat unknown-agent failures as routing failures, not content failures.',
		],
		performanceTips: [
			'Avoid unnecessary delegation layers for work that direct tools can complete faster.',
		],
		safetyNotes: [
			'Delegation can hide additional logic behind the handler; review allowed agent ids carefully.',
		],
		commonCombinations: [
			{
				tools: ['write_plan', 'delegate_to_agent'],
				pattern: 'Track and delegate',
				example: 'Record the plan, then delegate a subtask to a specialized agent.',
			},
			{
				tools: ['delegate_to_agent', 'read_file'],
				pattern: 'Delegate then inspect result',
				example: 'Delegate a routing step, then inspect files based on the returned recommendation.',
			},
			{
				tools: ['delegate_to_agent', 'write_file'],
				pattern: 'Delegate then persist',
				example: 'Delegate content generation, then write the returned artifact.',
			},
		],
		prerequisites: [
			'Confirm that the agent id exists in the current runtime.',
		],
		followUps: [
			'Use direct tools on the delegated result when the returned payload points to concrete file work.',
		],
		returnType: {
			description: 'Returns JSON with the delegated id, the task text, and the downstream agent result.',
			examples: [
				{
					scenario: 'Builtin echo agent',
					output: '{"id":"builtin.echo","task":"Summarize current work","result":{"id":"builtin.echo","task":"Summarize current work","status":"ok"}}',
				},
			],
			errorCases: [
				{
					condition: 'Agent id is not registered',
					errorMessage: '未注册代理',
					resolution: 'Use a valid registered id or avoid delegation.',
				},
				{
					condition: 'Task text is empty',
					errorMessage: 'task 不能为空',
					resolution: 'Provide a non-empty delegated task.',
				},
				{
					condition: 'Agent handler throws',
					errorMessage: 'Delegated agent execution failed.',
					resolution: 'Inspect the handler-specific failure and retry only if appropriate.',
				},
			],
		},
		searchKeywords: englishAndChinese(
			'delegate agent',
			'agent handoff',
			'sub agent',
			'委托代理',
			'子代理',
			'代理转交'
		),
		intentPatterns: englishAndChinese(
			'delegate this task to an agent',
			'hand this off',
			'把任务委托给代理',
			'交给子代理处理',
			'代理接手这个任务'
		),
	}),
];
