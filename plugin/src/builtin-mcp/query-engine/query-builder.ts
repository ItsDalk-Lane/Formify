import {
	QueryExecutionOptions,
	QueryRow,
	QuerySourceName,
	QuerySources,
} from './types';

type SelectorInput =
	| string
	| string[]
	| ((row: QueryRow) => unknown);

type PredicateInput =
	| string
	| ((row: QueryRow) => boolean);

type Direction = 'asc' | 'desc';

const normalizeDirection = (value?: string): Direction => {
	return String(value ?? 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
};

const parsePredicate = (
	predicate: PredicateInput
): ((row: QueryRow) => boolean) => {
	if (typeof predicate === 'function') {
		return predicate;
	}

	const expr = String(predicate ?? '').trim();
	if (!expr) {
		return () => true;
	}

	const fn = new Function('row', `return (${expr});`) as (
		row: QueryRow
	) => unknown;
	return (row: QueryRow) => Boolean(fn(row));
};

const parseSelector = (
	selector?: SelectorInput
): ((row: QueryRow) => unknown) => {
	if (typeof selector === 'function') {
		return selector;
	}
	if (typeof selector === 'string') {
		return (row: QueryRow) => (row as Record<string, unknown>)[selector];
	}
	if (Array.isArray(selector)) {
		return (row: QueryRow) => {
			const source = row as Record<string, unknown>;
			const output: Record<string, unknown> = {};
			for (const key of selector) {
				output[key] = source[key];
			}
			return output;
		};
	}
	return (row: QueryRow) => row;
};

export class QueryBuilder {
	private sourceName: QuerySourceName | null = null;
	private readonly pipeline: Array<(rows: QueryRow[]) => QueryRow[]> = [];

	constructor(
		private readonly sources: QuerySources,
		private readonly options: QueryExecutionOptions
	) {}

	from(sourceName: QuerySourceName): this {
		this.sourceName = sourceName;
		return this;
	}

	select(selector?: SelectorInput): this {
		const mapper = parseSelector(selector);
		this.pipeline.push((rows) => rows.map((row) => mapper(row) as QueryRow));
		return this;
	}

	where(predicate: PredicateInput): this {
		const matcher = parsePredicate(predicate);
		this.pipeline.push((rows) => rows.filter((row) => matcher(row)));
		return this;
	}

	groupBy(selector: SelectorInput): this {
		const keySelector = parseSelector(selector);
		this.pipeline.push((rows) => {
			const grouped = new Map<string, { key: unknown; items: QueryRow[] }>();
			for (const row of rows) {
				const key = keySelector(row);
				const keyText = JSON.stringify(key);
				const bucket = grouped.get(keyText);
				if (bucket) {
					bucket.items.push(row);
				} else {
					grouped.set(keyText, {
						key,
						items: [row],
					});
				}
			}

			return Array.from(grouped.values()).map((entry) => ({
				key: entry.key,
				count: entry.items.length,
				items: entry.items,
			})) as QueryRow[];
		});
		return this;
	}

	orderBy(selector: SelectorInput, direction: Direction = 'asc'): this {
		const keySelector = parseSelector(selector);
		const normalizedDirection = normalizeDirection(direction);
		this.pipeline.push((rows) => {
			return [...rows].sort((a, b) => {
				const av = keySelector(a) as string | number | boolean | null | undefined;
				const bv = keySelector(b) as string | number | boolean | null | undefined;
				if (av === bv) return 0;
				if (av === undefined || av === null) return normalizedDirection === 'asc' ? -1 : 1;
				if (bv === undefined || bv === null) return normalizedDirection === 'asc' ? 1 : -1;
				if (av > bv) return normalizedDirection === 'asc' ? 1 : -1;
				return normalizedDirection === 'asc' ? -1 : 1;
			});
		});
		return this;
	}

	limit(limitCount: number): this {
		const size = Number.isFinite(limitCount)
			? Math.max(0, Math.floor(limitCount))
			: 0;
		this.pipeline.push((rows) => rows.slice(0, size));
		return this;
	}

	offset(offsetCount: number): this {
		const offsetValue = Number.isFinite(offsetCount)
			? Math.max(0, Math.floor(offsetCount))
			: 0;
		this.pipeline.push((rows) => rows.slice(offsetValue));
		return this;
	}

	count(): number {
		return this.execute().length;
	}

	sum(selector: SelectorInput): number {
		const valueSelector = parseSelector(selector);
		return this.execute().reduce((total, row) => {
			const value = Number(valueSelector(row));
			return total + (Number.isFinite(value) ? value : 0);
		}, 0);
	}

	execute(): QueryRow[] {
		if (!this.sourceName) {
			throw new Error('query_vault: 必须先调用 from(source)');
		}
		let rows = [...this.sources[this.sourceName]] as QueryRow[];
		for (const op of this.pipeline) {
			rows = op(rows);
		}
		if (rows.length > this.options.maxRows) {
			return rows.slice(0, this.options.maxRows);
		}
		return rows;
	}
}

export const createDslFunctions = (
	sources: QuerySources,
	options: QueryExecutionOptions
): {
	query: () => QueryBuilder;
	from: (source: QuerySourceName) => QueryBuilder;
	select: (selector?: SelectorInput) => QueryBuilder;
	where: (predicate: PredicateInput) => QueryBuilder;
	groupBy: (selector: SelectorInput) => QueryBuilder;
	orderBy: (selector: SelectorInput, direction?: Direction) => QueryBuilder;
	limit: (limitCount: number) => QueryBuilder;
	offset: (offsetCount: number) => QueryBuilder;
	count: (source: QuerySourceName) => number;
	sum: (source: QuerySourceName, selector: SelectorInput) => number;
} => {
	const query = () => new QueryBuilder(sources, options);
	return {
		query,
		from: (source: QuerySourceName) => query().from(source),
		select: (selector?: SelectorInput) => query().select(selector),
		where: (predicate: PredicateInput) => query().where(predicate),
		groupBy: (selector: SelectorInput) => query().groupBy(selector),
		orderBy: (selector: SelectorInput, direction?: Direction) =>
			query().orderBy(selector, direction),
		limit: (limitCount: number) => query().limit(limitCount),
		offset: (offsetCount: number) => query().offset(offsetCount),
		count: (source: QuerySourceName) => query().from(source).count(),
		sum: (source: QuerySourceName, selector: SelectorInput) =>
			query().from(source).sum(selector),
	};
};
