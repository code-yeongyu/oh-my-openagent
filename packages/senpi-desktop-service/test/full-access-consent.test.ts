import { afterEach, describe, expect, it } from "vitest";
import { admitted, closeServices, openGated, requested, runCode } from "./global-input-harness";
import { exitOf, rejectionOf } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };
const CLICK = { target: "desktop", x: 10, y: 10, opts: {} };
const CHORD = "ctrl+alt+shift+escape";

afterEach(closeServices);

describe("full access as the consent for desktop input (#10788)", HANG_GUARD, () => {
	it("re-grants once after a stop the user resumed, and the input is admitted exactly once", async () => {
		// Given: the engine dropped the full-access grant at the stop
		const desktop = await openGated({ value: true });
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);
		await desktop.service.stop();
		await desktop.service.resume();

		// When
		await runCode(desktop.service, `await desktop.click(10, 10);`);

		// Then: one refused attempt, one re-grant, one admitted retry
		expect(requested(desktop.log, "control.grant")).toBe(2);
		expect(admitted(desktop, "click")).toBe(2);
		expect(desktop.audits.filter((event) => event.code === "ControlRequired")).toHaveLength(1);
	});

	it("never grants while the user's stop is latched, and never resumes", async () => {
		// Given: a chord is armed, as every host arms one before input
		const desktop = await openGated({ value: true });
		await desktop.service.ensureStopPath(CHORD);
		await desktop.service.stop();

		// When
		const error = await rejectionOf(runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`));

		// Then
		expect(error).toMatchObject({ data: { code: "Suspended" } });
		expect(admitted(desktop, "click")).toBe(0);
		expect(requested(desktop.log, "stopPath.resume")).toBe(0);
	});

	it("does not retry when a stop lands between the grant and the input", async () => {
		// Given: granted, then the user stops
		const desktop = await openGated({ value: true });
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);
		await desktop.service.stop();

		// When
		const error = await rejectionOf(desktop.service.call("click", CLICK));

		// Then: Suspended is final, nothing re-granted
		expect(error).toMatchObject({ data: { code: "Suspended" } });
		expect(requested(desktop.log, "control.grant")).toBe(1);
		expect(admitted(desktop, "click")).toBe(1);
	});

	it("keeps the stop latched across an engine restart, so full access cannot grant", async () => {
		// Given: a chord is armed, then the user stops, then the engine child dies. The armed chord makes the
		// new child answer stopPath.start unsuspended, which is what used to erase the remembered stop.
		const desktop = await openGated({ value: true });
		await desktop.service.ensureStopPath(CHORD);
		await desktop.service.stop();
		const [first] = desktop.log.children;
		first?.kill();
		await exitOf(first);

		// When: the next call starts a fresh child
		const error = await rejectionOf(desktop.service.call("click", CLICK));

		// Then: the stop was replayed onto the new child before any grant or input
		const restarted = desktop.log.requests.filter((request) => request.child === 1).map((request) => request.method);
		expect(restarted).toContain("stopPath.stop");
		expect(error).toMatchObject({ data: { code: "Suspended" } });
		expect(admitted(desktop, "click")).toBe(0);
	});

	it("revokes a full-access grant once the session leaves full access, before acquire can reuse it", async () => {
		// Given
		const preset = { value: true };
		const desktop = await openGated(preset);
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);

		// When: the preset is switched down within the same turn
		preset.value = false;
		let asked = 0;
		const state = await runCode(desktop.service, `return await desktop.control.acquire({ reason: "again" });`, () => {
			asked += 1;
			return Promise.resolve(false);
		});

		// Then: the automatic grant is gone and the human is asked
		expect(requested(desktop.log, "control.revoke")).toBe(1);
		expect(asked).toBe(1);
		expect(state.returnValue).toEqual({ active: false });
	});

	it("reads consent and sends in one step: full access ending after the caller's check still revokes first", async () => {
		// Given: a live full-access grant, and a preset that answers full access exactly once more, then not
		let reads = Number.POSITIVE_INFINITY;
		const preset = {
			get value() {
				reads -= 1;
				return reads >= 0;
			},
		};
		const desktop = await openGated(preset);
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);
		reads = 1;

		// When: the caller's fence still sees full access, the send does not
		const error = await rejectionOf(desktop.service.call("click", CLICK));

		// Then: the full-access grant was revoked before the click, which the engine refused
		expect(error).toMatchObject({ data: { code: "ControlRequired" } });
		expect(requested(desktop.log, "control.revoke")).toBe(1);
		expect(admitted(desktop, "click")).toBe(1);
	});

	it("does not re-grant when the request was cancelled by the time the engine refused", async () => {
		// Given: the engine's grant was dropped by a resumed stop
		const desktop = await openGated({ value: true });
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);
		await desktop.service.stop();
		await desktop.service.resume();
		const controller = new AbortController();
		desktop.service.onAudit((event) => {
			if (event.code === "ControlRequired") controller.abort();
		});

		// When
		await rejectionOf(desktop.service.call("click", CLICK, { signal: controller.signal }));

		// Then
		expect(requested(desktop.log, "control.grant")).toBe(1);
		expect(admitted(desktop, "click")).toBe(1);
	});

	it("never retries a native input failure", async () => {
		// Given
		const desktop = await openGated({ value: true }, { FAKE_ENGINE_INPUT_ERROR: "ScreenLocked" });

		// When
		const error = await rejectionOf(runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`));

		// Then
		expect(error).toMatchObject({ data: { code: "ScreenLocked" } });
		expect(requested(desktop.log, "click")).toBe(1);
		expect(requested(desktop.log, "control.grant")).toBe(1);
	});
});
