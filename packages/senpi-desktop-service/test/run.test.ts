import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerRunError } from "../src/run/context";
import { type ExecuteTool, runComputerCode } from "../src/run/runtime";
import { DesktopEngineRpcError } from "../src/service/rpc-client";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };
// Only the runtime's and the service's timers are faked; child-process I/O and the vm resume
// (`setImmediate`) keep running on the real loop.
const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
	toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
};
const RUN_TIMEOUT_MS = 5_000;

const services: DesktopService[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(services.splice(0).map((service) => service.close()));
});

async function openDesktop(
	env: Readonly<Record<string, string>> = {},
): Promise<{ service: DesktopService; log: SpawnLog }> {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	return { service, log };
}

interface RunOptions {
	readonly readOnly?: boolean;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly executeTool?: ExecuteTool;
}

function snapshot(readOnly: boolean): ComputerSessionSnapshot {
	return {
		cwd: "/work",
		sessionId: "session-1",
		captureMaxWidth: 1280,
		captureMaxHeight: 800,
		captureMaxBytes: 5_000_000,
		display: "all",
		readOnly,
		stopHotkey: "ctrl+alt+shift+escape",
		allowHostRelayOnlyStop: false,
	};
}

const noTools: ExecuteTool = (name) => Promise.reject(new Error(`unexpected tool ${name}`));

