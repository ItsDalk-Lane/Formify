import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useObsidianApp } from 'src/context/obsidianAppContext';
import { Notice } from 'obsidian';
import './TemplateSelector.css';

interface TemplateSelectorProps {
	visible: boolean;
	onSelect: (templatePath: string) => void;
	onClose: () => void;
	inputValue: string;
}

export const TemplateSelector = ({ visible, onSelect, onClose, inputValue }: TemplateSelectorProps) => {
	const app = useObsidianApp();
	const [templates, setTemplates] = useState<Array<{ value: string; label: string; description: string }>>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [filterText, setFilterText] = useState('');
	const listRef = useRef<HTMLDivElement>(null);

	// 获取模板列表
	useEffect(() => {
		if (!visible) return;

		const fetchTemplates = async () => {
			try {
				// 获取插件设置中的提示词模板目录
				const plugin = (app as any).plugins?.plugins?.["formify"];
				const promptTemplateFolder = plugin?.settings?.promptTemplateFolder || "System/ai prompts";
				
				// 获取所有Markdown文件
				const files = app.vault.getMarkdownFiles();
				
				// 过滤出提示词模板目录下的文件
				const filteredFiles = files.filter((f) => 
					f.path.startsWith(promptTemplateFolder + "/") || 
					f.path === promptTemplateFolder
				);
				
				const templateOptions = await Promise.all(filteredFiles.map(async (f) => {
					const content = await app.vault.read(f);
					const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;
					return {
						value: f.path,
						label: f.basename,
						description: preview
					};
				}));
				
				setTemplates(templateOptions);
				setSelectedIndex(0);
			} catch (error) {
				console.error('[TemplateSelector] 获取模板列表失败:', error);
				new Notice('获取模板列表失败');
			}
		};

		fetchTemplates();
	}, [app, visible]);

	// 过滤模板
	const filteredTemplates = useMemo(() => {
		if (!filterText) return templates;
		
		const lowerFilterText = filterText.toLowerCase();
		return templates.filter(template => 
			template.label.toLowerCase().includes(lowerFilterText) ||
			template.description.toLowerCase().includes(lowerFilterText)
		);
	}, [templates, filterText]);

	// 处理键盘事件
	useEffect(() => {
		if (!visible) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedIndex(prev => Math.min(prev + 1, filteredTemplates.length - 1));
					break;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedIndex(prev => Math.max(prev - 1, 0));
					break;
				case 'Enter':
					e.preventDefault();
					if (filteredTemplates.length > 0 && selectedIndex >= 0) {
						onSelect(filteredTemplates[selectedIndex].value);
					}
					break;
				case 'Escape':
					e.preventDefault();
					onClose();
					break;
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [visible, filteredTemplates, selectedIndex, onSelect, onClose]);

	// 滚动到选中项
	useEffect(() => {
		if (listRef.current && selectedIndex >= 0 && selectedIndex < filteredTemplates.length) {
			const selectedItem = listRef.current.children[selectedIndex] as HTMLElement;
			if (selectedItem) {
				selectedItem.scrollIntoView({ block: 'nearest' });
			}
		}
	}, [selectedIndex, filteredTemplates]);

	if (!visible) return null;

	const selectorContent = (
		<div className="template-selector-overlay" onClick={onClose}>
			<div className="template-selector" onClick={(e) => e.stopPropagation()}>
				<div className="template-selector-header">
					<h3>选择提示词模板</h3>
					<button className="template-selector-close" onClick={onClose}>×</button>
				</div>
				<div className="template-selector-search">
					<input
						type="text"
						placeholder="搜索模板..."
						value={filterText}
						onChange={(e) => {
							setFilterText(e.target.value);
							setSelectedIndex(0);
						}}
						autoFocus
					/>
				</div>
				<div className="template-selector-list" ref={listRef}>
					{filteredTemplates.length === 0 ? (
						<div className="template-selector-empty">没有找到匹配的模板</div>
					) : (
						filteredTemplates.map((template, index) => (
							<div
								key={template.value}
								className={`template-selector-item ${index === selectedIndex ? 'selected' : ''}`}
								onClick={() => onSelect(template.value)}
								onMouseEnter={() => setSelectedIndex(index)}
							>
								<div className="template-selector-item-name">{template.label}</div>
								<div className="template-selector-item-description">{template.description}</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);

	// 使用 Portal 将模板选择器渲染到 document.body，避免被父容器截断
	return createPortal(selectorContent, document.body);
};
