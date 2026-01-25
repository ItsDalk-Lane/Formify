import { Check, Copy, PenSquare, RotateCw, TextCursorInput, Trash2, X, Maximize2, Download, Highlighter, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle2, Repeat, Clock3 } from 'lucide-react';
import { Component, Platform } from 'obsidian';
import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import type { ChatMessage } from '../types/chat';
import type { ToolCall, ToolExecution } from '../types/tools';
import { ChatService } from '../services/ChatService';
import { MessageService } from '../services/MessageService';
import { renderMarkdownContent, parseContentBlocks, hasReasoningBlock, ContentBlock } from '../utils/markdown';
import { Notice } from 'obsidian';
import { EmbeddedToolApproval } from './EmbeddedToolApproval';

interface MessageItemProps {
	message: ChatMessage;
	service?: ChatService;
	isGenerating?: boolean;
	pendingToolExecutions?: ToolExecution[];
	toolExecutions?: ToolExecution[];
}

// 格式化推理耗时
const formatDuration = (durationMs: number): string => {
	const centiSeconds = Math.max(1, Math.round(durationMs / 10))
	return `${(centiSeconds / 100).toFixed(2)}s`
}

// 格式化工具结果（支持 JSON 对象美化显示）
const formatToolResult = (result: string): string => {
	try {
		const parsed = JSON.parse(result);
		if (typeof parsed === 'object' && parsed !== null) {
			return JSON.stringify(parsed, null, 2);
		}
		return result;
	} catch {
		return result;
	}
}

// 推理块组件
interface ReasoningBlockProps {
	content: string;
	startMs: number;
	durationMs?: number;
	isGenerating: boolean;
}

const formatArgsValue = (value: unknown): string => {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return '';
	}
};

const buildArgsText = (pairs: Array<[string, unknown]>): string => {
	return pairs
		.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
		.map(([label, value]) => `${label}: ${formatArgsValue(value)}`)
		.join('\n');
};

