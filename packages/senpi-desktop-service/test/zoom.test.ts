import { afterEach, describe, expect, it } from "vitest";
import { runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory } from "./harness";

const services: DesktopService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function open(env: Readonly<Record<string, string>> = {}) {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	const run = (code: string, readOnly = true) => runComputerCode({
		code, timeoutMs: 5_000,
		snapshot: {
			cwd: "/work", sessionId: "zoom-test", captureMaxWidth: 3840,
			captureMaxHeight: 2400, captureMaxBytes: 5_000_000, display: "active",
			readOnly, stopHotkey: "ctrl+alt+shift+escape", allowHostRelayOnlyStop: false,
		},
	}, { service, executeTool: async () => undefined });
	return { log, run };
}

describe("native region zoom", { timeout: 30_000 }, () => {
	it.each(["desktop", '(await desktop.window("101"))', '(await desktop.display("active"))'])(
		"routes %s zoom through captureRegion as a read", async (target) => {
			// Given
			const { log, run } = await open();
			// When
			const result = await run(`
				const target = ${target};
				const full = await target.screenshot({ silent: true });
				const shot = await target.zoom({ x: 8, y: 6, width: 8, height: 6 }, { frameId: full.frameId });
				return { full, shot };
			`);
			// Then
			expect(result.returnValue).toMatchObject({
				full: { frameId: expect.any(String) },
				shot: { width: 16, height: 12, region: { x: 8, y: 6, width: 8, height: 6 },
					coordinateWidth: expect.any(Number), coordinateHeight: expect.any(Number) },
			});
			expect(log.requests.find((request) => request.method === "captureRegion")?.params).toEqual({
				target: target === "desktop" ? "desktop" : target.includes("window") ? "101" : "display:active",
				region: { x: 8, y: 6, width: 8, height: 6 },
				frameId: expect.any(String), caps: { maxWidth: 3840, maxHeight: 2400, maxBytes: 5_000_000 },
			});
			expect(result.displays.map((display) => display.type)).toEqual(["text", "image"]);
		},
	);

	it("keeps click on the full frame after zoom", async () => {
		// Given
		const { run } = await open();
		// When
		const result = await run(`
			const full = await desktop.screenshot({ silent: true });
			const shot = await desktop.zoom({ x: 8, y: 6, width: 8, height: 6 }, { silent: true });
			await desktop.click(300, 200);
			return { fullId: full.frameId, zoomId: shot.frameId };
		`, false);
		// Then
		expect(result.returnValue).toEqual({ fullId: "desktop-1", zoomId: "desktop-1" });
		expect(result.audit[0]).toMatchObject({ frameId: "desktop-1", action: "click" });
		expect(result.displays).toEqual([]);
	});


	it.each(["FAKE_ENGINE_ZOOM_NO_FRAME", "FAKE_ENGINE_ZOOM_NO_REGION"])(
		"refuses a zoom reply that omits the full input frame or its region (%s)", async (broken) => {
		// Given
		const { run } = await open({ [broken]: "1" });
		// When
		const zoom = run(`const full = await desktop.screenshot({ silent: true }); return await desktop.zoom({ x: 0, y: 0, width: 8, height: 6 }, { frameId: full.frameId });`);
		// Then
		await expect(zoom).rejects.toThrow("malformed captureRegion result");
	});

	it("keeps screenshots working against an engine that predates zoom, and reports zoom as unavailable", async () => {
		// Given: an engine on the same ABI without coordinate fields or captureRegion
		const { log, run } = await open({ FAKE_ENGINE_PRE_ZOOM: "1" });
		// When
		const shot = await run(`return await desktop.screenshot({ silent: true });`);
		const zoom = run(`const full = await desktop.screenshot({ silent: true }); return await desktop.zoom({ x: 0, y: 0, width: 8, height: 6 });`);
		// Then: the full frame falls back to the capture's own size
		expect(shot.returnValue).toMatchObject({ width: 1280, height: 800, coordinateWidth: 1280, coordinateHeight: 800 });
		await expect(zoom).rejects.toThrow("Method not found");
		expect(log.requests.filter((request) => request.method === "captureRegion")).toHaveLength(1);
	});
});
