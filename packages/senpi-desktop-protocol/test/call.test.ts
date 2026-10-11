import { describe, expect, it } from "vitest";
import { ComputerCallError, type ComputerCallStep, isReadOnlyComputerCall } from "../src/index";

function rejectionReason(chain: readonly ComputerCallStep[]): string {
	try {
		isReadOnlyComputerCall(chain);
	} catch (error) {
		if (error instanceof ComputerCallError) {
			return error.reason;
		}
		throw error;
	}
	throw new Error("expected the chain to be rejected");
}

describe("isReadOnlyComputerCall", () => {
	it("returns true when a window screenshot chain is inspection-only", () => {
		expect(isReadOnlyComputerCall([{ method: "window" }, { method: "screenshot" }])).toBe(true);
	});

	it("returns false when a window click chain mutates", () => {
		expect(isReadOnlyComputerCall([{ method: "window" }, { method: "click" }])).toBe(false);
	});

	it("returns false when clipboard.write is the only step", () => {
		expect(isReadOnlyComputerCall([{ method: "clipboard.write" }])).toBe(false);
	});

	it("returns false when a ref press chain mutates", () => {
		expect(isReadOnlyComputerCall([{ method: "ref" }, { method: "press" }])).toBe(false);
	});

	it("throws tooLong when a call chain is longer than two steps", () => {
		expect(rejectionReason([{ method: "window" }, { method: "screenshot" }, { method: "click" }])).toBe("tooLong");
	});

	it("throws empty when the chain has no steps", () => {
		expect(rejectionReason([])).toBe("empty");
	});

	it("rejects an unknown reset chain as unknown instead of classifying it read", () => {
		expect(rejectionReason([{ method: "reset" }])).toBe("unknownMethod");
	});

	it("rejects an unknown handle method as unknown instead of classifying it read", () => {
		expect(rejectionReason([{ method: "window" }, { method: "reset" }])).toBe("unknownMethod");
	});

	it("rejects a chained call on a root that returns no handle", () => {
		expect(rejectionReason([{ method: "screenshot" }, { method: "click" }])).toBe("notChainable");
	});

	it("classifies menu.items as inspection and menu.select as mutation on a window handle", () => {
		expect(isReadOnlyComputerCall([{ method: "window" }, { method: "menu.items" }])).toBe(true);
		expect(isReadOnlyComputerCall([{ method: "window" }, { method: "menu.select" }])).toBe(false);
	});
});