const getToolCallDisplay = (call: { name: string; arguments?: Record<string, any>; result?: string }) => {
	const args = call.arguments ?? {};
	const toolName = String(call.name ?? '').trim();
	const lowerName = toolName.toLowerCase();

	switch (lowerName) {
		case 'write_file': {
			const filePath = args.filePath ?? args.path ?? args.file_path;
			const content = args.content ?? args.text ?? args.body ?? args.data;
			const summaryPath = typeof filePath === 'string' && filePath.trim() ? filePath : '';
			const length = typeof content === 'string' ? `${content.length}字` : '';
			return {
				title: '写入文件',
				summary: summaryPath ? `${summaryPath}${length ? `（${length}）` : ''}` : '',
				contentLabel: '写入内容',
				contentText: typeof content === 'string' ? content : formatArgsValue(content),
				resultLabel: '写入结果'
			};
		}
		case 'read_file': {
			const filePath = args.path ?? args.filePath ?? args.file_path;
			return {
				title: '读取文件',
				summary: typeof filePath === 'string' ? filePath : '',
				contentLabel: '读取路径',
				contentText: buildArgsText([['path', filePath]]),
				resultLabel: '读取结果'
			};
		}
		case 'delete_file': {
			const filePath = args.path ?? args.filePath ?? args.file_path;
			return {
				title: '删除文件',
				summary: typeof filePath === 'string' ? filePath : '',
				contentLabel: '删除路径',
				contentText: buildArgsText([['path', filePath]]),
				resultLabel: '删除结果'
			};
		}
		case 'move_file': {
			return {
				title: '移动文件',
				summary: args.from && args.to ? `${args.from} -> ${args.to}` : '',
				contentLabel: '移动信息',
				contentText: buildArgsText([
					['from', args.from],
					['to', args.to]
				]),
				resultLabel: '移动结果'
			};
		}
		case 'list_directory': {
			return {
				title: '列出目录',
				summary: typeof args.path === 'string' ? args.path : '/',
				contentLabel: '目录路径',
				contentText: buildArgsText([['path', args.path || '/']]),
				resultLabel: '目录条目'
			};
		}
		case 'search_files': {
			return {
				title: '文件名搜索',
				summary: typeof args.query === 'string' ? args.query : '',
				contentLabel: '搜索参数',
				contentText: buildArgsText([
					['query', args.query],
					['scope', args.scope ?? 'vault'],
					['limit', args.limit ?? 100]
				]),
				resultLabel: '搜索结果'
			};
		}
		case 'search_content': {
			return {
				title: '内容搜索',
				summary: typeof args.query === 'string' ? args.query : '',
				contentLabel: '搜索参数',
				contentText: buildArgsText([
					['query', args.query],
					['scope', args.scope ?? 'vault'],
					['limit', args.limit ?? 10]
				]),
				resultLabel: '匹配内容'
			};
		}
		case 'open_file': {
			return {
				title: '打开文件',
				summary: typeof args.path === 'string' ? args.path : '',
				contentLabel: '打开路径',
				contentText: buildArgsText([['path', args.path]]),
				resultLabel: '打开结果'
			};
		}
		case 'write_plan': {
			const tasks = Array.isArray(args.tasks) ? args.tasks.length : 0;
			return {
				title: '更新计划',
				summary: tasks ? `任务数: ${tasks}` : '',
				contentLabel: '计划任务',
				contentText: formatArgsValue(args.tasks ?? []),
				resultLabel: '计划结果'
			};
		}
		case 'web_fetch': {
			return {
				title: '抓取网页',
				summary: typeof args.url === 'string' ? args.url : '',
				contentLabel: '抓取地址',
				contentText: buildArgsText([
					['url', args.url],
					['maxLength', args.maxLength ?? 50000]
				]),
				resultLabel: '抓取结果'
			};
		}
		case 'execute_script': {
			return {
				title: '执行脚本',
				summary: typeof args.script === 'string' ? args.script.slice(0, 30) : '',
				contentLabel: '执行脚本',
				contentText: typeof args.script === 'string' ? args.script : '',
				resultLabel: '执行结果'
			};
		}
		default: {
			const filePath = args.filePath ?? args.path ?? args.file ?? args.target;
			const url = args.url ?? args.uri ?? args.link;
			const name = args.name ?? args.title ?? args.query;
			const summary =
				(typeof filePath === 'string' && filePath.trim().length > 0)
					? filePath
					: (typeof url === 'string' && url.trim().length > 0)
						? url
						: (typeof name === 'string' && name.trim().length > 0)
							? name
							: '';
			return {
				title: toolName || '工具调用',
				summary,
				contentLabel: '参数',
				contentText: formatArgsValue(args),
				resultLabel: '结果'
			};
		}
	}
};

const buildToolCallSignature = (call: ToolCall): string => {
	const argsText = call.arguments ? formatArgsValue(call.arguments) : '';
	const resultText = call.result ?? '';
	return `${call.id}|${call.name}|${call.status}|${argsText}|${resultText}`;
};

const buildExecutionSignatureMap = (executions: ToolExecution[], toolCallIds: Set<string>) => {
	const map = new Map<string, string>();
	executions.forEach((execution) => {
		if (!execution.toolCallId || !toolCallIds.has(execution.toolCallId)) return;
		map.set(execution.toolCallId, `${execution.id}|${execution.status}|${execution.error ?? ''}`);
	});
	return map;
};

interface ToolCallListProps {
	toolCalls: ToolCall[];
	toolExecutions?: ToolExecution[];
	service?: ChatService;
	messageId: string;
}

