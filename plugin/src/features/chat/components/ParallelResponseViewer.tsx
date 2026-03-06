import { useState, useEffect, useRef, useMemo } from 'react';
import { StopCircle, RotateCw, AlertTriangle } from 'lucide-react';
import { Component } from 'obsidian';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import type { ChatMessage } from '../types/chat';
import type { LayoutMode, ParallelResponseGroup } from '../types/multiModel';
import { ChatService } from '../services/ChatService';
import { ModelTag } from './ModelTag';
import { renderMarkdownContent, parseContentBlocks, ContentBlock } from '../utils/markdown';
import { availableVendors } from 'src/features/tars/settings';
import { localInstance } from 'src/i18n/locals';

interface ParallelResponseViewerProps {
	messages: ChatMessage[];
	layoutMode: LayoutMode;
	service: ChatService;
	parallelResponses?: ParallelResponseGroup;
	isGenerating: boolean;
}

function resolveVendor(tag: string, service: ChatService): string | undefined {
	const providers = service.getProviders();
	const p = providers.find((prov) => prov.tag === tag);
	return p ? availableVendors.find((v) => v.name === p.vendor)?.name : undefined;
}

interface SingleResponseProps {
	message: ChatMessage;
	service: ChatService;
	isStreaming: boolean;
	isError: boolean;
	compact?: boolean;
}

const SingleResponse = ({ message, service, isStreaming, isError, compact }: SingleResponseProps) => {
	const app = useObsidianApp();
	const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);

	useEffect(() => {
		setContentBlocks(parseContentBlocks(message.content));
	}, [message.content]);

	const vendor = resolveVendor(message.modelTag ?? '', service);

	return (
		<div className={`parallel-response-item ${isError ? 'parallel-response-item--error' : ''}`}>
			{/* 模型标识头 */}
			<div style={{
				display: 'flex', alignItems: 'center', justifyContent: 'space-between',
				padding: compact ? '4px 8px' : '6px 8px',
				borderBottom: '1px solid var(--background-modifier-border)',
			}}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
					<ModelTag
						modelTag={message.modelTag ?? ''}
						modelName={message.modelName}
						vendor={vendor}
						isGenerating={isStreaming}
						isError={isError}
						size="sm"
					/>
					{message.taskDescription && (
						<span style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-faint)' }}>
							{message.taskDescription}
						</span>
					)}
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
					{isStreaming && (
						<button
							type="button"
							onClick={() => service.stopModelGeneration(message.modelTag ?? '')}
							className="tw-cursor-pointer tw-text-muted"
							style={{ background: 'none', border: 'none', padding: '2px', display: 'flex' }}
							title={localInstance.stop_this_model || '停止此模型'}
						>
							<StopCircle style={{ width: 14, height: 14 }} />
						</button>
					)}
					{!isStreaming && (
						<button
							type="button"
							onClick={() => service.retryModel(message.id)}
							className="tw-cursor-pointer tw-text-muted"
							style={{ background: 'none', border: 'none', padding: '2px', display: 'flex' }}
							title={localInstance.retry_this_model || '重试此模型'}
						>
							<RotateCw style={{ width: 14, height: 14 }} />
						</button>
					)}
				</div>
			</div>

			{/* 内容区域 */}
			<div className="chat-message__content tw-break-words" style={{ padding: compact ? '4px 8px' : '8px' }}>
				{isError && message.isError ? (
					<div style={{
						color: 'var(--text-error, #dc2626)',
						fontSize: 'var(--font-ui-small)',
						display: 'flex',
						alignItems: 'flex-start',
						gap: '6px'
					}}>
						<AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: '2px' }} />
						<span>{message.content || localInstance.generation_failed || '生成失败'}</span>
					</div>
				) : (
					contentBlocks.map((block, index) => {
						if (block.type === 'text') {
							return <MarkdownBlock key={`text-${index}`} content={block.content} app={app} />;
						}
						if (block.type === 'reasoning') {
							return (
								<div key={`reasoning-${index}`} style={{
									fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)',
									padding: '4px 0', fontStyle: 'italic',
								}}>
									{block.content.substring(0, 200)}{block.content.length > 200 ? '...' : ''}
								</div>
							);
						}
						return null;
					})
				)}
				{isStreaming && !message.content && (
					<div className="parallel-response-skeleton" />
				)}
			</div>
		</div>
	);
};

const MarkdownBlock = ({ content, app }: { content: string; app: any }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef(new Component());

	useEffect(() => {
		if (!containerRef.current) return;
		const run = async () => {
			await renderMarkdownContent(app, content, containerRef.current as HTMLDivElement, componentRef.current);
		};
		void run();
		return () => { componentRef.current.unload(); };
	}, [app, content]);

	return <div ref={containerRef} />;
};

