import { describe, expect, it } from "vitest";
import { LoopDataResolver } from "src/utils/LoopDataResolver";
import { LoopVariableScope } from "src/utils/LoopVariableScope";
import { ActionContext } from "src/service/action/IActionService";
import { FormState } from "src/service/FormState";
import { FormConfig } from "src/model/FormConfig";
import { App } from "obsidian";
import { BreakActionService } from "src/service/action/loop/BreakActionService";
import { ContinueActionService } from "src/service/action/loop/ContinueActionService";
import { IFormAction } from "src/model/action/IFormAction";
import { FormActionType } from "src/model/enums/FormActionType";
import { LoopVariableValidator } from "src/utils/LoopVariableValidator";
import {
	LoopBreakError,
	LoopContinueError,
	LoopMaxIterationError,
} from "src/service/action/loop/LoopControlError";
import { LoopFormAction } from "src/model/action/LoopFormAction";
import { LoopType } from "src/model/enums/LoopType";

const createContext = (): ActionContext => {
	const state: FormState = {
		idValues: {},
		values: {
			names: ["Ada", "Ben", "Carl"],
			shouldContinue: false,
			stats: {
				total: 3,
			},
		},
	};

	return {
		state,
		config: new FormConfig("test"),
		app: {} as App,
	};
};

describe("LoopDataResolver", () => {
	it("generates increasing and decreasing sequences", () => {
		expect(LoopDataResolver.generateCountIterations(0, 3, 1)).toEqual([
			0, 1, 2, 3,
		]);
		expect(LoopDataResolver.generateCountIterations(3, 0, 1)).toEqual([
			3, 2, 1, 0,
		]);
	});

	it("throws when step is zero", () => {
		expect(() => LoopDataResolver.generateCountIterations(0, 1, 0)).toThrow(
			"Loop step cannot be 0"
		);
	});

	it("resolves list data source from state values", async () => {
		const context = createContext();
		const result = await LoopDataResolver.resolveListDataSource(
			"names",
			context
		);
		expect(result).toEqual(["Ada", "Ben", "Carl"]);
	});

	it("parses inline JSON arrays", async () => {
		const context = createContext();
		const result = await LoopDataResolver.resolveListDataSource(
			'["x","y"]',
			context
		);
		expect(result).toEqual(["x", "y"]);
	});

	it("splits newline separated values and nested paths", async () => {
		const context = createContext();
		const result = await LoopDataResolver.resolveListDataSource(
			"a\nb\nc",
			context
		);
		expect(result).toEqual(["a", "b", "c"]);

		const commaSeparated = await LoopDataResolver.resolveListDataSource(
			"a, b ,c",
			context
		);
		expect(commaSeparated).toEqual(["a", "b", "c"]);

		const objectValues = await LoopDataResolver.resolveListDataSource(
			"stats",
			context
		);
		expect(objectValues).toEqual([3]);

		const nestedPath = await LoopDataResolver.resolveListDataSource(
			"state.values.names",
			context
		);
		expect(nestedPath).toEqual(["Ada", "Ben", "Carl"]);

		const indexedPath = await LoopDataResolver.resolveListDataSource(
			"names.0",
			context
		);
		expect(indexedPath).toEqual(["names.0"]);
	});

	it("evaluates boolean expressions", async () => {
		const context = createContext();
		const shouldContinue = await LoopDataResolver.evaluateCondition(
			"values.shouldContinue === false",
			context
		);
		expect(shouldContinue).toBe(true);

		const booleanLiteral = await LoopDataResolver.evaluateCondition(
			"true",
			context
		);
		expect(booleanLiteral).toBe(true);

		const invalidExpression = await LoopDataResolver.evaluateCondition(
			"???",
			context
		);
		expect(invalidExpression).toBe(false);
	});

	it("resolves iterations by loop type", async () => {
		const context = createContext();
		const loopAction = new LoopFormAction();
		loopAction.loopType = LoopType.LIST;
		loopAction.listDataSource = "names";

		expect(
			await LoopDataResolver.resolveIterations(loopAction, context)
		).toHaveLength(3);

		loopAction.loopType = LoopType.COUNT;
		loopAction.countStart = 0;
		loopAction.countEnd = 1;
		expect(
			await LoopDataResolver.resolveIterations(loopAction, context)
		).toEqual([0, 1]);

		loopAction.loopType = LoopType.CONDITION;
		expect(
			await LoopDataResolver.resolveIterations(loopAction, context)
		).toEqual([]);

		loopAction.loopType = LoopType.PAGINATION;
		expect(
			await LoopDataResolver.resolveIterations(loopAction, context)
		).toEqual([]);
	});
});

describe("LoopVariableScope", () => {
	it("pushes and pops variable scopes", () => {
		LoopVariableScope.push({ item: 1 });
		expect(LoopVariableScope.getValue("item")).toBe(1);
		LoopVariableScope.push({ item: 2, index: 0 });
		expect(LoopVariableScope.getValue("item")).toBe(2);
		expect(LoopVariableScope.getValue("index")).toBe(0);
		LoopVariableScope.pop();
		expect(LoopVariableScope.getValue("item")).toBe(1);
		LoopVariableScope.pop();
		expect(LoopVariableScope.getValue("item")).toBeUndefined();
	});
	it("returns undefined when scope is empty", () => {
		expect(LoopVariableScope.getValue("missing")).toBeUndefined();
	});
});

describe("LoopVariableValidator", () => {
	it("validates identifiers and sanitizes names", () => {
		expect(LoopVariableValidator.isValid("item")).toBe(true);
		expect(LoopVariableValidator.isValid("1bad")).toBe(false);
		expect(LoopVariableValidator.isValid("")).toBe(false);
		expect(LoopVariableValidator.isValid(undefined)).toBe(false);
		expect(LoopVariableValidator.sanitize("validName", "fallback")).toBe(
			"validName"
		);
		expect(LoopVariableValidator.sanitize("123", "fallback")).toBe("fallback");
	});
});

describe("Loop control errors", () => {
	it("exposes custom error names", () => {
		expect(new LoopBreakError().name).toBe("LoopBreakError");
		expect(new LoopContinueError().name).toBe("LoopContinueError");
		expect(new LoopMaxIterationError(10).message).toContain("10");
	});
});

describe("Loop control actions", () => {
	const breakService = new BreakActionService();
	const continueService = new ContinueActionService();

	const mockAction: IFormAction = {
		id: "test",
		type: FormActionType.BREAK,
	};

	it("exposes accept guards", () => {
		expect(breakService.accept({ id: "1", type: FormActionType.BREAK } as any)).toBe(
			true
		);
		expect(
			continueService.accept({ id: "1", type: FormActionType.CONTINUE } as any)
		).toBe(true);
	});

	it("throws when break used outside loop context", async () => {
		await expect(
			breakService.run(mockAction, createContext(), null as any)
		).rejects.toThrow();
	});

	it("sets flags when break/continue invoked inside loop", async () => {
		const context = createContext();
		context.loopContext = {
			variables: {},
			depth: 1,
			canBreak: true,
			canContinue: true,
			parent: undefined,
		};

		await expect(
			breakService.run(mockAction, context, null as any)
		).rejects.toThrow();
		expect(context.loopContext.breakRequested).toBe(true);

		context.loopContext.breakRequested = false;
		await expect(
			continueService.run(
				{ ...mockAction, type: FormActionType.CONTINUE },
				context,
				null as any
			)
		).rejects.toThrow();
		expect(context.loopContext.continueRequested).toBe(true);
	});
});