const ToolCallList = memo(
	({ toolCalls, toolExecutions, service, messageId }: ToolCallListProps) => {
		const executionMap = useMemo(() => {
			const map = new Map<string, ToolExecution>();
			(toolExecutions ?? []).forEach((exec) => {
				if (exec.toolCallId) {
					map.set(exec.toolCallId, exec);
				}
			});
			return map;
		}, [toolExecutions]);
		const completedCount = toolCalls.filter((call) => {
			const exec = executionMap.get(call.id);
			return exec?.status === 'completed' || call.status === 'completed';
		}).length;
		const failedCount = toolCalls.filter((call) => {
			const exec = executionMap.get(call.id);
			return exec?.status === 'failed' || exec?.status === 'rejected' || call.status === 'failed';
		}).length;
		const totalCount = toolCalls.length;
		const inProgressCount = Math.max(totalCount - completedCount - failedCount, 0);

		return (
			<div className="ff-tool-call-list">
				<div className="ff-tool-call__progress">
					{inProgressCount > 0 ? (
						<span>执行中 {completedCount}/{totalCount} 个工具</span>
					) : (
						<span>已完成 {completedCount}/{totalCount} 个工具</span>
					)}
				</div>
				{toolCalls.map((call) => {
					const exec = executionMap.get(call.id);
					const canRetry = call.status === 'failed' || exec?.status === 'failed' || exec?.status === 'rejected';
					return (
						<ToolCallItem
							key={call.id}
							call={call}
							execution={exec}
							canRetry={!!service && canRetry}
							onRetry={
								service
									? () => void service.retryToolCall(messageId, call.id)
									: undefined
							}
							onApprove={
								exec && service ? () => void service.approveToolExecution(exec.id) : undefined
							}
							onReject={
								exec && service ? () => void service.rejectToolExecution(exec.id) : undefined
							}
						/>
					);
				})}
			</div>
		);
	},
	(prev, next) => {
		if (prev.messageId !== next.messageId) return false;
		if (prev.service !== next.service) return false;
		if (prev.toolCalls.length !== next.toolCalls.length) return false;
		const prevSignatures = prev.toolCalls.map(buildToolCallSignature);
		const nextSignatures = next.toolCalls.map(buildToolCallSignature);
		for (let i = 0; i < prevSignatures.length; i += 1) {
			if (prevSignatures[i] !== nextSignatures[i]) return false;
		}

		const toolCallIds = new Set(prev.toolCalls.map((call) => call.id));
		const prevExecutionMap = buildExecutionSignatureMap(prev.toolExecutions ?? [], toolCallIds);
		const nextExecutionMap = buildExecutionSignatureMap(next.toolExecutions ?? [], toolCallIds);
		if (prevExecutionMap.size !== nextExecutionMap.size) return false;
		for (const [toolCallId, signature] of prevExecutionMap.entries()) {
			if (nextExecutionMap.get(toolCallId) !== signature) return false;
		}
		return true;
	}
);

