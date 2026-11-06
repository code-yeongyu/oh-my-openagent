import { readFileSync } from "node:fs";
import path from "node:path";
import { capture, type EngineProcess, type Message, makeStopPathLive, REPO_ROOT, snapshotRef } from "./engine";

/** The fake scenario's only window. */
export const WINDOW = "101";

const ERROR_RS = path.join(REPO_ROOT, "crates", "senpi-desktop-core", "src", "error.rs");

/**
 * The variants of `enum ErrorCode` in `senpi-desktop-core/src/error.rs`, in declaration order. The body ends at the
 * enum's own closing line, not at the first `}`: a doc comment may hold braces (`CaptureUnavailable`'s does).
 */
export function declaredErrorCodes(): readonly string[] {
	const body = readFileSync(ERROR_RS, "utf8").split("pub enum ErrorCode {")[1];
	if (body === undefined) throw new Error(`${ERROR_RS} declares no enum ErrorCode`);
	const lines = body.split("\n").map((line) => line.trim());
	const end = lines.indexOf("}");
	if (end === -1) throw new Error(`${ERROR_RS} never closes enum ErrorCode`);
	return lines
		.slice(0, end)
		.filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("#"))
		.map((line) => line.replace(/,$/, ""));
}

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
/** The fake fails the next `method` call with `code`: the wire path of a code no fake scenario raises on its own yet. */
const failNextWith = (method: string, code: string): Message => ({ fail_next: [{ method, code }] });
const failNext = (method: string): Message => failNextWith(method, "InputFailed");

/** A background click on the captured window. */
async function windowClick(engine: EngineProcess): Promise<Message> {
	await makeStopPathLive(engine);
	await capture(engine, WINDOW);
	return click(engine, WINDOW);
}

async function listWindows(engine: EngineProcess): Promise<Message> {
	await open(engine);
	return engine.call("windows", {});
}

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
			return click(engine, WINDOW);
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
	{
		code: "CaptureUnavailable",
		overlay: { fail_next: [{ method: "capture", code: "CaptureUnavailable", reason: "minimized" }] },
		drive: async (engine) => {
			await open(engine);
			return engine.call("capture", { target: WINDOW });
		},
	},
	{ code: "UserIntervened", overlay: failNextWith("click", "UserIntervened"), drive: windowClick },
	{
		code: "AxUnconfirmed",
		overlay: failNextWith("ax_perform", "AxUnconfirmed"),
		drive: async (engine) => {
			await makeStopPathLive(engine);
			const textarea = await snapshotRef(engine, WINDOW, "textarea");
			return engine.call("ax.perform", { ref: textarea, action: "press" });
		},
	},
	{ code: "SpaceUnsupported", overlay: failNextWith("windows", "SpaceUnsupported"), drive: listWindows },
	{ code: "SpaceMoveDenied", overlay: failNextWith("windows", "SpaceMoveDenied"), drive: listWindows },
];

/**
 * `InputBusy` needs two sessions holding the process-wide control slot, but
 * one engine binary owns one session. It is driven at the session-crate
 * level (two workers); the conformance table exempts it from the wire drive.
 */
export const WIRE_EXEMPT_CODES: readonly string[] = ["InputBusy"];
