// Scripted desktop methods for test/fake-engine.mjs, enabled by FAKE_ENGINE_DESKTOP=1.
// One display, two windows ("101" Code, "202" Mail). Pointer input needs a prior capture of the same
// target (InvalidCoordinateFrame otherwise), as the real engine's per-target frames do.
// Captures of "desktop" and "101" are inline PNGs; "202" is artifact-only.
// FAKE_ENGINE_INPUT_ERROR=<engine error code> makes every input method fail with that code, the way the
// engine's input gate refuses (Suspended, StopPathUnavailable, PermissionDenied, ScreenLocked).

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const DISPLAYS = [
	{
		id: "1",
		name: "Built-in",
		x: 0,
		y: 0,
		width: 1440,
		height: 900,
		scale: 2,
		pixelX: 0,
		pixelY: 0,
		pixelWidth: 2880,
		pixelHeight: 1800,
		isPrimary: true,
	},
];

const WINDOWS = [
	{ id: "101", title: "main.ts", app: "Code", pid: 42, x: 0, y: 25, width: 1200, height: 800, focused: true },
	{ id: "202", title: "Inbox", app: "Mail", pid: 43, x: 100, y: 100, width: 900, height: 700, focused: false },
];

const BUTTON = {
	ref: "e1",
	role: "button",
	nativeRole: "AXButton",
	title: "Run",
	enabled: true,
	focused: false,
	x: 10,
	y: 20,
	width: 30,
	height: 40,
	actions: ["press"],
	childCount: 0,
};

const POINTER_METHODS = new Set(["click", "moveMouse", "drag", "scroll"]);
const NULL_METHODS = new Set(["typeText", "keyChord", "raiseWindow", "ax.perform", "ax.setValue", "ax.focus", "ax.click"]);

// rpc code = -32000 - the ErrorCode ordinal (senpi-desktop-core error.rs).
const INPUT_ERROR_RPC = { PermissionDenied: -32000, StopPathUnavailable: -32014, Suspended: -32015, ScreenLocked: -32016 };

const error = (rpcCode, code, message, hint = null) => ({ error: { code: rpcCode, message, data: { code, hint } } });

function capture(target, frameId) {
	const window = WINDOWS.find((candidate) => candidate.id === target);
	const common = { target, frameId, scale: 1, note: null };
	if (target === "desktop") {
		const size = { width: 1280, height: 800, sourceWidth: 2880, sourceHeight: 1800 };
		return { ...common, ...size, mode: "inline-png", data: PNG_1X1, mimeType: "image/png", artifactPath: null };
	}
	const size = { width: window.width, height: window.height, sourceWidth: window.width, sourceHeight: window.height };
	if (target === "101") return { ...common, ...size, mode: "inline-png", data: PNG_1X1, mimeType: "image/png" };
	const note = "capture exceeds the inline byte budget; open the artifact instead";
	return { ...common, ...size, mode: "artifact-only", artifactPath: `/tmp/fake-captures/${frameId}.png`, note };
}

const audit = (action, target, frameId, code) => ({
	method: "audit",
	params: { action, target, delivery: "background", frameId, code, durationMs: 4 },
});

/**
 * Returns `(method, params) => {result} | {error} | undefined` (undefined: not a desktop method).
 * Pointer outcomes also carry `notifications` (one `audit`) the engine sends before the reply.
 */
export function createDesktop() {
	const frames = new Map();
	let clipboard = "";
	const inputError = process.env.FAKE_ENGINE_INPUT_ERROR;
	return (method, params) => {
		const target = params?.target;
		if (inputError !== undefined && (POINTER_METHODS.has(method) || method === "typeText" || method === "keyChord")) {
			const failure = error(INPUT_ERROR_RPC[inputError] ?? -32013, inputError, `input refused: ${inputError}`);
			return { ...failure, notifications: [audit(method, target ?? "desktop", null, inputError)] };
		}
		if (POINTER_METHODS.has(method)) {
			const frameId = frames.get(target) ?? null;
			if (frameId === null) {
				const failure = error(-32007, "InvalidCoordinateFrame", `no capture of ${target} yet`, `capture ${target} first`);
				return { ...failure, notifications: [audit(method, target, null, "InvalidCoordinateFrame")] };
			}
			return { result: null, notifications: [audit(method, target, frameId, null)] };
		}
		if (NULL_METHODS.has(method)) return { result: null };
		switch (method) {
			case "displays":
				return { result: DISPLAYS };
			case "windows":
				return { result: WINDOWS };
			case "capture": {
				if (target !== "desktop" && !WINDOWS.some((window) => window.id === target)) {
					return error(-32004, "WindowNotFound", `no window ${target}`);
				}
				const frameId = `${target}-${frames.size + 1}`;
				frames.set(target, frameId);
				return { result: capture(target, frameId) };
			}
			case "clipboard.read":
				return { result: { text: clipboard } };
			case "clipboard.write":
				clipboard = params.text;
				return { result: null };
			case "ax.snapshot":
				return { result: { text: "button Run [ref=e1]", nodeCount: 1, truncated: false } };
			case "ax.query":
			case "ax.children":
				return { result: [BUTTON] };
			case "ax.node":
			case "ax.elementAt":
			case "ax.focused":
				return { result: BUTTON };
			case "ax.parent":
				return { result: null };
			case "ax.attributes":
				return { result: [["AXRole", "AXButton"]] };
			default:
				return undefined;
		}
	};
}
