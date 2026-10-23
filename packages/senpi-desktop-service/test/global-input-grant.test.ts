import { afterEach, describe, expect, it } from "vitest";
import { admitted, closeServices, openGated, requested, runCode } from "./global-input-harness";
import { rejectionOf } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

afterEach(closeServices);

describe("global input needs the control grant outside full access (#10788)", HANG_GUARD, () => {
	it("a desktop click without a grant gets the engine's audited refusal and no input", async () => {
		// Given
		const desktop = await openGated({ value: false });

		// When
		const error = await rejectionOf(runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`));

		// Then
		expect(error).toMatchObject({ data: { code: "ControlRequired" } });
		expect(admitted(desktop, "click")).toBe(0);
		expect(desktop.audits.map((event) => event.code)).toContain("ControlRequired");
		expect(requested(desktop.log, "control.grant")).toBe(0);
	});

	it("typing on a display target without a grant is refused too", async () => {
		// Given
		const desktop = await openGated({ value: false });

		// When
		const error = await rejectionOf(runCode(desktop.service, `await (await desktop.display("1")).type("hi");`));

		// Then
		expect(error).toMatchObject({ data: { code: "ControlRequired" } });
		expect(requested(desktop.log, "control.grant")).toBe(0);
	});

	it("still sends background input to one window without a grant", async () => {
		// Given
		const desktop = await openGated({ value: false });

		// When
		await runCode(desktop.service, `const w = await desktop.window("101"); await w.screenshot(); await w.click(5, 5);`);

		// Then
		expect(admitted(desktop, "click")).toBe(1);
		expect(requested(desktop.log, "control.grant")).toBe(0);
	});

	it("admits the desktop click once the human approved the grant", async () => {
		// Given
		const desktop = await openGated({ value: false });

		// When
		await runCode(
			desktop.service,
			`await desktop.control.acquire({ reason: "click Run" }); await desktop.screenshot(); await desktop.click(10, 10);`,
			() => Promise.resolve(true),
		);

		// Then
		expect(admitted(desktop, "click")).toBe(1);
	});

	it("grants without asking in full access, headless included, before the click", async () => {
		// Given: no confirm channel at all, as in a headless run
		const desktop = await openGated({ value: true });

		// When
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);

		// Then
		const methods = desktop.log.requests.map((request) => request.method);
		expect(methods.indexOf("control.grant")).toBeGreaterThan(-1);
		expect(methods.indexOf("control.grant")).toBeLessThan(methods.indexOf("click"));
		expect(admitted(desktop, "click")).toBe(1);
	});

	it("keeps a human-confirmed grant when the session is not in full access", async () => {
		// Given
		const desktop = await openGated({ value: false });
		await runCode(desktop.service, `await desktop.control.acquire({ reason: "click Run" });`, () => Promise.resolve(true));

		// When: a later run in the same turn
		await runCode(desktop.service, `await desktop.screenshot(); await desktop.click(10, 10);`);

		// Then
		expect(admitted(desktop, "click")).toBe(1);
		expect(requested(desktop.log, "control.revoke")).toBe(0);
	});
});
