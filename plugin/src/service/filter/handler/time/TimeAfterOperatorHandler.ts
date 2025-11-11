import { Objects } from "src/utils/Objects";
import { Filter } from "src/model/filter/Filter";
import { OperatorType } from "src/model/filter/OperatorType";
import { OperatorHandleContext, OperatorHandler } from "../OperatorHandler";

/**
 * 时间晚于比较符处理器
 * 用于判断字段值的时间是否晚于设置的时间
 */
export class TimeAfterOperatorHandler implements OperatorHandler {

	accept(filter: Filter) {
		return filter.operator === OperatorType.TimeAfter;
	}

	apply(fieldValue: any, value: any, context: OperatorHandleContext): boolean {
		// 如果任一值为空，返回 false
		if (Objects.isNullOrUndefined(fieldValue) || Objects.isNullOrUndefined(value)) {
			return false;
		}

		try {
			// 将字段值和比较值转换为时间戳进行比较
			const fieldTime = this.parseTimeValue(fieldValue);
			const compareTime = this.parseTimeValue(value);

			// 如果任一值无法解析，返回 false
			if (fieldTime === null || compareTime === null) {
				return false;
			}

			// 字段值的时间晚于设置的时间时返回 true
			return fieldTime > compareTime;
		} catch (error) {
			console.error("时间比较出错:", error);
			return false;
		}
	}

	/**
	 * 解析时间值为时间戳
	 * 支持日期时间、日期、时间格式
	 */
	private parseTimeValue(value: any): number | null {
		if (typeof value === "number") {
			return value;
		}

		if (typeof value === "string") {
			// 尝试解析为 Date 对象
			const date = new Date(value);
			if (!isNaN(date.getTime())) {
				return date.getTime();
			}

			// 如果是纯时间格式（如 "14:30"），添加今天的日期
			if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
				const today = new Date().toISOString().split('T')[0];
				const dateTime = new Date(`${today}T${value}`);
				if (!isNaN(dateTime.getTime())) {
					return dateTime.getTime();
				}
			}
		}

		if (value instanceof Date) {
			return value.getTime();
		}

		return null;
	}
}
