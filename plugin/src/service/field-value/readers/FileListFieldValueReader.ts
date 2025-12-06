import { IFormField } from "src/model/field/IFormField";
import { IFileListField } from "src/model/field/IFileListField";
import { FieldOption, FieldValueReader } from "../FieldValueReader";

// 文件路径分隔符常量（与FileListControl保持一致）
const FILE_PATH_SEPARATOR = "<<<FILE_PATH>>>";
const CONTENT_SEPARATOR = "<<<CONTENT>>>";

/**
 * FILE_LIST字段值读取器
 * 处理extractContent配置，解码编码的文件路径和内容
 */
export class FileListFieldValueReader implements FieldValueReader {
    /**
     * 从原始值中提取字段实际存储的值
     * 如果启用了extractContent，解码后返回文件路径
     */
    getFieldValue(field: IFormField, rawValue: any): any {
        if (rawValue === undefined || rawValue === null) {
            return this.getDefaultValue(field);
        }

        // 如果是数组
        if (Array.isArray(rawValue)) {
            return rawValue.map(v => this.extractFilePath(v));
        }

        return this.extractFilePath(rawValue);
    }

    /**
     * 将任意值规范化为字段期望的类型
     * 统一文件路径格式（反斜杠转正斜杠）
     */
    normalizeValue(field: IFormField, value: any): any {
        if (value === undefined || value === null) {
            return "";
        }

        const filePath = this.extractFilePath(value);
        // 统一使用正斜杠，移除尾部斜杠
        return filePath.replace(/\\/g, '/').replace(/\/$/, '');
    }

    /**
     * 使用文件路径比较
     * 支持数组比较（多文件）
     */
    compareValues(field: IFormField, value1: any, value2: any): boolean {
        const normalized1 = this.getFieldValue(field, value1);
        const normalized2 = this.getFieldValue(field, value2);

        // 都是数组
        if (Array.isArray(normalized1) && Array.isArray(normalized2)) {
            if (normalized1.length !== normalized2.length) {
                return false;
            }
            // 规范化后比较
            const paths1 = normalized1.map(p => this.normalizePath(String(p)));
            const paths2 = normalized2.map(p => this.normalizePath(String(p)));
            return paths1.every(p => paths2.includes(p)) &&
                   paths2.every(p => paths1.includes(p));
        }

        // 一个是数组，一个不是
        if (Array.isArray(normalized1) || Array.isArray(normalized2)) {
            return false;
        }

        // 都不是数组，规范化后比较
        const path1 = this.normalizePath(String(normalized1));
        const path2 = this.normalizePath(String(normalized2));
        return path1 === path2;
    }

    /**
     * 获取字段的可选值列表
     * FILE_LIST字段没有预定义的选项
     */
    getFieldOptions(field: IFormField): FieldOption[] {
        return [];
    }

    /**
     * 从编码值或原始值中提取文件路径
     */
    private extractFilePath(value: any): string {
        if (value === undefined || value === null) {
            return "";
        }

        const strValue = String(value);

        // 检查是否是编码格式
        if (strValue.includes(FILE_PATH_SEPARATOR) && strValue.includes(CONTENT_SEPARATOR)) {
            const pathStart = strValue.indexOf(FILE_PATH_SEPARATOR) + FILE_PATH_SEPARATOR.length;
            const contentStart = strValue.indexOf(CONTENT_SEPARATOR);
            if (pathStart >= 0 && contentStart > pathStart) {
                return strValue.substring(pathStart, contentStart);
            }
        }

        // 不是编码格式，直接返回
        return strValue;
    }

    /**
     * 规范化文件路径
     */
    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    }

    /**
     * 获取字段的默认值
     */
    private getDefaultValue(field: IFormField): any {
        const fileListField = field as IFileListField;
        if (fileListField.multiple) {
            return [];
        }
        return "";
    }
}
