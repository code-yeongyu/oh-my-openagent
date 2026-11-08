import {
	type ComputerSessionSnapshot,
	DESKTOP_METHODS,
	DISPLAY_METHODS,
	ELEMENT_METHODS,
	WINDOW_METHODS,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerRunError } from "../src/run/context";
import { type ComputerRunSandbox, type ExecuteTool, runComputerCode } from "../src/run/runtime";
import { SANDBOX_RESULT_BYTES } from "../src/run/sandbox/limits";
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

// Every body runs under both sandboxes, except the vm-only ones of the threat model's compatibility matrix
// (docs/reference/computer-run-sandbox-threat-model.md section 7).
const SANDBOXES: readonly ComputerRunSandbox[] = ["vm", "quickjs"];

interface RunOptions {
	readonly sandbox?: ComputerRunSandbox;
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

function runCode(service: DesktopService, code: string, options: RunOptions = {}) {
	return runComputerCode(
		{
			code,
			sandbox: options.sandbox ?? "vm",
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

describe.each(SANDBOXES)("runComputerCode under %s", (sandbox) => {
	const run = (service: DesktopService, code: string, options: RunOptions = {}) =>
		runCode(service, code, { ...options, sandbox });

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

	it("types into an element through ax.typeText and returns how the text was delivered", async () => {
		// Given
		const { service, log } = await openDesktop();

		// When
		const result = await run(
			service,
			`const el = await desktop.ref("e1"); return [await el.type("hello"), await el.type("x", { delivery: "foreground" })];`,
		);

		// Then
		expect(result.returnValue).toEqual([{ method: "inserted" }, { method: "inserted" }]);
		const typed = log.requests.filter((request) => request.method === "ax.typeText").map((request) => request.params);
		expect(typed).toEqual([
			{ ref: "e1", text: "hello", opts: {} },
			{ ref: "e1", text: "x", opts: { deliveryMode: "foreground" } },
		]);
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

	it("resolves a call whose result is undefined as undefined in the body", async () => {
		// Given
		const { service } = await openDesktop();
		const code = `
			const value = await (await desktop.ref("e1")).value();
			await desktop.screenshot({ silent: true });
			const clicked = await desktop.click(1, 1);
			return [value === undefined, clicked === undefined];
		`;

		// When
		const result = await run(service, code);

		// Then
		expect(result.returnValue).toEqual([true, true]);
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

	it("rejects menu.select in a read-only run before it reaches the engine", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			await editor.menu.select(["File", "Save"]);
		`;

		// When
		const error = await rejectionOf(run(service, code, { readOnly: true }));

		// Then
		expect(error).toBeInstanceOf(ComputerRunError);
		expect(error).toHaveProperty("reason", "readOnly");
		expect(error).toHaveProperty("message", "read-only run: 'menu.select' requires read_only: false");
		expect(methods(log)).not.toContain("menus.select");
	});

	it("allows menu.items in a read-only run and returns the menu tree", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			return {
				root: (await editor.menu.items()).map((item) => item.title),
				file: (await editor.menu.items(["File"])).map((item) => item.title),
			};
		`;

		// When
		const result = await run(service, code, { readOnly: true });

		// Then
		expect(result.returnValue).toEqual({ root: ["File", "Edit", "View"], file: ["Save", "Export…"] });
		expect(methods(log)).toContain("menus.items");
		expect(methods(log)).not.toContain("menus.select");
	});

	it("forwards the window id and the full menu path to the engine", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			await editor.menu.items(["File"]);
			await editor.menu.select(["File", "Export…", "PDF"]);
		`;

		// When
		await run(service, code);

		// Then
		const items = log.requests.find((request) => request.method === "menus.items");
		expect(items?.params).toEqual({ windowId: "101", path: ["File"] });
		const select = log.requests.find((request) => request.method === "menus.select");
		expect(select?.params).toEqual({ windowId: "101", path: ["File", "Export…", "PDF"] });
	});

	it("forwards an explicit menu.select delivery as deliveryMode and omits it otherwise (#9888)", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const editor = await desktop.window({ app: "Code" });
			await editor.menu.select(["File", "Save"]);
			await editor.menu.select(["File", "Save"], { delivery: "foreground" });
		`;

		// When
		await run(service, code);

		// Then
		const selects = log.requests.filter((request) => request.method === "menus.select").map((request) => request.params);
		expect(selects[0]).toEqual({ windowId: "101", path: ["File", "Save"] });
		expect(selects[1]).toEqual({ windowId: "101", path: ["File", "Save"], deliveryMode: "foreground" });
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

// Compatibility matrix M1: `tool` stays vm-only; under quickjs the same body throws ReferenceError.
describe("runComputerCode vm-only bodies", HANG_GUARD, () => {
	it("reaches the host executeTool from tool.<name> inside the run", async () => {
		// Given
		const { service } = await openDesktop();
		const executeTool = vi.fn<ExecuteTool>(async () => ({ content: [{ type: "text", text: "file body" }] }));

		// When
		const result = await runCode(service, `return (await tool.read({ path: "notes.txt" })).content[0].text;`, {
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

	it("throws ReferenceError for the same tool.<name> body under quickjs and never reaches executeTool", async () => {
		// Given
		const { service } = await openDesktop();
		const executeTool = vi.fn<ExecuteTool>(async () => ({ content: [{ type: "text", text: "file body" }] }));

		// When
		const error = await rejectionOf(
			runCode(service, `return (await tool.read({ path: "notes.txt" })).content[0].text;`, {
				sandbox: "quickjs",
				executeTool,
			}),
		);

		// Then
		expect(error).toBeInstanceOf(ReferenceError);
		expect(error).toHaveProperty("message", "tool is not defined");
		expect(executeTool).not.toHaveBeenCalled();
	});
});

describe("the computer bridge in the QuickJS run cell", HANG_GUARD, () => {
	const quickjs = (service: DesktopService, code: string, options: RunOptions = {}) =>
		runCode(service, code, { ...options, sandbox: "quickjs" });

	it("bridges computer as the same object as desktop and returns a window screenshot's width", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const result = await quickjs(
			service,
			`const w = await computer.window({ app: "Code" }); return [computer === desktop, (await w.screenshot()).width];`,
		);

		// Then
		expect(result.returnValue).toEqual([true, 1200]);
		expect(result.sandbox).toBe("quickjs");
	});

	it("generates the stubs from all four method tables, dotted names as nested namespaces", async () => {
		// Given
		const { service } = await openDesktop();
		const code = `
			const names = (node, prefix = "") => Object.keys(node).flatMap((key) =>
				typeof node[key] === "function" ? [prefix + key] :
				node[key] !== null && typeof node[key] === "object" ? names(node[key], prefix + key + ".") : []);
			const w = await computer.window({ app: "Code" });
			const el = await computer.ref("e1");
			const d = await computer.display("all");
			return { desktop: names(computer), window: names(w), element: names(el), display: names(d) };
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		const sorted = (keys: readonly string[]) => [...keys].sort();
		const value = result.returnValue as Record<string, string[]>;
		expect({
			desktop: sorted(value.desktop ?? []),
			window: sorted(value.window ?? []),
			element: sorted(value.element ?? []),
			display: sorted(value.display ?? []),
		}).toEqual({
			desktop: sorted(Object.keys(DESKTOP_METHODS)),
			window: sorted(Object.keys(WINDOW_METHODS)),
			element: sorted(Object.keys(ELEMENT_METHODS)),
			display: sorted(Object.keys(DISPLAY_METHODS)),
		});
	});

	it("screenshots desktop.display('all') and sends display input with the display target", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const all = await desktop.display("all");
			const width = (await all.screenshot({ silent: true })).width;
			const one = await desktop.display("1");
			await one.screenshot({ silent: true });
			await one.click(20, 10);
			return [all.id, width];
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		expect(result.returnValue).toEqual(["all", 1280]);
		const click = log.requests.find((request) => request.method === "click");
		expect(click?.params).toMatchObject({ target: "display:1", x: 20, y: 10 });
	});

	it("reads window and element snapshot fields without another engine call", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const w = await desktop.window({ app: "Code" });
			const el = await desktop.ref("e1");
			return [w.id, w.title, w.app, w.pid, w.bounds, w.focused, el.ref, el.role, el.title, el.enabled];
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		expect(result.returnValue).toEqual([
			"101",
			"main.ts",
			"Code",
			42,
			{ x: 0, y: 25, width: 1200, height: 800 },
			true,
			"e1",
			"button",
			"Run",
			true,
		]);
		expect(methods(log).filter((method) => method === "windows" || method.startsWith("ax."))).toEqual([
			"windows",
			"ax.node",
		]);
	});

	it("passes arguments as data: a __proto__ key reaches the engine as an own key and leaves host Object.prototype alone", async () => {
		// Given
		const { service, log } = await openDesktop();
		const code = `
			const w = await desktop.window({ app: "Code" });
			return await w.ax(JSON.parse('{"__proto__": {"polluted": true}, "maxDepth": 2}'));
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		expect(result.returnValue).toBe("button Run [ref=e1]");
		expect(Object.prototype).not.toHaveProperty("polluted");
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		const opts = (log.requests.find((request) => request.method === "ax.snapshot")?.params as { opts: object }).opts;
		expect(Object.hasOwn(opts, "__proto__")).toBe(true);
		expect(opts).toHaveProperty("maxDepth", 2);
	});

	it("rejects an over-cap result with resultSize inside the body, which recovers and keeps calling", async () => {
		// Given
		const { service } = await openDesktop({ FAKE_ENGINE_CLIPBOARD_BYTES: String(SANDBOX_RESULT_BYTES + 1) });
		const code = `
			let refused;
			try { await computer.clipboard.read(); } catch (error) { refused = [error.name, error.reason]; }
			return [refused, (await computer.windows()).length];
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		expect(result.returnValue).toEqual([["ComputerRunError", "resultSize"], 2]);
	});

	it("lets the body catch an engine error with its data, and an escaped one is the host's own error", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const caught = await quickjs(
			service,
			`try { await desktop.click(5, 5); } catch (error) { return [error.name, error.rpcCode, error.data.code]; }`,
		);
		const escaped = await rejectionOf(quickjs(service, `try { await desktop.click(5, 5); } catch (error) { throw error; }`));

		// Then
		expect(caught.returnValue).toEqual(["DesktopEngineRpcError", -32007, "InvalidCoordinateFrame"]);
		expect(escaped).toBeInstanceOf(DesktopEngineRpcError);
	});

	it("drops an undefined snapshot field as JSON does and refuses a non-JSON argument before any engine request", async () => {
		// Given: the fake button has no description, so its handle's snapshot field is undefined
		const { service, log } = await openDesktop();
		const code = `
			const el = await computer.ref("e1");
			let refused;
			try { await computer.windows(() => true); } catch (error) { refused = error.name; }
			try { await computer.click(Number.NaN, 1); } catch (error) { refused += " " + error.name; }
			return [Object.hasOwn(el, "description"), el.description === undefined, refused];
		`;

		// When
		const result = await quickjs(service, code);

		// Then
		expect(result.returnValue).toEqual([false, true, "TypeError TypeError"]);
		expect(methods(log)).not.toContain("windows");
		expect(methods(log)).not.toContain("click");
	});

	it("keeps the call limit across bridged calls and leaves tool and wait absent", async () => {
		// Given
		const { service } = await openDesktop();

		// When
		const absent = await quickjs(service, "return [typeof tool, typeof wait, typeof computer.clipboard.read];");
		const flood = await rejectionOf(quickjs(service, "for (;;) await computer.capabilities();"));

		// Then
		expect(absent.returnValue).toEqual(["undefined", "undefined", "function"]);
		expect(flood).toBeInstanceOf(ComputerRunError);
		expect(flood).toHaveProperty("reason", "calls");
	});
});
