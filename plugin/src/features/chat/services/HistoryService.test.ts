jest.mock(
	'obsidian',
	() => require('../../../testing/obsidianMock').createObsidianMock(),
	{ virtual: true }
);

import { TFile } from 'obsidian';

(globalThis as typeof globalThis & {
	window?: { localStorage: { getItem: jest.Mock } };
}).window = {
	localStorage: {
		getItem: jest.fn(() => 'en'),
	},
};

const { HistoryService } = require('./HistoryService') as typeof import('./HistoryService');

class MockApp {
	vault = {
		getAbstractFileByPath: jest.fn(),
		read: jest.fn(),
	};
}

const createMockFile = (path: string): TFile => {
	const file = Object.create(TFile.prototype) as TFile & {
		path: string;
		stat: { ctime: number; mtime: number };
	};
	file.path = path;
	file.stat = {
		ctime: Date.now(),
		mtime: Date.now(),
	};
	return file;
};

describe('HistoryService', () => {
	it('should prefer the newer plan snapshot from write_plan history when frontmatter is stale', async () => {
		const mockApp = new MockApp() as any;
		const service = new HistoryService(mockApp, 'System/formify');
		const file = createMockFile('history.md');

		const staleFrontmatterPlan = {
			title: '学习路线',
			tasks: [
				{
					name: '任务 1',
					status: 'done',
					acceptance_criteria: ['完成第一步'],
					outcome: '已完成',
				},
				{
					name: '任务 2',
					status: 'in_progress',
					acceptance_criteria: ['完成第二步'],
				},
				{
					name: '任务 3',
					status: 'todo',
					acceptance_criteria: ['完成第三步'],
				},
			],
			summary: {
				total: 3,
				todo: 1,
				inProgress: 1,
				done: 1,
				skipped: 0,
			},
		};

		const newerMessagePlan = {
			title: '学习路线',
			tasks: [
				{
					name: '任务 1',
					status: 'done',
					acceptance_criteria: ['完成第一步'],
					outcome: '已完成',
				},
				{
					name: '任务 2',
					status: 'done',
					acceptance_criteria: ['完成第二步'],
					outcome: '继续后完成',
				},
				{
					name: '任务 3',
					status: 'in_progress',
					acceptance_criteria: ['完成第三步'],
				},
			],
			summary: {
				total: 3,
				todo: 0,
				inProgress: 1,
				done: 2,
				skipped: 0,
			},
		};

		mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
		mockApp.vault.read.mockResolvedValue(`---
id: history-1
title: 学习路线
model: deepseek-chat
created: 2026-03-08 10:00:00
updated: 2026-03-08 10:30:00
livePlan:
  title: 学习路线
  tasks:
    - name: 任务 1
      status: done
      acceptance_criteria:
        - 完成第一步
      outcome: 已完成
    - name: 任务 2
      status: in_progress
      acceptance_criteria:
        - 完成第二步
    - name: 任务 3
      status: todo
      acceptance_criteria:
        - 完成第三步
  summary:
    total: 3
    todo: 1
    inProgress: 1
    done: 1
    skipped: 0
---

# AI [deepseek-chat] (2026/03/08 10:30:00)
继续执行任务

> [!info]- **write_plan** 学习路线
> 结果: ${JSON.stringify(newerMessagePlan)}
>
`);

		const session = await service.loadSession('history.md');

		expect(session?.livePlan).toEqual(newerMessagePlan);
		expect(session?.livePlan).not.toEqual(staleFrontmatterPlan);
	});

	it('should restore context compaction state from frontmatter', async () => {
		const mockApp = new MockApp() as any;
		const service = new HistoryService(mockApp, 'System/formify');
		const file = createMockFile('history.md');

		mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
		mockApp.vault.read.mockResolvedValue(`---
id: history-2
title: 历史摘要
model: deepseek-chat
created: 2026-03-08 11:00:00
updated: 2026-03-08 11:30:00
contextCompaction:
  version: 1
  coveredRange:
    endMessageId: assistant-2
    messageCount: 4
    signature: abc123
  summary: |
    [Earlier conversation summary]
    Reused summary
  historyTokenEstimate: 256
  updatedAt: 1710000000000
  droppedReasoningCount: 2
---

# 用户 (2026/03/08 11:30:00)
继续
`);

		const session = await service.loadSession('history.md');

		expect(session?.contextCompaction).toEqual({
			version: 1,
			coveredRange: {
				endMessageId: 'assistant-2',
				messageCount: 4,
				signature: 'abc123',
			},
			summary: '[Earlier conversation summary]\nReused summary\n',
			historyTokenEstimate: 256,
			updatedAt: 1710000000000,
			droppedReasoningCount: 2,
		});
	});

	it('should restore pinned message metadata from history body', async () => {
		const mockApp = new MockApp() as any;
		const service = new HistoryService(mockApp, 'System/formify');
		const file = createMockFile('history.md');

		mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
		mockApp.vault.read.mockResolvedValue(`---
id: history-3
title: 置顶测试
model: deepseek-chat
created: 2026-03-08 12:00:00
updated: 2026-03-08 12:30:00
---

# 用户 (2026/03/08 12:00:00)
这条消息要保留

> 置顶: true
`);

		const session = await service.loadSession('history.md');

		expect(session?.messages[0]?.content).toBe('这条消息要保留');
		expect(session?.messages[0]?.metadata?.pinned).toBe(true);
	});
});
