import { FormConfig } from "src/model/FormConfig";
import { FormField } from "src/model/field/IFormField";
import { processObTemplate } from "./templates";
import { LoopVariableScope } from "./LoopVariableScope";

/**
 * 条件变量解析上下文
 */
export interface ConditionVariableContext {
  /** 表单配置（用于解析表单变量） */
  formConfig?: FormConfig;
  /** 表单当前值（优先从此处获取字段值） */
  formValues?: Record<string, any>;
}

/**
 * 条件变量解析器
 * 用于解析条件值中的变量引用，支持：
 * - 表单变量: {{@fieldLabel}} - 使用字段的当前值或默认值
 * - 内置变量: {{date}}, {{time}}, {{random:n}} - 使用 processObTemplate 处理
 * - 循环变量: 从 LoopVariableScope 获取
 */
export class ConditionVariableResolver {
  
  /**
   * 解析条件值中的变量引用
   * @param value 原始条件值
   * @param context 变量解析上下文
   * @returns 解析后的值
   */
  static resolve(value: any, context: ConditionVariableContext): any {
    // 非字符串值直接返回
    if (typeof value !== 'string') {
      return value;
    }

    // 空字符串直接返回
    if (!value.trim()) {
      return value;
    }

    let result = value;

    // 1. 尝试从循环变量获取值（完整匹配）
    const trimmedValue = value.trim();
    const loopValue = LoopVariableScope.getValue(trimmedValue);
    if (loopValue !== undefined) {
      return loopValue;
    }

    // 2. 解析表单变量 {{@fieldLabel}}
    if (context.formConfig && context.formConfig.fields) {
      result = result.replace(/\{\{@([^}]+)\}\}/g, (match, fieldLabel) => {
        const field = context.formConfig!.fields.find(
          (f: FormField) => f.label === fieldLabel.trim()
        );
        
        if (!field) {
          return '';
        }
        
        // 优先使用表单当前值
        if (context.formValues && context.formValues[field.id] !== undefined) {
          return String(context.formValues[field.id]);
        }

        // 其次使用字段默认值
        if (field.defaultValue !== undefined && field.defaultValue !== null) {
          return String(field.defaultValue);
        }

        return '';
      });
    }

    // 3. 解析内置变量（date, time, random 等）
    result = processObTemplate(result);

    return result;
  }

  /**
   * 检查值是否包含变量引用
   * @param value 要检查的值
   * @returns 是否包含变量引用
   */
  static hasVariableReference(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    
    // 检查表单变量 {{@xxx}}
    if (/\{\{@[^}]+\}\}/.test(value)) {
      return true;
    }
    
    // 检查内置变量 {{xxx}}
    if (/\{\{(date|time|random)[^}]*\}\}/.test(value)) {
      return true;
    }
    
    return false;
  }
}
