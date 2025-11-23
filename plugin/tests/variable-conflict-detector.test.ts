import { describe, test, expect, beforeEach } from 'vitest';
import { VariableConflictDetector } from '../src/service/variable/VariableConflictDetector';
import { FormConfig } from '../src/model/FormConfig';
import { LoopFormAction } from '../src/model/action/LoopFormAction';
import { LoopType } from '../src/model/enums/LoopType';

describe('VariableConflictDetector', () => {
    let formConfig: FormConfig;
    let loopAction: LoopFormAction;

    beforeEach(() => {
        formConfig = new FormConfig('test');
        loopAction = new LoopFormAction();
        loopAction.id = 'test-loop-1';
        loopAction.itemVariableName = 'item';
        loopAction.indexVariableName = 'index';
        loopAction.totalVariableName = 'total';
    });

    test('使用默认循环变量名不应该检测到冲突', () => {
        const itemConflict = VariableConflictDetector.checkLoopVariableConflict(
            'item',
            loopAction,
            formConfig,
            ['index', 'total']
        );

        const indexConflict = VariableConflictDetector.checkLoopVariableConflict(
            'index',
            loopAction,
            formConfig,
            ['item', 'total']
        );

        const totalConflict = VariableConflictDetector.checkLoopVariableConflict(
            'total',
            loopAction,
            formConfig,
            ['item', 'index']
        );

        expect(itemConflict).toBeNull();
        expect(indexConflict).toBeNull();
        expect(totalConflict).toBeNull();
    });

    test('与同名的循环变量应该检测到自冲突', () => {
        const conflict = VariableConflictDetector.checkLoopVariableConflict(
            'item',
            loopAction,
            formConfig,
            ['item'] // 同名冲突
        );

        expect(conflict).not.toBeNull();
        expect(conflict?.conflictType).toBe('selfConflict');
    });

    test('iteration 变量不应该产生误报警告', () => {
        const conflict = VariableConflictDetector.checkLoopVariableConflict(
            'iteration',
            loopAction,
            formConfig,
            ['item', 'index', 'total']
        );

            // iteration 是系统保留变量，但在循环变量冲突检测中应该被排除
            // 只有在用户真正尝试使用 iteration 作为循环变量名时才有意义
            expect(conflict).toBeNull();
        });
    });
