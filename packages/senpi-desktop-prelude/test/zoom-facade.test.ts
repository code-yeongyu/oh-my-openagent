import { describe, expect, it } from "vitest";
import { IMAGE, loadJsFacade, runPythonFacade, windowResponder } from "./harness";

const region = { x: 8, y: 6, width: 8, height: 6 };
const zoom = {
	target: "desktop", frameId: "frame-1", width: 16, height: 12,
	sourceWidth: 16, sourceHeight: 12, coordinateWidth: 32, coordinateHeight: 24,
	scale: 1, region,
};

describe("region zoom facade", () => {
	it("routes root and window zoom with unchanged full-frame metadata", async () => {
		// Given
		const kernel = loadJsFacade((args) =>
			Array.isArray(args.chain) && args.chain.at(-1)?.method === "zoom"
				? { text: "", details: { value: zoom }, images: [IMAGE] }
				: windowResponder(args),
		);
		// When
		const result = await kernel.run(`
			const region = ${JSON.stringify(region)};
			const shot = await computer.zoom(region);
			const win = await computer.window("w1");
			await win.zoom(region, { silent: true, frameId: shot.frameId });
			return shot;
		`);
		// Then
		expect(result).toEqual(zoom);
		expect(kernel.calls).toEqual([
			{ action: "call", chain: [{ method: "zoom", args: [region] }] },
			{ action: "call", chain: [{ method: "window", args: ["w1"] }] },
			{ action: "call", chain: [
				{ method: "window", args: ["w1"] },
				{ method: "zoom", args: [region, { silent: true, frameId: "frame-1" }] },
			] },
		]);
		expect(kernel.displayed).toEqual([IMAGE, IMAGE]);
	});

	it("routes Python zoom on the same surfaces", () => {
		// Given
		const reply = JSON.stringify({ text: "", details: { value: zoom } });
		// When
		const result = runPythonFacade(`
region = ${JSON.stringify(region)}
out = computer.zoom(region)
computer.window('w1').zoom(region, silent=True, frameId=out['frameId'])
`, { zoom: reply });
		// Then
		expect(result.error).toBeNull();
		expect(result.out).toEqual(zoom);
		expect(result.calls.at(-1)).toEqual({ action: "call", chain: [
			{ method: "window", args: ["w1"] },
			{ method: "zoom", args: [region, { silent: true, frameId: "frame-1" }] },
		] });
	});
});
