import { describe, expect, it } from "vitest";
import { IMAGE, loadJsFacade, runPythonFacade, windowResponder } from "./harness";

const observation = {
	target: "w1", frameId: "frame-1", width: 32, height: 24, sourceWidth: 64, sourceHeight: 48,
	coordinateWidth: 32, coordinateHeight: 24, scale: 0.5,
	ax: "button Run [ref=e1]", nodeCount: 1, truncated: false,
};
const reply = { text: "", details: { value: observation }, images: [IMAGE] };

describe("window observe kernel facade", () => {
	it("routes JavaScript options and returns combined fields", async () => {
		const kernel = loadJsFacade((args) =>
			Array.isArray(args.chain) && args.chain.at(-1)?.method === "observe" ? reply : windowResponder(args),
		);
		const result = await kernel.run(`
			const win = await computer.window("w1");
			return await win.observe({ silent: true, all: true, maxDepth: 3, maxNodes: 12 });
		`);
		expect(result).toEqual(observation);
		expect(kernel.calls.at(-1)).toEqual({ action: "call", chain: [
			{ method: "window", args: ["w1"] },
			{ method: "observe", args: [{ silent: true, all: true, maxDepth: 3, maxNodes: 12 }] },
		] });
		expect(kernel.displayed).toEqual([IMAGE]);
	});

	it("routes Python dictionary and keyword options identically", () => {
		const result = runPythonFacade(`
win = computer.window('w1')
out = win.observe(silent=True, all=True, maxDepth=3, maxNodes=12)
win.observe({'silent': True, 'maxNodes': 12})
`, { observe: JSON.stringify(reply) });
		expect(result.error).toBeNull();
		expect(result.out).toEqual(observation);
		expect(result.calls.slice(-2)).toEqual([
			{ action: "call", chain: [
				{ method: "window", args: ["w1"] },
				{ method: "observe", args: [{ silent: true, all: true, maxDepth: 3, maxNodes: 12 }] },
			] },
			{ action: "call", chain: [
				{ method: "window", args: ["w1"] },
				{ method: "observe", args: [{ silent: true, maxNodes: 12 }] },
			] },
		]);
	});

	it("propagates a refusal through both facades", async () => {
		const refusal = { text: "observe unavailable", hasError: true };
		const kernel = loadJsFacade((args) =>
			Array.isArray(args.chain) && args.chain.at(-1)?.method === "observe" ? refusal : windowResponder(args),
		);
		await expect(kernel.run(`return await (await computer.window("w1")).observe();`)).rejects.toThrow("observe unavailable");
		const result = runPythonFacade(`out = computer.window('w1').observe()`, { observe: JSON.stringify(refusal) });
		expect(result.error).toContain("observe unavailable");
	});
});