const ToolCallItem = ({
	call,
	execution,
	canRetry,
	onRetry,
	onApprove,
	onReject
}: {
	call: { id: string; name: string; status: string; arguments?: Record<string, any>; result?: string };
	execution?: ToolExecution;
	canRetry: boolean;
	onRetry?: () => void;
	onApprove?: () => void;
	onReject?: () => void;
}) => {
	const [collapsed, setCollapsed] = useState(true);
	const display = useMemo(() => getToolCallDisplay(call), [call]);
	const resolvedStatus = execution?.status ?? call.status;
	const dotStatus =
		resolvedStatus === 'completed'
			? 'success'
			: resolvedStatus === 'failed' || resolvedStatus === 'rejected'
				? 'error'
				: 'pending';
	const statusText =
		execution?.status === 'pending'
			? '待审批'
			: execution?.status === 'approved' || execution?.status === 'executing'
				? '执行中'
				: execution?.status === 'completed' || call.status === 'completed'
					? '已完成'
					: execution?.status === 'failed' || call.status === 'failed'
						? '执行失败'
						: execution?.status === 'rejected'
							? '已拒绝'
							: '待处理';
	const contentText = display.contentText;
	const statusIcon =
		statusText === '执行中' ? (
			<Loader2 className="tw-size-3 tw-animate-spin" />
		) : statusText === '已完成' ? (
			<CheckCircle2 className="tw-size-3" />
		) : statusText === '执行失败' || statusText === '已拒绝' ? (
			<AlertCircle className="tw-size-3" />
		) : (
			<Clock3 className="tw-size-3" />
		);

	return (
		<div className="ff-tool-call">
			<div className="ff-tool-call__header" onClick={() => setCollapsed((prev) => !prev)}>
				<span className={`ff-tool-call__dot ff-tool-call__dot--${dotStatus}`} />
				<span className="ff-tool-call__toggle">
					{collapsed ? <ChevronRight className="tw-size-4" /> : <ChevronDown className="tw-size-4" />}
				</span>
				<span className="ff-tool-call__status">
					{statusIcon}
					<span>{statusText}</span>
				</span>
				<span className="ff-tool-call__name" title={display.title}>
					{display.title}
				</span>
				{display.summary && (
					<span className="ff-tool-call__summary" title={display.summary}>
						{display.summary}
					</span>
				)}
				{canRetry && onRetry && (
					<button
						type="button"
						className="ff-tool-call__retry"
						onClick={(event) => {
							event.stopPropagation();
							onRetry();
						}}
						title="重试"
					>
						<Repeat className="tw-size-3" />
						<span>重试</span>
					</button>
				)}
			</div>
			{!collapsed && (
				<div className="ff-tool-call__body">
					<div className="ff-tool-call__section">
						<div className="ff-tool-call__label">{display.contentLabel}</div>
						<pre className="ff-tool-call__code">{contentText || '（无内容）'}</pre>
					</div>
					{execution?.status === 'pending' && (
						<div className="ff-tool-call__section ff-tool-call__actions">
							<button
								type="button"
								className="ff-tool-call__action"
								onClick={(event) => {
									event.stopPropagation();
									onApprove?.();
								}}
							>
								允许
							</button>
							<button
								type="button"
								className="ff-tool-call__action ff-tool-call__action--danger"
								onClick={(event) => {
									event.stopPropagation();
									onReject?.();
								}}
							>
								拒绝
							</button>
						</div>
					)}
					{call.result && call.result.trim().length > 0 && (
						<div className="ff-tool-call__section">
							<div className="ff-tool-call__label">{display.resultLabel}</div>
							<pre className="ff-tool-call__code">{formatToolResult(call.result)}</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
};

const ReasoningBlockComponent = ({ content, startMs, durationMs, isGenerating }: ReasoningBlockProps) => {
	const [collapsed, setCollapsed] = useState(false);
	const [elapsedTime, setElapsedTime] = useState('0.00s');
	const contentRef = useRef<HTMLDivElement>(null);
	
	// 推理完成后自动折叠
	useEffect(() => {
		if (durationMs !== undefined) {
			setCollapsed(true);
			setElapsedTime(formatDuration(durationMs));
		}
	}, [durationMs]);
	
	// 实时更新计时器
	useEffect(() => {
		if (durationMs !== undefined) return; // 已完成，不需要计时
		if (!isGenerating) return;
		
		let rafId: number;
		const tick = () => {
			const elapsed = Date.now() - startMs;
			setElapsedTime(`${(elapsed / 1000).toFixed(2)}s`);
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		
		return () => {
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [startMs, durationMs, isGenerating]);
	
	// 自动滚动到底部
	useEffect(() => {
		if (!collapsed && contentRef.current && isGenerating) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight;
		}
	}, [content, collapsed, isGenerating]);
	
	const toggleCollapse = useCallback(() => {
		setCollapsed(prev => !prev);
	}, []);
	
	return (
		<div className="ff-reasoning-block">
			<div 
				className="ff-reasoning-header"
				onClick={toggleCollapse}
			>
				<span className="ff-reasoning-toggle">
					{collapsed ? <ChevronRight className="tw-size-4" /> : <ChevronDown className="tw-size-4" />}
				</span>
				<span className="ff-reasoning-title">深度思考</span>
				<span className="ff-reasoning-time">{elapsedTime}</span>
			</div>
			{!collapsed && (
				<div 
					ref={contentRef}
					className="ff-reasoning-content"
				>
					{content}
				</div>
			)}
		</div>
	);
};

interface MessageItemProps {
	message: ChatMessage;
	service?: ChatService;
	isGenerating?: boolean;
	pendingToolExecutions?: ToolExecution[];
	toolExecutions?: ToolExecution[];
}

// 文本块组件 - 用于渲染 Markdown 内容
interface TextBlockProps {
	content: string;
	app: any;
}

const TextBlockComponent = ({ content, app }: TextBlockProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef(new Component());
	
	useEffect(() => {
		if (!containerRef.current) return;
		
		const run = async () => {
			await renderMarkdownContent(app, content, containerRef.current as HTMLDivElement, componentRef.current);
		};
		void run();
		
		return () => {
			componentRef.current.unload();
		};
	}, [app, content]);
	
	return <div ref={containerRef}></div>;
};

export const MessageItem = ({ message, service, isGenerating, pendingToolExecutions, toolExecutions }: MessageItemProps) => {
	const app = useObsidianApp();
	const helper = useMemo(() => new MessageService(), []);
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.content);
	const [previewImage, setPreviewImage] = useState<string | null>(null);
	const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);

	const timestamp = useMemo(() => helper.formatTimestamp(message.timestamp), [helper, message.timestamp]);
	
	// 解析内容块
	useEffect(() => {
		const blocks = parseContentBlocks(message.content);
		setContentBlocks(blocks);
	}, [message.content]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (error) {
			console.error('[Chat] 复制失败', error);
		}
	};

	const handleDelete = () => {
		service?.deleteMessage(message.id);
	};

	const handleSaveEdit = async () => {
		// 立即退出编辑模式
		setEditing(false);

		if (service) {
			await service.editAndRegenerate(message.id, draft);
		}
	};

	const handleCancelEdit = () => {
		setDraft(message.content); // 恢复原始内容
		setEditing(false);
	};

	const handleInsert = () => service?.insertMessageToEditor(message.id);

	const handleRegenerate = () => service?.regenerateFromMessage(message.id);

	// 处理图片点击，打开预览
	const handleImageClick = (imageSrc: string) => {
		setPreviewImage(imageSrc);
	};

	// 关闭图片预览
	const closeImagePreview = () => {
		setPreviewImage(null);
	};

	// 下载图片
	const handleDownloadImage = async (imageSrc: string, index: number) => {
		try {
			// 如果是Obsidian附件格式，提取文件名
			const attachmentMatch = imageSrc.match(/\!\[\[(.*?)\|/);
			let fileName = `generated-image-${index + 1}.png`;
			
			if (attachmentMatch) {
				fileName = attachmentMatch[1];
			} else if (imageSrc.startsWith('data:')) {
				// 如果是base64格式，使用默认文件名
				fileName = `generated-image-${index + 1}.png`;
			} else if (imageSrc.startsWith('http')) {
				// 如果是URL，使用URL中的文件名或默认文件名
				const urlParts = imageSrc.split('/');
				const urlFileName = urlParts[urlParts.length - 1];
				fileName = urlFileName.includes('.') ? urlFileName : `generated-image-${index + 1}.png`;
			}

			// 创建下载链接
			let downloadUrl = imageSrc;
			
			if (imageSrc.startsWith('data:')) {
				// Base64图片直接下载
				const link = document.createElement('a');
				link.href = imageSrc;
				link.download = fileName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			} else if (imageSrc.startsWith('http')) {
				// URL图片需要先获取
				const response = await fetch(imageSrc);
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download = fileName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			} else if (imageSrc.includes('[[') && imageSrc.includes(']]')) {
				// Obsidian附件，尝试获取文件
				const attachmentPath = imageSrc.match(/\!\[\[(.*?)\|/)?.[1] || imageSrc.match(/\!\[\[(.*?)\]\]/)?.[1];
				if (attachmentPath) {
					const file = app.vault.getAbstractFileByPath(attachmentPath);
					if (file instanceof app.vault.adapter.constructor.file) {
						const arrayBuffer = await app.vault.readBinary(file);
						const blob = new Blob([arrayBuffer]);
						const url = URL.createObjectURL(blob);
						const link = document.createElement('a');
						link.href = url;
						link.download = file.name;
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						URL.revokeObjectURL(url);
					}
				}
			}
		} catch (error) {
			console.error('[Chat] 下载图片失败', error);
			new Notice('下载图片失败，请稍后再试');
		}
	};

	const roleClass =
		message.role === 'user'
			? 'chat-message--user'
			: message.role === 'assistant'
				? 'chat-message--assistant'
				: 'chat-message--system';
	const toolCalls = message.toolCalls ?? [];

	return (
		<>
			<div className={`group tw-mx-2 tw-my-1 tw-rounded-md tw-p-2 ${roleClass} ${message.isError ? 'chat-message--error' : ''}`}>
				{/* 显示图片 */}
				{message.images && message.images.length > 0 && (
					<div className="message-images tw-mb-2 tw-flex tw-flex-wrap tw-gap-2">
						{message.images.map((image, index) => (
							<div key={index} className="tw-relative tw-group/image">
								<img 
									src={image} 
									alt={`message-image-${index}`} 
									className="message-image tw-max-w-xs tw-rounded-md tw-border tw-border-gray-300 tw-cursor-pointer hover:tw-opacity-80 tw-transition-opacity" 
									style={{ maxHeight: '200px' }}
									onClick={() => handleImageClick(image)}
								/>
								{/* 图片操作按钮 */}
								<div className="tw-absolute tw-top-2 tw-right-2 tw-opacity-0 group-hover/image:tw-opacity-100 tw-transition-opacity tw-flex tw-gap-1">
									<button
										onClick={() => handleImageClick(image)}
										className="tw-bg-black tw-bg-opacity-50 tw-text-white tw-rounded tw-p-1 tw-cursor-pointer hover:tw-bg-opacity-70"
										title="查看大图"
									>
										<Maximize2 className="tw-size-3" />
									</button>
									<button
										onClick={() => handleDownloadImage(image, index)}
										className="tw-bg-black tw-bg-opacity-50 tw-text-white tw-rounded tw-p-1 tw-cursor-pointer hover:tw-bg-opacity-70"
										title="下载图片"
									>
										<Download className="tw-size-3" />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
				
				{/* 处理消息内容中的图片（Obsidian附件格式）*/}
				{!message.images || message.images.length === 0 && (
					// 这里可以添加对消息内容中图片的处理逻辑
					<div></div>
				)}

				{/* 显示选中文本标签 */}
				{message.metadata?.selectedText && typeof message.metadata.selectedText === 'string' && (
					<div className="message-selected-text tw-mb-2">
						<div className="tw-flex tw-items-center tw-gap-1 tw-px-2 tw-py-1 tw-bg-orange-100 tw-text-orange-700 tw-rounded tw-text-xs">
							<Highlighter className="tw-size-3 tw-flex-shrink-0" />
							<span className="tw-max-w-60 tw-truncate" title={message.metadata.selectedText}>
								{message.metadata.selectedText.length > 50
									? message.metadata.selectedText.substring(0, 50) + '...'
									: message.metadata.selectedText}
							</span>
						</div>
					</div>
				)}

				{/* 工具调用徽章 */}
				{toolCalls.length > 0 && (
					<ToolCallList
						toolCalls={toolCalls}
						toolExecutions={toolExecutions}
						service={service}
						messageId={message.id}
					/>
				)}

				{/* 内嵌审批界面 */}
				{toolCalls.length > 0 && pendingToolExecutions && (
					<EmbeddedToolApproval
						toolCalls={toolCalls}
						pendingExecutions={pendingToolExecutions}
						onApprove={(executionId) => service?.approveToolExecution(executionId)}
						onReject={(executionId) => service?.rejectToolExecution(executionId)}
					/>
				)}

				<div className="chat-message__content tw-break-words">
					{editing ? (
						<textarea
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							className="chat-message__editor"
							rows={4}
						/>
					) : (
						// 渲染所有内容块
						contentBlocks.map((block, index) => {
							if (block.type === 'reasoning') {
								return (
									<ReasoningBlockComponent
										key={`reasoning-${index}`}
										content={block.content}
										startMs={block.startMs}
										durationMs={block.durationMs}
										isGenerating={isGenerating ?? false}
									/>
								);
							}
							return (
								<TextBlockComponent
									key={`text-${index}`}
									content={block.content}
									app={app}
								/>
							);
						})
					)}
				</div>
				{/* 只在AI消息非生成状态或非AI消息时显示元数据 */}
				{(message.role !== 'assistant' || !isGenerating) && (
					<div className="chat-message__meta tw-flex tw-items-center tw-justify-between">
						<span className="tw-text-xs tw-text-faint">{timestamp}</span>
						<div className="chat-message__actions tw-flex tw-items-center tw-gap-2 tw-opacity-100 hover:tw-opacity-100 tw-transition-opacity">
							{/* User message buttons */}
							{message.role === 'user' && (
								<>
									<span onClick={handleCopy} aria-label="复制消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										{copied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
									</span>
									{!editing && (
										<span onClick={() => setEditing(true)} aria-label="编辑消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
											<PenSquare className="tw-size-4" />
										</span>
									)}
									{editing && (
										<>
											<span onClick={handleCancelEdit} aria-label="取消编辑" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
												<X className="tw-size-4" />
											</span>
											<span onClick={handleSaveEdit} aria-label="保存编辑" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
												<Check className="tw-size-4" />
											</span>
										</>
									)}
									<span onClick={handleDelete} aria-label="删除消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<Trash2 className="tw-size-4" />
									</span>
								</>
							)}
							{/* AI message buttons */}
							{message.role === 'assistant' && (
								<>
									<span onClick={handleInsert} aria-label="插入到编辑器" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<TextCursorInput className="tw-size-4" />
									</span>
									<span onClick={handleCopy} aria-label="复制消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										{copied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
									</span>
									<span onClick={handleRegenerate} aria-label="重新生成" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<RotateCw className="tw-size-4" />
									</span>
									<span onClick={handleDelete} aria-label="删除消息" className="tw-cursor-pointer tw-text-muted hover:tw-text-accent">
										<Trash2 className="tw-size-4" />
									</span>
								</>
							)}
						</div>
					</div>
				)}
			</div>
			
			{/* 图片预览模态框 */}
			{previewImage && (
				<div 
					className="tw-fixed tw-inset-0 tw-bg-black tw-bg-opacity-75 tw-z-50 tw-flex tw-items-center tw-justify-center tw-p-4"
					onClick={closeImagePreview}
				>
					<div className="tw-relative tw-max-w-full tw-max-h-full">
						<img 
							src={previewImage} 
							alt="预览图片" 
							className="tw-max-w-full tw-max-h-full tw-object-contain tw-rounded-md"
						/>
						<button
							onClick={closeImagePreview}
							className="tw-absolute tw-top-2 tw-right-2 tw-bg-white tw-rounded-full tw-p-2 tw-shadow-lg tw-cursor-pointer hover:tw-bg-gray-100"
						>
							<X className="tw-size-4 tw-text-black" />
						</button>
					</div>
				</div>
			)}
		</>
	);
};
