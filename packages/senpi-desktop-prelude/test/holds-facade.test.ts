import { describe, expect, it } from "vitest";
import { loadJsFacade, runPythonFacade, windowResponder } from "./harness";

describe("bounded hold prelude facades", () => {
	it("sends JS root and window holds as exec helper calls", async () => {
		// Given the real prelude bound to a recording tool bridge.
		const kernel = loadJsFacade(windowResponder);
		// When keys and a button are held on separate target surfaces.
		await kernel.run(`
			await computer.holdKeys(["ctrl", "a"], { duration: 0.5 });
			const win = await computer.window("w1");
			await win.holdMouse(12, 34, { duration: 1, button: "right", keys: ["shift"] });
		`);
		// Then duration/options and key order survive the tool boundary.
		expect(kernel.calls[0]).toEqual({ action: "call", chain: [{
			method: "holdKeys", args: [["ctrl", "a"], { duration: 0.5 }],
		}] });
		expect(kernel.calls.at(-1)).toEqual({ action: "call", chain: [
			{ method: "window", args: ["w1"] },
			{ method: "holdMouse", args: [12, 34, { duration: 1, button: "right", keys: ["shift"] }] },
		] });
	});

	it("sends Python keyword arguments as the same trailing options object", () => {
		// Given the real Python prelude.
		const result = runPythonFacade(`
computer.holdKeys(['ctrl', 'a'], duration=0.5)
computer.window('w1').holdMouse(12, 34, duration=1, button='right', keys=['shift'])
`);
		// Then both calls use the same wire chain as JavaScript.
		expect(result.error).toBeNull();
		expect(result.calls[0]).toEqual({ action: "call", chain: [{
			method: "holdKeys", args: [["ctrl", "a"], { duration: 0.5 }],
		}] });
		expect(result.calls.at(-1)).toEqual({ action: "call", chain: [
			{ method: "window", args: ["w1"] },
			{ method: "holdMouse", args: [12, 34, { duration: 1, button: "right", keys: ["shift"] }] },
		] });
	});
});
