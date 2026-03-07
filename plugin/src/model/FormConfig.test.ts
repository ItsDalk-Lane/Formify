import { ActionTrigger } from "./ActionTrigger";
import { FormConfig } from "./FormConfig";

describe("FormConfig", () => {
	it("should normalize plain action triggers before cleaning invalid action refs", () => {
		const config = new FormConfig("form-1");
		config.actions = [
			{ id: "action-1" } as any,
		];
		config.actionTriggers = [
			{
				id: "trigger-1",
				name: "Trigger 1",
				actionIds: ["action-1", "missing-action"],
			} as any,
		];

		expect(() => config.cleanupTriggerActionRefs()).not.toThrow();
		expect(config.actionTriggers[0]).toBeInstanceOf(ActionTrigger);
		expect(config.actionTriggers[0].actionIds).toEqual(["action-1"]);
	});
});
