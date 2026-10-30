import { afterEach, describe, expect, test } from "vitest";
import { type ConfirmControl, noTools, snapshot } from "./control-harness";
import { closeServices, openGated, type Preset, requested } from "./global-input-harness";
import { runComputerCode } from "../src/run/runtime";
import type { DesktopService } from "../src/service/service";

// Automatic foreground rerun for allowed sessions (D2, #11464 todo 24): a call the engine refuses
// BackgroundUnavailable with nothing sent (or ControlRequired at admission for raiseWindow) is rerun
// once in foreground, without a prompt, only when the session already allows foreground control.

afterEach(closeServices);

const GATE = { FAKE_ENGINE_BACKGROUND_GATE: "1", FAKE_ENGINE_BACKEND: "quartz" };

function runCode(service: DesktopService, code: string, options: { confirmControl?: ConfirmControl; headless?: boolean } = {}) {
	return runComputerCode(
		{ code, snapshot: snapshot(false), timeoutMs: 15_000 },
		{ service, executeTool: noTools, ...(options.confirmControl === undefined ? {} : { confirmControl: options.confirmControl }) },
	);
}

const TYPE = `{ const win = await desktop.window("101"); await win.type("hello"); }`;
const RAISE = `const win = await desktop.window("101"); await win.raise();`;
const CLICK_EXPLICIT = `const win = await desktop.window("101"); await win.screenshot(); await win.click(1, 1, { delivery: "background" });`;
const EL_TYPE = `const win = await desktop.window("101"); const [el] = await win.find({ role: "button" }); await el.type("x");`;

function texts(result: Awaited<ReturnType<typeof runComputerCode>>): string[] {
	return result.displays.filter((entry) => entry.type === "text").map((entry) => (entry as { text: string }).text);
}

