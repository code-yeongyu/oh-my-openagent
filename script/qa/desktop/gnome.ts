#!/usr/bin/env bun
// GNOME live QA for the desktop engine's window-targeted pointer input. Runs INSIDE a live GNOME Wayland
// session (XDG_CURRENT_DESKTOP names GNOME), on the host under test; it provisions nothing and is NOT part
// of the hosted sway job (`desktop-linux-qa.yml` runs `linux.ts --all` only):
//
//   bun script/qa/desktop/gnome.ts --json [--engine BIN]
//
// Facts come from `gnome-extensions`, `busctl` and `gdbus` (the window list read straight from the shell), never from
// the engine's own report. GNOME Wayland exposes no cursor position to clients, so the landing point is not
// observed here; the fake-EIS unit suite proves the libei coordinates. One JSON line per scenario
// `{scenario, pass, facts, observer: {before, after}}`, then the engine teardown receipt; exit 0 iff every
// line passed.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { helloDesktopEngine, locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";

import { asObject, Engine, type Json, type JsonObject, outcome } from "./linux/engine.ts";
import { failure, type Result, result } from "./linux/scenario.ts";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const UUID = "senpi-desktop-window-rects@omo.dev";
const RECTS_PATH = "/dev/omo/SenpiDesktop/WindowRects";
const RECTS_IFACE = "dev.omo.SenpiDesktop.WindowRects";

const { values } = parseArgs({
	options: {
		json: { type: "boolean", default: false },
		engine: { type: "string" },
	},
});

function usage(message: string): never {
	process.stderr.write(`qa-desktop-gnome: ${message}\n`);
	process.exit(2);
}

type Observer = "gnome-extensions" | "busctl" | "gdbus";

function run(command: Observer, args: string[]): { status: number | null; stdout: string } {
	const options = { encoding: "utf8", timeout: 10_000 } as const;
	const child =
		command === "gnome-extensions"
			? spawnSync("gnome-extensions", args, options)
			: command === "busctl"
				? spawnSync("busctl", args, options)
				: spawnSync("gdbus", args, options);
	return { status: child.status, stdout: child.stdout ?? "" };
}

function extensionState(): string {
	const info = run("gnome-extensions", ["info", UUID]);
	if (info.status !== 0) return "not-installed";
	return /State:\s*(\S+)/.exec(info.stdout)?.[1] ?? "unknown";
}

function remoteDesktopPortal(): boolean {
	return (
		run("busctl", [
			"--user",
			"get-property",
			"org.freedesktop.portal.Desktop",
			"/org/freedesktop/portal/desktop",
			"org.freedesktop.portal.RemoteDesktop",
			"version",
		]).status === 0
	);
}

type Rect = { x: number; y: number; width: number; height: number };
type ShellWindow = Rect & { id: string; pid: number; title: string; shown: boolean; desktopWindow: boolean };
type ShellReply = { shell: { overview: boolean; modal: boolean; locked: boolean }; chrome: Rect[]; windows: ShellWindow[] };

/** `gdbus call` prints `('<json>',)`; the JSON is the extension's own reply. */
function shellReply(): ShellReply | null {
	const call = run("gdbus", ["call", "--session", "--dest", "org.gnome.Shell", "--object-path", RECTS_PATH, "--method", `${RECTS_IFACE}.List`]);
	if (call.status !== 0) return null;
	const quoted = /^\('(.*)',\)\s*$/s.exec(call.stdout.trim())?.[1];
	if (quoted === undefined) return null;
	return JSON.parse(quoted.replace(/\\(.)/gs, "$1")) as ShellReply;
}

