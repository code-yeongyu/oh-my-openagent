import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Independent OS probes never read the desktop service's or agent's state. */
const run = promisify(execFile);
const PROBE_DEADLINE_MS = 30_000;
type Json = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function command(file: string, args: readonly string[]): Promise<string> {
	try {
		const { stdout } = await run(file, [...args], { timeout: PROBE_DEADLINE_MS, maxBuffer: 16 * 1024 * 1024 });
		return stdout.trim();
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const detail = "stderr" in error ? String(error.stderr).trim() : "";
		const killed = "killed" in error && error.killed === true ? " (killed by the probe deadline)" : "";
		throw new Error(`${file} failed${killed}: ${detail || error.message}`, { cause: error });
	}
}

/** Runs a JXA program whose completion value is a JSON string. */
export async function jxa(source: string): Promise<unknown> {
	return JSON.parse(await command("/usr/bin/osascript", ["-l", "JavaScript", "-e", source]));
}

export interface FocusSnapshot {
	readonly frontmostApp: string;
	readonly focusedWindow: string | null;
	readonly cursor: { readonly x: number; readonly y: number };
	readonly zOrder: readonly string[];
}

const SNAPSHOT = `
ObjC.import('CoreGraphics'); ObjC.import('AppKit');
const se = Application('System Events');
const front = se.processes.whose({ frontmost: true })[0];
let focusedWindow = null;
try { focusedWindow = front.attributes.byName('AXFocusedWindow').value().name(); } catch (error) { focusedWindow = null; }
const mouse = $.NSEvent.mouseLocation;
const options = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)));
const zOrder = windows.filter((w) => w.kCGWindowLayer === 0).map((w) => w.kCGWindowOwnerName + '#' + w.kCGWindowNumber);
JSON.stringify({ frontmostApp: front.name(), focusedWindow, cursor: { x: mouse.x, y: mouse.y }, zOrder });
`;

async function probeObject(source: string, what: string): Promise<Json> {
	const value = await jxa(source);
	if (!isRecord(value)) throw new TypeError(`${what} probe returned ${JSON.stringify(value)}`);
	return value;
}

export async function focusSnapshot(): Promise<FocusSnapshot> {
	const value = await probeObject(SNAPSHOT, "focus snapshot");
	const cursor = isRecord(value.cursor) ? value.cursor : {};
	return {
		frontmostApp: String(value.frontmostApp),
		focusedWindow: typeof value.focusedWindow === "string" ? value.focusedWindow : null,
		cursor: { x: Number(cursor.x), y: Number(cursor.y) },
		zOrder: Array.isArray(value.zOrder) ? value.zOrder.map(String) : [],
	};
}

export function sameJson(before: unknown, after: unknown): boolean {
	return JSON.stringify(before) === JSON.stringify(after);
}

export async function postKeystroke(digits: string): Promise<void> {
	await jxa(`const se = Application('System Events'); se.keystroke(${JSON.stringify(digits)}); se.keyCode(36); '"ok"';`);
}

export interface LauncherPermissions {
	readonly accessibilityTrusted: boolean;
	readonly screenCaptureAccess: boolean;
	readonly screenLocked: boolean;
	readonly skylightSpi: boolean;
}

const PERMISSIONS = `
ObjC.import('CoreGraphics');
ObjC.bindFunction('AXIsProcessTrusted', ['bool', []]);
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
ObjC.bindFunction('dlopen', ['void *', ['char *', 'int']]);
ObjC.bindFunction('dlsym', ['unsigned long', ['void *', 'char *']]);
const skylight = $.dlopen('/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight', 10);
const required = ['SLEventPostToPid', 'SLEventSetIntegerValueField', 'SLPSPostEventRecordTo', '_SLPSGetFrontProcess', 'CGEventSetWindowLocation'];
const session = ObjC.deepUnwrap(ObjC.castRefToObject($.CGSessionCopyCurrentDictionary())) || {};
JSON.stringify({
	accessibilityTrusted: $.AXIsProcessTrusted(),
	screenCaptureAccess: $.CGPreflightScreenCaptureAccess(),
	screenLocked: session.CGSSessionScreenIsLocked === true,
	skylightSpi: required.every((name) => String($.dlsym(skylight, name)) !== '0'),
});
`;

export async function launcherPermissions(): Promise<LauncherPermissions> {
	const value = await probeObject(PERMISSIONS, "launcher permission");
	return {
		accessibilityTrusted: value.accessibilityTrusted === true,
		screenCaptureAccess: value.screenCaptureAccess === true,
		screenLocked: value.screenLocked === true,
		skylightSpi: value.skylightSpi === true,
	};
}

const TOPMOST_AT = (title: string, fx: number, fy: number) => `
ObjC.import('CoreGraphics');
const options = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)));
const windows = all.filter((w) => w.kCGWindowLayer === 0);
const target = windows.find((w) => w.kCGWindowName === ${JSON.stringify(title)});
const b = target.kCGWindowBounds;
const x = b.X + b.Width * ${fx}; const y = b.Y + b.Height * ${fy};
const top = windows.find((w) => { const r = w.kCGWindowBounds; return x >= r.X && x < r.X + r.Width && y >= r.Y && y < r.Y + r.Height; });
JSON.stringify(top.kCGWindowOwnerName + '#' + top.kCGWindowNumber + ' ' + top.kCGWindowName);
`;

export async function topmostAt(title: string, fx: number, fy: number): Promise<string> {
	return String(await jxa(TOPMOST_AT(title, fx, fy)));
}
