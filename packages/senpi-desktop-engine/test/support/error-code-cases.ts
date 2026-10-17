import { readFileSync } from "node:fs";
import path from "node:path";
import { capture, type EngineProcess, type Message, makeStopPathLive, REPO_ROOT, snapshotRef } from "./engine";

/** The fake scenario's only window. */
export const WINDOW = "101";

const ERROR_RS = path.join(REPO_ROOT, "crates", "senpi-desktop-core", "src", "error.rs");

/** The variants of `enum ErrorCode` in `senpi-desktop-core/src/error.rs`, in declaration order. */
export function declaredErrorCodes(): readonly string[] {
	const body = readFileSync(ERROR_RS, "utf8").split("pub enum ErrorCode {")[1]?.split("}")[0];
	if (body === undefined) throw new Error(`${ERROR_RS} declares no enum ErrorCode`);
	return body
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#"))
		.map((line) => line.replace(/,$/, ""));
}

/**
 * Every pointer, keyboard, window, and AX input method with parseable params. `clipboard.write` is absent:
 * the engine answers it `Internal` until the clipboard lands with the backends.
 */
export const INPUT_CALLS: ReadonlyArray<readonly [string, Message]> = [
	["click", { target: "desktop", x: 10, y: 10 }],
	["moveMouse", { target: "desktop", x: 10, y: 10 }],
	[
		"drag",
		{
			target: "desktop",
			path: [
				{ x: 1, y: 1 },
				{ x: 5, y: 5 },
			],
		},
	],
	["scroll", { target: "desktop", x: 10, y: 10, dx: 0, dy: 3 }],
	["typeText", { target: WINDOW, text: "hi" }],
	["keyChord", { target: WINDOW, keys: ["ctrl", "a"] }],
	["raiseWindow", { windowId: WINDOW }],
	["ax.perform", { ref: "e1", action: "press" }],
	["ax.setValue", { ref: "e1", value: "hi" }],
	["ax.focus", { ref: "e1" }],
	["ax.click", { ref: "e1" }],
];

export interface ErrorCodeCase {
	readonly code: string;
	/** Top-level keys replacing the two-display scenario's. */
	readonly overlay: Message;
	readonly env?: Readonly<Record<string, string>>;
	/** Resolves the reply that must carry `code`. */
	readonly drive: (engine: EngineProcess) => Promise<Message>;
}

const click = (engine: EngineProcess, target: string) => engine.call("click", { target, x: 10, y: 10 });
const open = (engine: EngineProcess) => engine.call("session.open", {});
const failNext = (method: string): Message => ({ fail_next: [{ method, code: "InputFailed" }] });

/** A foreground click on the window, which captures and restores focus and cursor. */
async function foregroundClick(engine: EngineProcess): Promise<Message> {
	await makeStopPathLive(engine);
	await capture(engine, WINDOW);
	await engine.call("control.grant", { reason: "restore failure cases", confirmationId: "confirm-1" });
	return engine.call("click", { target: WINDOW, x: 10, y: 10, opts: { deliveryMode: "foreground" } });
}

/** A foreground click with no control grant: `ControlRequired`. */
async function ungrantedForegroundClick(engine: EngineProcess): Promise<Message> {
	await makeStopPathLive(engine);
	await capture(engine, WINDOW);
	return engine.call("click", { target: WINDOW, x: 10, y: 10, opts: { deliveryMode: "foreground" } });
}

