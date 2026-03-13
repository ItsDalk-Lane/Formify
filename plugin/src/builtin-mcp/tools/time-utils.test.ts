import { Settings } from 'luxon';
import {
	buildCurrentTimeResult,
	buildTimeConversionResult,
	formatHourDiff,
	validateIanaTimezone,
} from './time-utils';

const FIXED_TS = Date.parse('2024-01-01T00:00:00.000Z');

describe('time-utils', () => {
	const originalNow = Settings.now;

	beforeEach(() => {
		Settings.now = () => FIXED_TS;
	});

	afterEach(() => {
		Settings.now = originalNow;
	});

	describe('validateIanaTimezone', () => {
		it('should accept valid IANA timezone', () => {
			expect(validateIanaTimezone('Europe/London')).toBe('Europe/London');
		});

		it('should throw on invalid timezone', () => {
			expect(() => validateIanaTimezone('Invalid/Timezone')).toThrow(
				'Invalid timezone: Invalid/Timezone'
			);
		});
	});

	describe('formatHourDiff', () => {
		it('should format integer hour differences with one decimal', () => {
			expect(formatHourDiff(1)).toBe('+1.0h');
			expect(formatHourDiff(-1)).toBe('-1.0h');
			expect(formatHourDiff(0)).toBe('+0.0h');
		});

		it('should format fractional hour differences with trimmed trailing zeroes', () => {
			expect(formatHourDiff(4.75)).toBe('+4.75h');
			expect(formatHourDiff(-4.5)).toBe('-4.5h');
		});
	});

	describe('buildCurrentTimeResult', () => {
		it('should return structured current time result', () => {
			const result = buildCurrentTimeResult('Europe/London');
			expect(result).toEqual({
				timezone: 'Europe/London',
				datetime: '2024-01-01T00:00:00+00:00',
				day_of_week: 'Monday',
				is_dst: false,
				month: 1,
				iso_week_of_year: 1,
				iso_week_year: 2024,
			});
		});
	});

	describe('buildTimeConversionResult', () => {
		it('should convert time between Warsaw and London in winter', () => {
			const result = buildTimeConversionResult(
				'Europe/Warsaw',
				'12:00',
				'Europe/London'
			);

			expect(result.source).toEqual({
				timezone: 'Europe/Warsaw',
				datetime: '2024-01-01T12:00:00+01:00',
				day_of_week: 'Monday',
				is_dst: false,
				month: 1,
				iso_week_of_year: 1,
				iso_week_year: 2024,
			});
			expect(result.target).toEqual({
				timezone: 'Europe/London',
				datetime: '2024-01-01T11:00:00+00:00',
				day_of_week: 'Monday',
				is_dst: false,
				month: 1,
				iso_week_of_year: 1,
				iso_week_year: 2024,
			});
			expect(result.time_difference).toBe('-1.0h');
		});

		it('should support fractional offsets like Kathmandu', () => {
			const result = buildTimeConversionResult(
				'Europe/Warsaw',
				'12:00',
				'Asia/Kathmandu'
			);

			expect(result.time_difference).toBe('+4.75h');
			expect(result.target.datetime).toBe('2024-01-01T16:45:00+05:45');
		});

		it('should throw on invalid HH:MM', () => {
			expect(() =>
				buildTimeConversionResult('Europe/Warsaw', '25:00', 'Europe/London')
			).toThrow('Invalid time format. Expected HH:MM [24-hour format]');
		});

		it('should throw on invalid timezone', () => {
			expect(() =>
				buildTimeConversionResult('Invalid/Timezone', '12:00', 'Europe/London')
			).toThrow('Invalid timezone: Invalid/Timezone');
		});
	});
});
