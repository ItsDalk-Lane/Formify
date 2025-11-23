/**
 * 测试循环变量解析功能
 * 验证修复后的循环变量在嵌套动作模板中的解析和替换
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FormTemplateProcessEngine } from '../src/service/engine/FormTemplateProcessEngine';
import { LoopVariableScope } from '../src/utils/LoopVariableScope';
import { FormState } from '../src/service/FormState';
import { App } from 'obsidian';

// Mock App instance for testing
const mockApp = {
    vault: {},
    workspace: {
        getActiveViewOfType: () => null
    }
} as any as App;

describe('循环变量解析测试', () => {
    let engine: FormTemplateProcessEngine;
    let mockState: FormState;

    beforeEach(() => {
        engine = new FormTemplateProcessEngine();
        mockState = {
            values: {
                'regularField': 'regularValue',
                'item': 'formItemValue' // 表单中的同名字段
            },
            idValues: {}
        };

        // 清理循环变量作用域
        LoopVariableScope.clear();
    });

    afterEach(() => {
        // 清理循环变量作用域
        LoopVariableScope.clear();
    });

    test('应该正确解析基本的循环变量 {{item}}', async () => {
        // 设置循环变量
        LoopVariableScope.push({
            item: 'currentLoopItem',
            index: 2,
            total: 5,
            iteration: 3  // iteration = index + 1
        });

        const template = '当前项: {{item}}, 索引: {{index}}, 总数: {{total}}, 迭代: {{iteration}}';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('当前项: currentLoopItem, 索引: 2, 总数: 5, 迭代: 3');
    });

    test('{{iteration}} 变量应该从1开始而不是从0开始', async () => {
        // 设置循环变量，index从0开始，iteration应该从1开始
        LoopVariableScope.push({
            item: 'firstItem',
            index: 0,
            total: 3,
            iteration: 1  // iteration = index + 1
        });

        const template = '第{{iteration}}项: {{item}} (索引: {{index}})';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('第1项: firstItem (索引: 0)');
    });

    test('应该优先使用循环变量而非同名的表单字段', async () => {
        // 设置循环变量，其中item与表单字段同名
        LoopVariableScope.push({
            item: 'loopItemValue',
            index: 0,
            total: 3
        });

        const template = '{{item}} vs {{regularField}}';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('loopItemValue vs regularValue');
    });

    test('应该支持嵌套循环变量作用域', async () => {
        // 外层循环
        LoopVariableScope.push({
            item: 'outerItem',
            index: 0,
            total: 2
        });

        // 内层循环
        LoopVariableScope.push({
            item: 'innerItem',
            index: 1,
            total: 3
        });

        const template = '外层: {{LoopVariableScope.getValue("item", 1)}}, 内层: {{item}}';
        // 由于作用域栈机制，我们需要通过不同方式访问外层变量
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toContain('innerItem');
    });

    test('应该保持原有的 {{@variableName}} 语法支持', async () => {
        // 设置循环变量
        LoopVariableScope.push({
            item: 'testItem',
            index: 0,
            total: 1
        });

        const template = '{{@item}} - {{@index}} - {{@total}}';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('testItem - 0 - 1');
    });

    test('应该保持原有的 {{output:variableName}} 语法支持', async () => {
        // 设置AI动作输出变量
        mockState.values['outputVar'] = 'outputValue';

        const template = '输出: {{output:outputVar}}';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('输出: outputValue');
    });

    test('应该保持原有的 {{selection}} 语法支持', async () => {
        const template = '选中文本: {{selection}}';
        const result = await engine.process(template, mockState, mockApp);

        // 在没有选中文本时应该返回空字符串
        expect(result).toBe('选中文本: ');
    });

    test('应该在找不到变量时保持原模板字符串', async () => {
        const template = '未定义变量: {{undefinedVar}}';
        const result = await engine.process(template, mockState, mockApp);

        expect(result).toBe('未定义变量: {{undefinedVar}}');
    });

    test('应该支持复杂的模板组合', async () => {
        // 设置循环变量
        LoopVariableScope.push({
            item: 'testItem',
            index: 1,
            total: 10
        });

        mockState.values['outputVar'] = 'aiOutput';

        const template = `项目 {{index}}/{{total}}: {{item}}
表单字段: {{regularField}}
AI输出: {{output:outputVar}}
未定义: {{unknown}}`;

        const result = await engine.process(template, mockState, mockApp);

        expect(result).toContain('项目 1/10: testItem');
        expect(result).toContain('表单字段: regularValue');
        expect(result).toContain('AI输出: aiOutput');
        expect(result).toContain('未定义: {{unknown}}');
    });

    test('应该处理嵌套动作场景', async () => {
        // 模拟嵌套动作中的模板处理
        LoopVariableScope.push({
            item: 'nestedActionItem',
            index: 5,
            total: 8,
            customVar: 'customValue'
        });

        // 模拟插入文本动作的内容
        const insertContent = `
## 第{{index}}项: {{item}}
总数: {{total}}
自定义变量: {{customVar}}
表单字段: {{regularField}}
        `.trim();

        const result = await engine.process(insertContent, mockState, mockApp);

        expect(result).toContain('第5项: nestedActionItem');
        expect(result).toContain('总数: 8');
        expect(result).toContain('自定义变量: customValue');
        expect(result).toContain('表单字段: regularValue');
    });
});