import { DateTime, IANAZone } from 'luxon';

export interface TimeResult {
	timezone: string;
	datetime: string;
	day_of_week: string;
	is_dst: boolean;
	month: number;
	iso_week_of_year: number;
	iso_week_year: number;
}

export interface TimeConversionResult {
	source: TimeResult;
	target: TimeResult;
	time_difference: string;
}

const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toIsoSeconds = (dt: DateTime): string => {
	const iso = dt.toISO({
		suppressMilliseconds: true,
	});
	if (!iso) {
		throw new Error('Failed to format datetime to ISO string');
	}
	return iso;
};

const toTimeResult = (timezone: string, dt: DateTime): TimeResult => {
	return {
		timezone,
		datetime: toIsoSeconds(dt),
		day_of_week: dt.setLocale('en').toFormat('cccc'),
		is_dst: dt.isInDST,
		month: dt.month,
		iso_week_of_year: dt.weekNumber,
		iso_week_year: dt.weekYear,
	};
};

export function validateIanaTimezone(tz: string): string {
	const normalized = String(tz ?? '').trim();
	if (!IANAZone.isValidZone(normalized)) {
		throw new Error(`Invalid timezone: ${normalized}`);
	}
	return normalized;
}

export function formatHourDiff(diffHours: number): string {
	if (!Number.isFinite(diffHours)) {
		throw new Error('Invalid hour difference');
	}

	if (Number.isInteger(diffHours)) {
		return `${diffHours >= 0 ? '+' : ''}${diffHours.toFixed(1)}h`;
	}

	const absValue = Math.abs(diffHours);
	const compact = absValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
	return `${diffHours >= 0 ? '+' : '-'}${compact}h`;
}

export function buildCurrentTimeResult(timezone: string): TimeResult {
	const normalizedTimezone = validateIanaTimezone(timezone);
	const now = DateTime.now().setZone(normalizedTimezone);
	if (!now.isValid) {
		throw new Error(`Invalid timezone: ${normalizedTimezone}`);
	}
	return toTimeResult(normalizedTimezone, now);
}

export function buildTimeConversionResult(
	sourceTimezone: string,
	timeHHMM: string,
	targetTimezone: string
): TimeConversionResult {
	const normalizedSourceTimezone = validateIanaTimezone(sourceTimezone);
	const normalizedTargetTimezone = validateIanaTimezone(targetTimezone);
	const normalizedTime = String(timeHHMM ?? '').trim();

	const matches = normalizedTime.match(TIME_24H_REGEX);
	if (!matches) {
		throw new Error('Invalid time format. Expected HH:MM [24-hour format]');
	}

	const hour = Number(matches[1]);
	const minute = Number(matches[2]);
	const nowInSourceTimezone = DateTime.now().setZone(normalizedSourceTimezone);
	const sourceTime = DateTime.fromObject(
		{
			year: nowInSourceTimezone.year,
			month: nowInSourceTimezone.month,
			day: nowInSourceTimezone.day,
			hour,
			minute,
			second: 0,
			millisecond: 0,
		},
		{
			zone: normalizedSourceTimezone,
		}
	);

	if (!sourceTime.isValid) {
		throw new Error('Invalid time format. Expected HH:MM [24-hour format]');
	}

	const targetTime = sourceTime.setZone(normalizedTargetTimezone);
	if (!targetTime.isValid) {
		throw new Error(`Invalid timezone: ${normalizedTargetTimezone}`);
	}

	const hoursDifference = (targetTime.offset - sourceTime.offset) / 60;

	return {
		source: toTimeResult(normalizedSourceTimezone, sourceTime),
		target: toTimeResult(normalizedTargetTimezone, targetTime),
		time_difference: formatHourDiff(hoursDifference),
	};
}