function run(service: DesktopService, code: string, options: RunOptions = {}) {
	return runComputerCode(
		{
			code,
			snapshot: snapshot(options.readOnly ?? false),
			timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		{ service, executeTool: options.executeTool ?? noTools },
	);
}

function methods(log: SpawnLog): readonly string[] {
	return log.requests.map((request) => request.method);
}

describe("runComputerCode", HANG_GUARD, () => {
	it("settles a run that returns without awaiting any host call", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const results = await Promise.all(
			[
				"return 42;",
				"if (true) return { early: true }; await desktop.windows();",
				"await Promise.resolve(); return 'x';",
			].map((code) => run(service, code, { timeoutMs: 5_000 })),
		);

		// Then
		expect(results.map((result) => result.returnValue)).toEqual([42, { early: true }, "x"]);
	});

	it("returns the code's value and displays the inline capture before later console output", async () => {
		// Given
		const { service } = await openDesktop();
		const code = `
			const shot = await desktop.screenshot();
			const editor = await desktop.window({ app: "code" });
			console.log("found", editor.title);
			return { width: shot.width, frameId: shot.frameId, window: editor.id };
		`;

		// When
		const result = await run(service, code);

		// Then
		expect(result.returnValue).toEqual({ width: 1280, frameId: "desktop-1", window: "101" });
		expect(result.displays.map((display) => display.type)).toEqual(["text", "image", "text"]);
		expect(result.displays[1]).toEqual({ type: "image", data: expect.any(String), mimeType: "image/png" });
		expect(result.displays[2]).toEqual({ type: "text", text: "found main.ts" });
	});

	it("shows an artifact-only capture as text with its path and records the artifact", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const result = await run(service, `return (await (await desktop.window("202")).screenshot()).path;`);

		// Then
		const path = "/tmp/fake-captures/202-1.png";
		expect(result.returnValue).toBe(path);
		expect(result.displays.every((display) => display.type === "text")).toBe(true);
		expect(result.displays.some((display) => display.type === "text" && display.text.includes(path))).toBe(true);
		expect(result.screenshots).toEqual([
			{ path, width: 900, height: 700, sourceWidth: 900, sourceHeight: 700, target: "202" },
		]);
	});

	it("rejects with the error of code that throws before its first await, leaving nothing unhandled", async () => {
		// Given: the vm rejects its evaluation promise while its own microtasks drain, before the host has
		// attached a handler; that used to surface as an unhandled rejection in the host (Vitest fails the
		// run on one, so this test guards that too)
		const { service } = await openDesktop();

		// When
		const error = await rejectionOf(run(service, `throw new Error("thrown before any await");`));

		// Then
		expect(error).toMatchObject({ message: "thrown before any await" });
	});

	it("rejects click in a read-only run before it reaches the engine", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const error = await rejectionOf(run(service, "await desktop.click(1, 1)", { readOnly: true }));

		// Then
		expect(error).toBeInstanceOf(ComputerRunError);
		expect(error).toHaveProperty("reason", "readOnly");
		expect(error).toHaveProperty("message", "read-only run: 'click' requires read_only: false");
		expect(methods(log)).not.toContain("click");
	});

	it("allows screenshot in a read-only run", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const result = await run(service, "return (await desktop.screenshot({ silent: true })).frameId;", {
			readOnly: true,
		});

		// Then
		expect(result.returnValue).toBe("desktop-1");
		expect(methods(log)).toContain("capture");
	});

	it("surfaces the engine's InvalidCoordinateFrame when input precedes the target's first capture", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const error = await rejectionOf(run(service, "await desktop.click(5, 5)"));

		// Then
		expect(error).toBeInstanceOf(DesktopEngineRpcError);
		expect(error).toHaveProperty("rpcCode", -32007);
		expect(error).toHaveProperty("data.code", "InvalidCoordinateFrame");
	});

	it("drives a window handle by its id and reports the engine's audit events for the run", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			await editor.screenshot({ silent: true });
			await editor.click(3, 4, { delivery: "foreground" });
		`;

		// When
		const result = await run(service, code);

		// Then
		const click = log.requests.find((request) => request.method === "click");
		expect(click?.params).toEqual({ target: "101", x: 3, y: 4, opts: { deliveryMode: "foreground" } });
		expect(result.audit).toEqual([
			expect.objectContaining({ sessionId: "session-1", action: "click", target: "101", status: "success" }),
		]);
	});

	it("reaches the host executeTool from tool.<name> inside the run", async () => {
		// Given
		const { service } = await openDesktop();
		const executeTool = vi.fn<ExecuteTool>(async () => ({ content: [{ type: "text", text: "file body" }] }));

		// When
		const result = await run(service, `return (await tool.read({ path: "notes.txt" })).content[0].text;`, {
			executeTool,
		});

		// Then
		expect(result.returnValue).toBe("file body");
		expect(executeTool).toHaveBeenCalledExactlyOnceWith(
			"read",
			{ path: "notes.txt" },
			{ signal: expect.any(AbortSignal) },
		);
	});

	it("rejects an aborted run and sends $/cancel for its in-flight engine call", async () => {
		// Given
		const { service, log } = await openDesktop({ FAKE_ENGINE_STALL: "windows" });
		const abort = new AbortController();
		const running = rejectionOf(run(service, "await desktop.windows()", { signal: abort.signal }));
		const sent = await log.nthRequest("windows", 1);

		// When
		abort.abort();
		const error = await running;

		// Then
		expect(error).toHaveProperty("reason", "aborted");
		expect((await log.nthRequest("$/cancel", 1)).params).toEqual({ id: sent.id });
	});

	it("times out a run that loops forever at timeoutMs and cancels its in-flight engine call", async () => {
		// Given
		vi.useFakeTimers(TIMERS);
		const { service, log } = await openDesktop({ FAKE_ENGINE_STALL: "windows" });
		let settled = false;
		const running = rejectionOf(
			run(service, "for (;;) { await desktop.displays(); await desktop.windows(); }").finally(() => {
				settled = true;
			}),
		);
		const sent = await log.nthRequest("windows", 1);

		// When
		await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);

		// Then: settled at timeoutMs, before the service's cancel grace could have elapsed
		expect(settled).toBe(true);
		expect(await running).toHaveProperty("reason", "timeout");
		expect((await log.nthRequest("$/cancel", 1)).params).toEqual({ id: sent.id });
	});

	it.each([
		["the first synchronous stretch", "while (true) {}"],
		["a stretch after an await", "await desktop.displays(); while (true) {}"],
	])("times out a synchronous infinite loop in %s", async (_stretch, code) => {
		// Given
		const { service } = await openDesktop();

		// When
		const error = await rejectionOf(run(service, code, { timeoutMs: 200 }));

		// Then
		expect(error).toBeInstanceOf(ComputerRunError);
		expect(error).toHaveProperty("reason", "timeout");
	});
});
