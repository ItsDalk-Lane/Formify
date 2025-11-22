/**
 * 测试上下文相关的动作选择功能
 * 验证在循环内外环境下动作显示的过滤逻辑
 */

import { describe, test, expect } from 'vitest';
import { getFormActionTypeOptions } from '../src/view/edit/setting/action/common/ActionTypeSelect';
import { FormActionType } from '../src/model/enums/FormActionType';

describe('上下文相关的动作选择测试', () => {

    test('循环外部应该过滤掉循环控制动作', () => {
        const options = getFormActionTypeOptions(false);

        // 获取所有动作类型的值
        const actionTypes = options.map(option => option.value);

        // 应该包含普通动作
        expect(actionTypes).toContain(FormActionType.CREATE_FILE);
        expect(actionTypes).toContain(FormActionType.INSERT_TEXT);
        expect(actionTypes).toContain(FormActionType.LOOP);

        // 不应该包含循环控制动作
        expect(actionTypes).not.toContain(FormActionType.BREAK);
        expect(actionTypes).not.toContain(FormActionType.CONTINUE);

        console.log('循环外部可用动作数量:', options.length);
        console.log('循环外部可用动作:', actionTypes);
    });

    test('循环内部应该显示所有动作包括循环控制动作', () => {
        const options = getFormActionTypeOptions(true);

        // 获取所有动作类型的值
        const actionTypes = options.map(option => option.value);

        // 应该包含普通动作
        expect(actionTypes).toContain(FormActionType.CREATE_FILE);
        expect(actionTypes).toContain(FormActionType.INSERT_TEXT);
        expect(actionTypes).toContain(FormActionType.LOOP);

        // 应该包含循环控制动作
        expect(actionTypes).toContain(FormActionType.BREAK);
        expect(actionTypes).toContain(FormActionType.CONTINUE);

        console.log('循环内部可用动作数量:', options.length);
        console.log('循环内部可用动作:', actionTypes);
    });

    test('默认参数应该为循环外部模式', () => {
        const options = getFormActionTypeOptions();

        // 获取所有动作类型的值
        const actionTypes = options.map(option => option.value);

        // 默认情况下不应该包含循环控制动作
        expect(actionTypes).not.toContain(FormActionType.BREAK);
        expect(actionTypes).not.toContain(FormActionType.CONTINUE);
    });

    test('动作数量验证', () => {
        const outsideOptions = getFormActionTypeOptions(false);
        const insideOptions = getFormActionTypeOptions(true);

        // 循环内部的动作数量应该比循环外部多2个（BREAK 和 CONTINUE）
        expect(insideOptions.length).toBe(outsideOptions.length + 2);

        console.log('循环外部动作数量:', outsideOptions.length);
        console.log('循环内部动作数量:', insideOptions.length);
        console.log('数量差异:', insideOptions.length - outsideOptions.length);
    });

    test('过滤后的动作应该保持正确的属性', () => {
        const outsideOptions = getFormActionTypeOptions(false);
        const insideOptions = getFormActionTypeOptions(true);

        // 检查每个选项都有必要的属性
        outsideOptions.forEach(option => {
            expect(option).toHaveProperty('value');
            expect(option).toHaveProperty('label');
            expect(option).toHaveProperty('icon');
            expect(typeof option.value).toBe('string');
            expect(typeof option.label).toBe('string');
        });

        // 检查循环控制动作在循环内部有正确属性
        const breakOption = insideOptions.find(option => option.value === FormActionType.BREAK);
        const continueOption = insideOptions.find(option => option.value === FormActionType.CONTINUE);

        expect(breakOption).toBeDefined();
        expect(breakOption?.label).toMatch(/中断循环|Break loop/);

        expect(continueOption).toBeDefined();
        expect(continueOption?.label).toMatch(/跳过本次循环|Continue loop/);
    });
});