function contains(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/**
 * The first engine window that exactly one shown shell window matches by pid and exact title, and whose frame
 * centre (where the move lands) no higher shown window and no shell chrome covers; none while the shell's own
 * UI is over every window.
 */
function pickWindow(windows: Json, reply: ShellReply): { window: JsonObject; shellWindow: ShellWindow } | null {
	if (!Array.isArray(windows) || reply.shell.overview || reply.shell.modal || reply.shell.locked) return null;
	const shell = reply.windows;
	const uncovered = (target: ShellWindow): boolean => {
		const x = target.x + Math.floor(target.width / 2);
		const y = target.y + Math.floor(target.height / 2);
		const above = shell.slice(shell.indexOf(target) + 1).filter((entry) => entry.shown && !entry.desktopWindow);
		return ![...above, ...reply.chrome].some((rect) => contains(rect, x, y));
	};
	for (const candidate of windows) {
		const window = asObject(candidate);
		const title = String(window.title ?? "");
		if (title === "" || typeof window.pid !== "number") continue;
		const matches = shell.filter((entry) => entry.shown && !entry.desktopWindow && entry.pid === window.pid && entry.title === title);
		if (matches.length === 1 && matches[0] !== undefined && uncovered(matches[0])) return { window, shellWindow: matches[0] };
	}
	return null;
}

async function windowMove(engine: Engine): Promise<Result> {
	const caps = asObject(await engine.result("capabilities"));
	const libeiSocket = process.env.LIBEI_SOCKET !== undefined;
	const portal = remoteDesktopPortal();
	const state = extensionState();
	const shell = shellReply();
	const windowInput = caps.windowInput === undefined ? null : asObject(caps.windowInput);
	const inputPath = libeiSocket || portal;
	const before = { libeiSocket, remoteDesktopPortal: portal, extensionState: state, shellAnswers: shell !== null };
	if (shell === null) {
		return result(
			"gnome-window-move",
			{
				window_input_gnome_extension_missing:
					windowInput?.available === false && windowInput.reason === "gnome_extension_missing",
			},
			{ capabilities: caps },
			{ before, after: {} },
		);
	}
	const picked = pickWindow(await engine.result("windows"), shell);
	if (picked === null) {
		return result(
			"gnome-window-move",
			{
				window_input_matches_input_paths: windowInput?.available === inputPath,
				shell_ui_closed: !shell.shell.overview && !shell.shell.modal && !shell.shell.locked,
				an_uncovered_matched_window_exists: false,
			},
			{ capabilities: caps },
			{ before, after: {} },
		);
	}
	const target = String(picked.window.id);
	const frame = asObject(await engine.result("capture", { target }));
	const x = Math.floor(Number(frame.width) / 2);
	const y = Math.floor(Number(frame.height) / 2);
	const moved = outcome(await engine.exec("moveMouse", { target, x, y, frameId: frame.frameId ?? null }));
	const after = { shellWindow: picked.shellWindow };
	const checks: Record<string, boolean> = inputPath
		? { window_input_available: windowInput?.available === true, move_ok: moved === "ok" }
		: { window_input_no_eis: windowInput?.available === false && windowInput.reason === "no_eis", move_refused: moved !== "ok" };
	return result("gnome-window-move", checks, { capabilities: caps, moveMouse: moved, target }, { before, after });
}

if (process.platform !== "linux") usage(`runs on the Linux host under test, not ${process.platform}`);
if (!(process.env.XDG_CURRENT_DESKTOP ?? "").split(":").some((name) => name.toLowerCase() === "gnome")) {
	usage("XDG_CURRENT_DESKTOP does not name GNOME: run inside a GNOME Wayland session");
}
if (spawnSync("gnome-extensions", ["--help"], { encoding: "utf8" }).error !== undefined) {
	usage("gnome-extensions is not installed: it is this script's independent observer");
}
if (spawnSync("gdbus", ["--help"], { encoding: "utf8" }).error !== undefined) {
	usage("gdbus is not installed: it is this script's independent observer");
}
if (spawnSync("busctl", ["--help"], { encoding: "utf8" }).error !== undefined) {
	usage("busctl is not installed: it is this script's independent observer");
}

const engineBinary = (() => {
	if (values.engine !== undefined) return values.engine;
	const located = locateDesktopEngine({ repoRoot: REPO_ROOT, packageDir: join(REPO_ROOT, "packages/senpi-desktop-engine") });
	if (located.path === null) usage(`${located.diagnostic.message} ${located.diagnostic.cause}`);
	return located.path;
})();

let allPassed = true;
function emit(line: Result | { receipt: string; pass: boolean }): void {
	allPassed &&= line.pass;
	const text = values.json ? JSON.stringify(line) : `${"scenario" in line ? line.scenario : line.receipt}: ${line.pass ? "PASS" : "FAIL"}`;
	process.stdout.write(`${text}\n`);
}

const hello = await helloDesktopEngine(engineBinary).then(
	(reply) => ({ receipt: `engine ${engineBinary} abi ${reply.abi} protocol ${reply.protocolVersion}`, pass: true }),
	(error: unknown) => ({ receipt: `engine ${error instanceof Error ? error.message : String(error)}`, pass: false }),
);
emit(hello);
if (hello.pass) {
	const engine = Engine.spawn(engineBinary, process.env);
	try {
		await engine.result("session.open", { allowHostRelayOnlyStop: true, reportMode: "object" });
		await engine.result("stopPath.start", { chord: "ctrl+alt+shift+escape" });
		emit(await windowMove(engine));
	} catch (error) {
		emit(failure("gnome-window-move", error));
	} finally {
		const closed = await engine.close();
		emit({ receipt: closed, pass: true });
	}
}
process.exitCode = allPassed ? 0 : 1;
