import { afterEach, describe, expect, it } from "vitest";
import { runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory } from "./harness";

const services: DesktopService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function open(env: Readonly<Record<string, string>> = {}, readOnly = false) {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	const run = (code: string) => runComputerCode({
		code,
		timeoutMs: 5_000,
		snapshot: {
			cwd: "/work", sessionId: "holds-test", captureMaxWidth: 3840,
			captureMaxHeight: 2400, captureMaxBytes: 5_000_000, display: "active",
			readOnly, stopHotkey: "ctrl+alt+shift+escape", allowHostRelayOnlyStop: false,
		},
	}, { service, executeTool: async () => undefined });
	return { log, run };
}

describe("bounded input hold facade", { timeout: 30_000 }, () => {
	it("routes duration, key order and button options on all target surfaces", async () => {
		// Given an engine supporting bounded holds.
		const { log, run } = await open();
		// When holds address the root, a window and a display.
		await run(`
			await desktop.holdKeys(["shift", "a"], { duration: 0 });
			const win = await desktop.window("101");
			await win.holdKeys(["ctrl", "b"], { duration: 100 });
			await win.screenshot({ silent: true });
			await win.holdMouse(10, 20, { duration: 0.5, button: "right", keys: ["shift"] });
			const display = await desktop.display("all");
			await display.screenshot({ silent: true });
			await display.holdMouse(30, 40, { duration: 0 });
		`);
		// Then no hold is translated to an ordinary chord or click.
		expect(log.requests.filter((request) => ["holdKeys", "holdMouse"].includes(request.method)))
			.toMatchObject([
				{ method: "holdKeys", params: { target: "desktop", keys: ["shift", "a"], duration: 0 } },
				{ method: "holdKeys", params: { target: "101", keys: ["ctrl", "b"], duration: 100 } },
				{ method: "holdMouse", params: {
					target: "101", x: 10, y: 20, duration: 0.5, button: "right", keys: ["shift"],
				} },
				{ method: "holdMouse", params: { target: "display:all", x: 30, y: 40, duration: 0 } },
			]);
		expect(log.requests.some((request) => ["click", "keyChord"].includes(request.method))).toBe(false);
	});

	it.each(["holdKeys", "holdMouse"])(
		"%s rejects invalid durations before sending native input", async (method) => {
			const { log, run } = await open();
			const args = method === "holdKeys" ? '["a"]' : "10, 20";
			for (const duration of [-1, 100.1, Number.NaN, Number.POSITIVE_INFINITY]) {
				const expression = Number.isNaN(duration) ? "NaN" : String(duration);
				await expect(run(`await desktop.${method}(${args}, { duration: ${expression} });`))
					.rejects.toMatchObject({ reason: "assertion" });
			}
			expect(log.requests.some((request) => request.method === method)).toBe(false);
		},
	);

	it("rejects an empty key list before calling the engine", async () => {
		const { log, run } = await open();
		await expect(run(`await desktop.holdKeys([], { duration: 0 });`))
			.rejects.toMatchObject({ reason: "assertion" });
		expect(log.requests.some((request) => request.method === "holdKeys")).toBe(false);
	});

	it.each(["holdKeys", "holdMouse"])("refuses %s in a read-only run before dispatch", async (method) => {
		const { log, run } = await open({}, true);
		const args = method === "holdKeys" ? '["a"], { duration: 0 }' : "10, 20, { duration: 0 }";
		await expect(run(`await desktop.${method}(${args});`))
			.rejects.toMatchObject({ reason: "readOnly" });
		expect(log.requests.some((request) => request.method === method)).toBe(false);
	});

	it("reports older-engine method-not-found and leaves ordinary input usable", async () => {
		// Given the same ABI but an engine predating bounded holds.
		const { log, run } = await open({ FAKE_ENGINE_PRE_HOLDS: "1" });
		// When each new method is called and refused.
		await expect(run(`await desktop.holdKeys(["a"], { duration: 0 });`))
			.rejects.toMatchObject({ reason: "unavailable" });
		await expect(run(`await desktop.holdMouse(10, 20, { duration: 0 });`))
			.rejects.toMatchObject({ reason: "unavailable" });
		await run(`await desktop.press("a"); await desktop.screenshot({ silent: true }); await desktop.click(10, 20);`);
		// Then no engine restart or fallback emission occurred.
		expect(log.children).toHaveLength(1);
		expect(log.kills()).toBe(0);
		expect(log.requests.filter((request) => request.method === "keyChord")).toHaveLength(1);
		expect(log.requests.filter((request) => request.method === "click")).toHaveLength(1);
	});
});
