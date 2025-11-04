import { moment } from "obsidian";
import { Objects } from "./Objects";
import { DateTimeCalculator } from "./DateTimeCalculator";

export function processObTemplate(templateContent: any) {
    return processObTemplateInContext(templateContent, { moment: moment() });
}

type Context = {
    moment: moment.Moment;
    title?: string;
}

export function processObTemplateInContext(templateContent: any, context: Context) {
    if (!Objects.exists(templateContent)) {
        return templateContent;
    }
    if (typeof templateContent !== 'string') {
        return templateContent;
    }

    let res = templateContent;
    const momentTime = context.moment;

    // 处理 {{date:format|offset}} 格式（支持相对日期计算）
    const dateWithOffsetRegex = /{{date:(.*?)\|(.*?)}}/g;
    res = res.replace(dateWithOffsetRegex, (match, format, offset) => {
        const calculatedDate = DateTimeCalculator.calculateRelativeDate(momentTime, offset);
        return calculatedDate.format(format?.trim() || "YYYY-MM-DD");
    });

    // 处理 {{date:format}} 格式（普通日期格式化）
    const dateFormatRegex = /{{date:(.*?)}}/g;
    res = res.replace(dateFormatRegex, (match, format) => {
        return momentTime.format(format?.trim() || "YYYY-MM-DD");
    });

    // 处理 {{date}} 格式（默认格式）
    const dateRegex = /{{date}}/g;
    res = res.replace(dateRegex, () => {
        return momentTime.format("YYYY-MM-DD");
    });

    // 处理 {{time:offset}} 格式（支持时间运算）
    const timeWithOffsetRegex = /{{time:([+-]\d+.*?)}}/g;
    res = res.replace(timeWithOffsetRegex, (match, offset) => {
        const calculatedTime = DateTimeCalculator.calculateTimeOffset(momentTime, offset);
        return calculatedTime.format("HH:mm");
    });

    // 处理 {{time:format}} 格式（普通时间格式化）
    const timeFormatRegex = /{{time:((?![+-]\d).*?)}}/g;
    res = res.replace(timeFormatRegex, (match, format) => {
        return momentTime.format(format?.trim() || "HH:mm");
    });

    // 处理 {{time}} 格式（默认格式）
    const timeRegex = /{{time}}/g;
    res = res.replace(timeRegex, () => {
        return momentTime.format("HH:mm");
    });

    // 处理 {{random:<length>}} 格式（生成随机字符串）
    const randomRegex = /{{random:(\d+)}}/g;
    res = res.replace(randomRegex, (match, length) => {
        const len = parseInt(length, 10);
        return DateTimeCalculator.generateRandomString(len);
    });

    // 处理 {{title}} 格式
    if (context.title) {
        const titleRegex = /{{title}}/g;
        res = res.replace(titleRegex, () => {
            if (context.title) {
                return context.title;
            }
            // return original 
            return "{{title}}";
        });
    }
    
    return res;
}