describe("automatic foreground rerun (D2)", () => {
	test.each(["x11", "wayland", "windows"])("does not change %s fallback behavior", async (backend) => {
		const desktop = await openGated({ value: true }, { ...GATE, FAKE_ENGINE_BACKEND: backend });
		await expect(runCode(desktop.service, TYPE)).rejects.toMatchObject({ data: { code: "BackgroundUnavailable" } });
		expect(requested(desktop.log, "typeText")).toBe(1);
		expect(requested(desktop.log, "control.grant")).toBe(0);
	});

	test("a stopped session is not eligible for an automatic foreground rerun", async () => {
		const desktop = await openGated({ value: true }, GATE);
		expect(desktop.service.foregroundAllowed()).toBe(true);
		await desktop.service.stop();
		expect(desktop.service.foregroundAllowed()).toBe(false);
	});

	test("full access: one foreground rerun, no prompt, the run output says so", async () => {
		const preset: Preset = { value: true };
		const desktop = await openGated(preset, GATE);
		let confirms = 0;
		const confirm: ConfirmControl = async () => {
			confirms += 1;
			return true;
		};
		const result = await runCode(desktop.service, TYPE, { confirmControl: confirm });
		expect(confirms).toBe(0);
		expect(requested(desktop.log, "control.grant")).toBe(1);
		const sends = desktop.log.requests.filter((request) => request.method === "typeText");
		expect(sends.map((request) => (request.params as { opts?: { deliveryMode?: string } }).opts?.deliveryMode)).toEqual([undefined, "foreground"]);
		expect(texts(result).some((text) => text.startsWith("ran in foreground:"))).toBe(true);
	});

	test("a live human grant: one rerun, no control.grant sent, and the grant survives the next call", async () => {
		const preset: Preset = { value: false };
		const desktop = await openGated(preset, GATE);
		const confirm: ConfirmControl = async () => true;
		await runCode(desktop.service, `await desktop.control.acquire({ reason: "test" }); ${TYPE} ${TYPE}`, { confirmControl: confirm });
		expect(requested(desktop.log, "control.grant")).toBe(1);
		expect(requested(desktop.log, "control.revoke")).toBe(0);
		expect(requested(desktop.log, "typeText")).toBe(4);
	});

	test("headless full access: one rerun, no prompt", async () => {
		const desktop = await openGated({ value: true }, GATE);
		const result = await runCode(desktop.service, TYPE);
		expect(requested(desktop.log, "typeText")).toBe(2);
		expect(texts(result).some((text) => text.startsWith("ran in foreground:"))).toBe(true);
	});

	test("no full access and no grant: BackgroundUnavailable, no prompt, no rerun", async () => {
		const desktop = await openGated({ value: false }, GATE);
		let confirms = 0;
		const confirm: ConfirmControl = async () => {
			confirms += 1;
			return true;
		};
		await expect(runCode(desktop.service, TYPE, { confirmControl: confirm })).rejects.toMatchObject({ data: { code: "BackgroundUnavailable" } });
		expect(confirms).toBe(0);
		expect(requested(desktop.log, "typeText")).toBe(1);
		expect(requested(desktop.log, "control.grant")).toBe(0);
	});

	test("InputFailed is never rerun", async () => {
		const desktop = await openGated({ value: true }, { FAKE_ENGINE_INPUT_ERROR: "InputFailed" });
		await expect(runCode(desktop.service, TYPE)).rejects.toMatchObject({ data: { code: "InputFailed" } });
		expect(requested(desktop.log, "typeText")).toBe(1);
	});

	test("an explicit delivery is never rerun", async () => {
		const desktop = await openGated({ value: true }, GATE);
		await expect(runCode(desktop.service, CLICK_EXPLICIT)).rejects.toMatchObject({ data: { code: "BackgroundUnavailable" } });
		expect(requested(desktop.log, "click")).toBe(1);
	});

	test("raiseWindow refused ControlRequired reruns unchanged in full access (trigger ii)", async () => {
		const desktop = await openGated({ value: true }, GATE);
		const result = await runCode(desktop.service, RAISE);
		expect(requested(desktop.log, "raiseWindow")).toBe(2);
		expect(requested(desktop.log, "control.grant")).toBe(1);
		expect(texts(result).some((text) => text.startsWith("ran in foreground:"))).toBe(true);
	});

	test("element input reruns in foreground too; a second refusal is not rerun again", async () => {
		const desktop = await openGated({ value: true }, GATE);
		await runCode(desktop.service, EL_TYPE);
		const sends = desktop.log.requests.filter((request) => request.method === "ax.typeText");
		expect(sends.map((request) => (request.params as { opts?: { deliveryMode?: string } }).opts?.deliveryMode)).toEqual([undefined, "foreground"]);
	});

	test("a rerun whose own refusal is final is not rerun again and adds no line", async () => {
		// FAKE_ENGINE_CONTROL_BUSY: the automatic grant is refused InputBusy, so the rerun never goes out
		const desktop = await openGated({ value: true }, { ...GATE, FAKE_ENGINE_CONTROL_BUSY: "1" });
		await expect(runCode(desktop.service, TYPE)).rejects.toMatchObject({ data: { code: "InputBusy" } });
		expect(requested(desktop.log, "typeText")).toBe(1);
		expect(requested(desktop.log, "control.grant")).toBe(1);
	});

	test("full access ending between the decision and the grant returns the engine's own refusal", async () => {
		const preset: Preset = { value: true };
		const desktop = await openGated(preset, GATE);
		// The decision has read foregroundAllowed() = true; full access ends right before the grant is written
		const service = desktop.service;
		const host = {
			call: service.call.bind(service),
			onAudit: service.onAudit.bind(service),
			revokeControl: service.revokeControl.bind(service),
			reportError: service.reportError.bind(service),
			foregroundAllowed: () => service.foregroundAllowed(),
			possiblyLive: () => service.possiblyLive(),
			grantForFullAccess: (signal: AbortSignal) => {
				preset.value = false;
				return service.grantForFullAccess(signal);
			},
		};
		const result = runComputerCode({ code: TYPE, snapshot: snapshot(false), timeoutMs: 15_000 }, { service: host, executeTool: noTools });
		await expect(result).rejects.toMatchObject({ data: { code: "BackgroundUnavailable" } });
		expect(requested(desktop.log, "control.grant")).toBe(0);
		expect(requested(desktop.log, "typeText")).toBe(1);
	});

	test("after full access ends the automatic grant is fenced and nothing reruns", async () => {
		const preset: Preset = { value: true };
		const desktop = await openGated(preset, GATE);
		await runCode(desktop.service, TYPE);
		preset.value = false;
		await expect(runCode(desktop.service, TYPE)).rejects.toMatchObject({ data: { code: "BackgroundUnavailable" } });
		expect(requested(desktop.log, "control.revoke")).toBeGreaterThanOrEqual(1);
		expect(requested(desktop.log, "typeText")).toBe(3);
	});
});
