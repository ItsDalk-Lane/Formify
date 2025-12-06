import { FormFieldType } from "src/model/enums/FormFieldType";
import { FieldValueReader } from "./FieldValueReader";
import { BaseFieldValueReader } from "./readers/BaseFieldValueReader";
import { SelectFieldValueReader } from "./readers/SelectFieldValueReader";
import { NumberFieldValueReader } from "./readers/NumberFieldValueReader";
import { BooleanFieldValueReader } from "./readers/BooleanFieldValueReader";
import { FileListFieldValueReader } from "./readers/FileListFieldValueReader";
import { TimeFieldValueReader } from "./readers/TimeFieldValueReader";

/**
 * 字段值读取器工厂
 * 根据字段类型返回对应的Reader实例（单例模式）
 */
export class FieldValueReaderFactory {
    private static readerCache: Map<FormFieldType, FieldValueReader> = new Map();

    /**
     * 根据字段类型获取对应的Reader实例
     * @param fieldType 字段类型
     * @returns FieldValueReader实例
     */
    static getReader(fieldType: FormFieldType): FieldValueReader {
        // 检查缓存
        if (this.readerCache.has(fieldType)) {
            return this.readerCache.get(fieldType)!;
        }

        // 根据字段类型创建Reader实例
        let reader: FieldValueReader;

        switch (fieldType) {
            case FormFieldType.SELECT:
            case FormFieldType.RADIO:
                reader = new SelectFieldValueReader();
                break;

            case FormFieldType.NUMBER:
                reader = new NumberFieldValueReader();
                break;

            case FormFieldType.CHECKBOX:
            case FormFieldType.TOGGLE:
                reader = new BooleanFieldValueReader();
                break;

            case FormFieldType.FILE_LIST:
                reader = new FileListFieldValueReader();
                break;

            case FormFieldType.DATE:
            case FormFieldType.TIME:
            case FormFieldType.DATETIME:
                reader = new TimeFieldValueReader();
                break;

            default:
                // 其他字段类型使用基础实现
                reader = new BaseFieldValueReader();
                break;
        }

        // 缓存Reader实例
        this.readerCache.set(fieldType, reader);
        return reader;
    }

    /**
     * 清除缓存（用于测试）
     */
    static clearCache(): void {
        this.readerCache.clear();
    }
}