export const ParallelResponseViewer = ({
	messages,
	layoutMode,
	service,
	parallelResponses,
	isGenerating,
}: ParallelResponseViewerProps) => {
	const [activeTab, setActiveTab] = useState(0);

	const streamingTags = useMemo(() => {
		if (!parallelResponses || !isGenerating) return new Set<string>();
		return new Set(
			parallelResponses.responses
				.filter((r) => !r.isComplete && !r.isError)
				.map((r) => r.modelTag)
		);
	}, [parallelResponses, isGenerating]);

	const errorTags = useMemo(() => {
		if (!parallelResponses) return new Set<string>();
		return new Set(
			parallelResponses.responses.filter((r) => r.isError).map((r) => r.modelTag)
		);
	}, [parallelResponses]);

	if (messages.length === 0) return null;

	if (layoutMode === 'horizontal') {
		return (
			<div className="parallel-response-viewer parallel-response-viewer--horizontal" style={{
				display: 'grid',
				gridTemplateColumns: `repeat(${Math.min(messages.length, 4)}, 1fr)`,
				gap: '1px',
				margin: '0.25rem 0.5rem',
				border: '1px solid var(--background-modifier-border)',
				borderRadius: 'var(--radius-m)',
				overflow: messages.length > 3 ? 'auto' : 'hidden',
				backgroundColor: 'var(--background-modifier-border)',
			}}>
				{messages.map((msg) => (
					<div key={msg.id} style={{ backgroundColor: 'var(--background-primary)', minWidth: messages.length > 3 ? '250px' : undefined }}>
						<SingleResponse
							message={msg}
							service={service}
							isStreaming={streamingTags.has(msg.modelTag ?? '')}
							isError={errorTags.has(msg.modelTag ?? '') || !!msg.isError}
							compact
						/>
					</div>
				))}
			</div>
		);
	}

	if (layoutMode === 'tabs') {
		const safeIdx = Math.min(activeTab, messages.length - 1);
		const current = messages[safeIdx];
		return (
			<div className="parallel-response-viewer parallel-response-viewer--tabs" style={{
				margin: '0.25rem 0.5rem',
				border: '1px solid var(--background-modifier-border)',
				borderRadius: 'var(--radius-m)',
				overflow: 'hidden',
			}}>
				{/* 标签栏 */}
				<div style={{
					display: 'flex', gap: '0', overflowX: 'auto',
					borderBottom: '1px solid var(--background-modifier-border)',
					backgroundColor: 'var(--background-secondary)',
				}}>
					{messages.map((msg, idx) => {
						const isActive = idx === safeIdx;
						const vendor = resolveVendor(msg.modelTag ?? '', service);
						return (
							<button
								key={msg.id}
								type="button"
								onClick={() => setActiveTab(idx)}
								style={{
									padding: '6px 12px', border: 'none', cursor: 'pointer',
									backgroundColor: isActive ? 'var(--background-primary)' : 'transparent',
									borderBottom: isActive ? '2px solid var(--interactive-accent)' : '2px solid transparent',
									display: 'flex', alignItems: 'center', gap: '4px',
									whiteSpace: 'nowrap',
								}}
							>
								<ModelTag
									modelTag={msg.modelTag ?? ''}
									modelName={msg.modelName}
									vendor={vendor}
									isGenerating={streamingTags.has(msg.modelTag ?? '')}
									isError={errorTags.has(msg.modelTag ?? '') || !!msg.isError}
									size="sm"
								/>
							</button>
						);
					})}
				</div>
				{/* 内容 */}
				{current && (
					<SingleResponse
						message={current}
						service={service}
						isStreaming={streamingTags.has(current.modelTag ?? '')}
						isError={errorTags.has(current.modelTag ?? '') || !!current.isError}
					/>
				)}
			</div>
		);
	}

	// vertical layout (default)
	return (
		<div className="parallel-response-viewer parallel-response-viewer--vertical" style={{
			display: 'flex', flexDirection: 'column', gap: '4px',
			margin: '0.25rem 0.5rem',
		}}>
			{messages.map((msg) => (
				<div key={msg.id} style={{
					border: '1px solid var(--background-modifier-border)',
					borderRadius: 'var(--radius-m)',
					overflow: 'hidden',
				}}>
					<SingleResponse
						message={msg}
						service={service}
						isStreaming={streamingTags.has(msg.modelTag ?? '')}
						isError={errorTags.has(msg.modelTag ?? '') || !!msg.isError}
					/>
				</div>
			))}
		</div>
	);
};
