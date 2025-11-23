import { describe, test, expect, beforeEach } from 'vitest';
import { VariableConflictDetector } from '../src/service/variable/VariableConflictDetector';
import { VariableRegistry } from '../src/service/variable/VariableRegistry';
import { FormConfig } from '../src/model/FormConfig';
import { LoopFormAction } from '../src/model/action/LoopFormAction';
import { LoopType } from 'src/model/enums/LoopType';

describe('跨循环动作冲突检测', () => {
    let formConfig: FormConfig;

    beforeEach(() => {
        formConfig = new FormConfig('test-form');
    });

    test('detectConflictsFromConfig 应该检测到跨循环动作的变量冲突', () => {
        // 添加第一个循环动作
        const loop1 = new LoopFormAction();
        loop1.id = 'loop-1';
        loop1.itemVariableName = 'item';
        loop1.indexVariableName = 'index';
        loop1.totalVariableName = 'total';

        // 添加第二个循环动作（使用相同的变量名）
        const loop2 = new LoopFormAction();
        loop2.id = 'loop-2';
        loop2.itemVariableName = 'item';
        loop2.indexVariableName = 'index';
        loop2.totalVariableName = 'total';

        formConfig.actions = [loop1, loop2];

        // 使用变量管理界面的检测逻辑
        const conflicts = VariableConflictDetector.detectConflictsFromConfig(formConfig);

        console.log('Conflicts found:', conflicts);
        console.log('Conflict count:', conflicts.length);

        // 应该检测到跨循环动作的冲突
        expect(conflicts.length).toBeGreaterThan(0);

        // 检查具体的冲突项
        const itemConflict = conflicts.find(c => c.variableName === 'item');
        const indexConflict = conflicts.find(c => c.variableName === 'index');
        const totalConflict = conflicts.find(c => c.variableName === 'total');

        expect(itemConflict).not.toBeNull();
        expect(indexConflict).not.toBeNull();
        expect(totalConflict).not.toBeNull();
    });

    test('checkLoopVariableConflict 应该为第二个循环动作检测到冲突', () => {
        // 添加第一个循环动作
        const loop1 = new LoopFormAction();
        loop1.id = 'loop-1';
        loop1.itemVariableName = 'item';
        loop1.indexVariableName = 'index';
        loop1.totalVariableName = 'total';

        formConfig.actions = [loop1];

        // 第二个循环动作
        const loop2 = new LoopFormAction();
        loop2.id = 'loop-2';
        loop2.itemVariableName = 'item';
        loop2.indexVariableName = 'index';
        loop2.totalVariableName = 'total';

        // 检查第二个循环动作的变量冲突
        const itemConflict = VariableConflictDetector.checkLoopVariableConflict(
            'item', loop2, formConfig, ['index', 'total']
        );

        const indexConflict = VariableConflictDetector.checkLoopVariableConflict(
            'index', loop2, formConfig, ['item', 'total']
        );

        const totalConflict = VariableConflictDetector.checkLoopVariableConflict(
            'total', loop2, formConfig, ['item', 'index']
        );

        console.log('Item conflict:', itemConflict);
        console.log('Index conflict:', indexConflict);
        console.log('Total conflict:', totalConflict);

        // 应该检测到跨作用域冲突
        expect(itemConflict).not.toBeNull();
        expect(indexConflict).not.toBeNull();
        expect(totalConflict).not.toBeNull();

        expect(itemConflict?.conflictType).toBe('crossScope');
        expect(indexConflict?.conflictType).toBe('crossScope');
        expect(totalConflict?.conflictType).toBe('crossScope');
    });
});