export const ERROR_CODE_CASES: readonly ErrorCodeCase[] = [
	{
		code: "PermissionDenied",
		overlay: { capabilities: { inputPermission: "denied" } },
		drive: async (engine) => {
			await makeStopPathLive(engine);
			return click(engine, "desktop");
		},
	},
	{
		code: "CaptureFailed",
		overlay: { capabilities: { capture: false } },
		drive: async (engine) => {
			await open(engine);
			return engine.call("capture", { target: "desktop" });
		},
	},
	{
		code: "InputFailed",
		overlay: { capabilities: { input: false } },
		drive: async (engine) => {
			await makeStopPathLive(engine);
			await capture(engine, WINDOW);
			return click(engine, WINDOW);
		},
	},
	{
		code: "BackgroundUnavailable",
		overlay: { capabilities: { backgroundWindowInput: false } },
		drive: async (engine) => {
			await makeStopPathLive(engine);
			await capture(engine, WINDOW);
			return click(engine, WINDOW);
		},
	},
	{
		code: "WindowNotFound",
		overlay: {},
		drive: async (engine) => {
			await open(engine);
			return engine.call("capture", { target: "999" });
		},
	},
	{
		code: "InvalidTarget",
		overlay: {},
		drive: async (engine) => {
			await open(engine);
			return engine.call("capture", { target: "desktop", caps: { maxWidth: 0 } });
		},
	},
	{
		code: "InvalidKey",
		overlay: {},
		drive: async (engine) => {
			await makeStopPathLive(engine);
			return engine.call("keyChord", { target: WINDOW, keys: ["nosuchkey"] });
		},
	},
	{
		code: "InvalidCoordinateFrame",
		overlay: {},
		drive: async (engine) => {
			await makeStopPathLive(engine);
			return click(engine, "desktop");
		},
	},
	{
		code: "StaleRef",
		overlay: {},
		drive: async (engine) => {
			await open(engine);
			return engine.call("ax.node", { ref: "e9999" });
		},
	},
	{
		code: "AxUnsupported",
		overlay: { capabilities: { ax: false } },
		drive: async (engine) => {
			await open(engine);
			return engine.call("ax.snapshot", { target: WINDOW });
		},
	},
	{
		code: "AxFailed",
		overlay: {},
		drive: async (engine) => {
			await makeStopPathLive(engine);
			const textarea = await snapshotRef(engine, WINDOW, "textarea");
			return engine.call("ax.perform", { ref: textarea, action: "increment" });
		},
	},
	{
		code: "Timeout",
		overlay: { delay_ms: { capture: 5000 } },
		env: { SENPI_DESKTOP_OPERATION_TIMEOUT_MS: "500" },
		drive: async (engine) => {
			await open(engine);
			return engine.call("capture", { target: WINDOW });
		},
	},
	{
		code: "Closed",
		overlay: {},
		drive: async (engine) => {
			await open(engine);
			await engine.call("session.close");
			return engine.call("displays");
		},
	},
	{
		code: "Internal",
		overlay: { fail_next: [{ method: "displays", code: "Internal" }] },
		drive: async (engine) => {
			await open(engine);
			return engine.call("displays");
		},
	},
	{
		code: "StopPathUnavailable",
		overlay: {},
		drive: async (engine) => {
			await open(engine);
			return click(engine, "desktop");
		},
	},
	{
		code: "Suspended",
		overlay: {},
		drive: async (engine) => {
			await makeStopPathLive(engine);
			await engine.call("stopPath.stop", { source: "api" });
			return click(engine, "desktop");
		},
	},
	{
		code: "ScreenLocked",
		overlay: { capabilities: { screenLocked: true } },
		drive: async (engine) => {
			await makeStopPathLive(engine);
			return click(engine, "desktop");
		},
	},
	{
		code: "Cancelled",
		overlay: { delay_ms: { capture: 5000 } },
		drive: async (engine) => {
			await open(engine);
			engine.request(10, "capture", { target: WINDOW });
			engine.send({ jsonrpc: "2.0", method: "$/cancel", params: { id: 10 } });
			return engine.next();
		},
	},
	{ code: "CursorRestoreFailed", overlay: failNext("warp_cursor"), drive: foregroundClick },
	{ code: "FocusRestoreFailed", overlay: failNext("restore_front_window"), drive: foregroundClick },
	{ code: "TransactionFailed", overlay: failNext("front_window"), drive: foregroundClick },
	{ code: "ControlRequired", overlay: {}, drive: ungrantedForegroundClick },
];

/**
 * `InputBusy` needs two sessions holding the process-wide control slot, but
 * one engine binary owns one session. It is driven at the session-crate
 * level (two workers); the conformance table exempts it from the wire drive.
 */
export const WIRE_EXEMPT_CODES: readonly string[] = ["InputBusy"];
