import { moment } from "obsidian";

/**
 * 日期时间计算工具类
 * 提供日期偏移、相对日期、时间运算等功能
 */
export class DateTimeCalculator {
    /**
     * 中文周几到英文的映射
     */
    private static readonly CHINESE_WEEKDAY_MAP: Record<string, number> = {
        '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 0,
        '下周一': 1, '下周二': 2, '下周三': 3, '下周四': 4, '下周五': 5, '下周六': 6, '下周日': 0,
    };

    /**
     * 英文周几到数字的映射
     */
    private static readonly ENGLISH_WEEKDAY_MAP: Record<string, number> = {
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
        'friday': 5, 'saturday': 6, 'sunday': 0,
    };

    /**
     * 计算相对日期（支持数字偏移和周几）
     * @param baseDate 基准日期
     * @param offset 偏移量（如 "+3"、"-5"、"下周一"、"next monday"）
     * @returns 计算后的日期
     */
    static calculateRelativeDate(baseDate: moment.Moment, offset: string): moment.Moment {
        const trimmedOffset = offset.trim();

        // 处理数字偏移（+3、-5）
        const numberMatch = trimmedOffset.match(/^([+-]?\d+)$/);
        if (numberMatch) {
            const days = parseInt(numberMatch[1], 10);
            return baseDate.clone().add(days, 'days');
        }

        // 处理中文周几
        if (trimmedOffset.startsWith('下周')) {
            const weekday = this.CHINESE_WEEKDAY_MAP[trimmedOffset];
            if (weekday !== undefined) {
                return this.getNextWeekday(baseDate, weekday);
            }
        }

        // 处理英文周几（next monday 等）
        const englishMatch = trimmedOffset.match(/^next\s+(\w+)$/i);
        if (englishMatch) {
            const weekdayName = englishMatch[1].toLowerCase();
            const weekday = this.ENGLISH_WEEKDAY_MAP[weekdayName];
            if (weekday !== undefined) {
                return this.getNextWeekday(baseDate, weekday);
            }
        }

        // 如果无法识别，返回原日期
        return baseDate.clone();
    }

    /**
     * 获取下周指定的星期几
     * @param baseDate 基准日期
     * @param targetWeekday 目标星期几（0=周日，1=周一，...，6=周六）
     * @returns 下周对应的日期
     * 
     * 计算逻辑：
     * 1. 获取当前是周几（currentWeekday）
     * 2. 计算到本周日的天数：7 - currentWeekday
     * 3. 加上目标周几的天数：targetWeekday（周日为0需要特殊处理为7）
     * 4. 总天数 = (7 - currentWeekday) + (targetWeekday === 0 ? 7 : targetWeekday)
     * 
     * 例如：今天是周三(3)，求下周一(1)
     * daysToAdd = (7 - 3) + 1 = 5
     * 结果：今天 + 5天 = 下周一
     */
    private static getNextWeekday(baseDate: moment.Moment, targetWeekday: number): moment.Moment {
        const currentWeekday = baseDate.day();
        
        // 周日在计算时当作7处理
        const adjustedTargetWeekday = targetWeekday === 0 ? 7 : targetWeekday;
        
        // 计算到下周目标日期的天数
        // 公式：(7 - 当前周几) + 目标周几
        const daysToAdd = (7 - currentWeekday) + adjustedTargetWeekday;

        return baseDate.clone().add(daysToAdd, 'days');
    }

    /**
     * 计算时间偏移（支持小时和分钟）
     * @param baseTime moment对象
     * @param offset 偏移量（如 "+1小时"、"-30分钟"、"+1小时30分钟"）
     * @returns 计算后的时间
     */
    static calculateTimeOffset(baseTime: moment.Moment, offset: string): moment.Moment {
        const result = baseTime.clone();
        const trimmedOffset = offset.trim();

        // 匹配小时偏移（+1小时、-2小时、+1hour、-2hours）
        const hourMatches = trimmedOffset.matchAll(/([+-]?\d+)\s*(小时|hour|hours)/gi);
        for (const match of hourMatches) {
            const hours = parseInt(match[1], 10);
            result.add(hours, 'hours');
        }

        // 匹配分钟偏移（+30分钟、-45分钟、+30minute、-45minutes）
        const minuteMatches = trimmedOffset.matchAll(/([+-]?\d+)\s*(分钟|minute|minutes)/gi);
        for (const match of minuteMatches) {
            const minutes = parseInt(match[1], 10);
            result.add(minutes, 'minutes');
        }

        return result;
    }

    /**
     * 生成指定长度的随机字符串（包含数字和字母）
     * @param length 字符串长度（1-100）
     * @returns 随机字符串
     */
    static generateRandomString(length: number): string {
        // 限制长度范围
        const actualLength = Math.max(1, Math.min(100, length));

        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

        // 使用加密安全的随机数生成器
        const randomBytes = new Uint8Array(actualLength);
        crypto.getRandomValues(randomBytes);

        let result = '';
        for (let i = 0; i < actualLength; i++) {
            const randomIndex = randomBytes[i] % chars.length;
            result += chars[randomIndex];
        }

        // 确保至少包含一个数字和一个字母
        const hasNumber = /\d/.test(result);
        const hasLetter = /[a-zA-Z]/.test(result);

        if (!hasNumber || !hasLetter) {
            // 如果不满足条件，重新生成
            // 确保第一个字符是数字，第二个字符是字母
            const numBytes = new Uint8Array(1);
            const letterBytes = new Uint8Array(1);
            crypto.getRandomValues(numBytes);
            crypto.getRandomValues(letterBytes);

            const resultArray = result.split('');
            if (!hasNumber && resultArray.length > 0) {
                resultArray[0] = numbers[numBytes[0] % numbers.length];
            }
            if (!hasLetter && resultArray.length > 1) {
                resultArray[1] = letters[letterBytes[0] % letters.length];
            }
            result = resultArray.join('');
        }

        return result;
    }
}
