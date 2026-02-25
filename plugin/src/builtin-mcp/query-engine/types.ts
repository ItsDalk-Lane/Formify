export type QuerySourceName =
	| 'file'
	| 'property'
	| 'tag'
	| 'property_value'
	| 'task';

export interface QueryFileRecord {
	source: 'file';
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: string;
	size: number;
	mtime: number;
	ctime: number;
}

export interface QueryPropertyRecord {
	source: 'property';
	path: string;
	property: string;
	value: unknown;
}

export interface QueryPropertyValueRecord {
	source: 'property_value';
	path: string;
	property: string;
	value: unknown;
}

export interface QueryTagRecord {
	source: 'tag';
	path: string;
	tag: string;
}

export interface QueryTaskRecord {
	source: 'task';
	path: string;
	line: number;
	text: string;
	completed: boolean;
	status: 'todo' | 'done';
}

export interface QuerySources {
	file: QueryFileRecord[];
	property: QueryPropertyRecord[];
	tag: QueryTagRecord[];
	property_value: QueryPropertyValueRecord[];
	task: QueryTaskRecord[];
}

export type QueryRow =
	| QueryFileRecord
	| QueryPropertyRecord
	| QueryTagRecord
	| QueryPropertyValueRecord
	| QueryTaskRecord
	| Record<string, unknown>;

export interface QueryExecutionOptions {
	maxRows: number;
}
