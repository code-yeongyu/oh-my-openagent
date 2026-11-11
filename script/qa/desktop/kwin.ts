#!/usr/bin/env bun
// KWin live QA for the desktop engine's window-targeted pointer input. Runs INSIDE a live Plasma Wayland
// session (XDG_CURRENT_DESKTOP names KDE), on the host under test; it provisions nothing and is NOT part
// of the hosted sway job (`desktop-linux-qa.yml` runs `linux.ts --all` only):
//
//   bun script/qa/desktop/kwin.ts --json [--engine BIN]
//
// Every fact is read by an independent observer (`kdotool`, `busctl --user`), never from the engine's own
// report. One JSON line per scenario `{scenario, pass, facts, observer: {before, after}}`, then the engine
// teardown receipt; exit 0 iff every line passed.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { helloDesktopEngine, locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";

import { asObject, Engine, type Json, type JsonObject, outcome } from "./linux/engine.ts";
import { failure, type Result, result } from "./linux/scenario.ts";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const { values } = parseArgs({
	options: {
		json: { type: "boolean", default: false },
		engine: { type: "string" },
	},
});

function usage(message: string): never {
	process.stderr.write(`qa-desktop-kwin: ${message}\n`);
	process.exit(2);
}

function kdotool(...args: string[]): string {
	const run = spawnSync("kdotool", args, { encoding: "utf8", timeout: 10_000 });
	if (run.error !== undefined) throw new Error(`kdotool ${args.join(" ")}: ${run.error.message}`);
	if (run.status !== 0) throw new Error(`kdotool ${args.join(" ")} exited ${run.status}: ${run.stderr.trim()}`);
	return run.stdout.trim();
}

function busctl(...args: string[]): boolean {
	return spawnSync("busctl", ["--user", ...args], { encoding: "utf8", timeout: 10_000 }).status === 0;
}

function kwinScripting(): boolean {
	return busctl("introspect", "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting");
}

function remoteDesktopPortal(): boolean {
	return busctl(
		"get-property",
		"org.freedesktop.portal.Desktop",
		"/org/freedesktop/portal/desktop",
		"org.freedesktop.portal.RemoteDesktop",
		"version",
	);
}

type Rect = { x: number; y: number; width: number; height: number };

/** `kdotool getwindowgeometry` prints `Position: X,Y` and `Geometry: WxH`. */
function geometry(id: string): Rect | null {
	const text = kdotool("getwindowgeometry", id);
	const position = /Position:\s*(-?[\d.]+),(-?[\d.]+)/.exec(text);
	const size = /Geometry:\s*([\d.]+)x([\d.]+)/.exec(text);
	if (position === null || size === null) return null;
	return { x: Number(position[1]), y: Number(position[2]), width: Number(size[1]), height: Number(size[2]) };
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first engine window that exactly one KWin window matches by pid and exact caption. */
function pickWindow(windows: Json): { window: JsonObject; kwinId: string; rect: Rect } | null {
	if (!Array.isArray(windows)) return null;
	for (const candidate of windows) {
		const window = asObject(candidate);
		const title = String(window.title ?? "");
		if (title === "" || typeof window.pid !== "number") continue;
		const ids = kdotool("search", "--name", `^${escapeRegex(title)}$`)
			.split("\n")
			.filter((id) => id !== "")
			.filter((id) => Number(kdotool("getwindowpid", id)) === window.pid);
		const rect = ids.length === 1 && ids[0] !== undefined ? geometry(ids[0]) : null;
		if (ids[0] !== undefined && rect !== null) return { window, kwinId: ids[0], rect };
	}
	return null;
}

function cursor(): { x: number; y: number } {
	const text = kdotool("getmouselocation");
	const x = /x:(-?[\d.]+)/.exec(text);
	const y = /y:(-?[\d.]+)/.exec(text);
	if (x === null || y === null) throw new Error(`kdotool getmouselocation: unexpected output ${text}`);
	return { x: Number(x[1]), y: Number(y[1]) };
}

async function windowMove(engine: Engine): Promise<Result> {
	const caps = asObject(await engine.result("capabilities"));
	const libeiSocket = process.env.LIBEI_SOCKET !== undefined;
	const portal = remoteDesktopPortal();
	const scripting = kwinScripting();
	const windowInput = caps.windowInput === undefined ? null : asObject(caps.windowInput);
	const inputPath = libeiSocket || portal;
	const picked = pickWindow(await engine.result("windows"));
	const before = {
		libeiSocket,
		remoteDesktopPortal: portal,
		kwinScripting: scripting,
		cursor: cursor(),
		kwinWindow: picked === null ? null : { id: picked.kwinId, rect: picked.rect },
	};
	if (!scripting) {
		return result(
			"kwin-window-move",
			{
				window_input_kwin_dbus_missing:
					windowInput?.available === false && windowInput.reason === "kwin_dbus_missing",
			},
			{ capabilities: caps },
			{ before, after: {} },
		);
	}
	if (picked === null) {
		return result(
			"kwin-window-move",
			{ window_input_matches_input_paths: windowInput?.available === inputPath, a_matched_window_exists: false },
			{ capabilities: caps },
			{ before, after: {} },
		);
	}
	const target = String(picked.window.id);
	const frame = asObject(await engine.result("capture", { target }));
	const x = Math.floor(Number(frame.width) / 2);
	const y = Math.floor(Number(frame.height) / 2);
	const moved = outcome(await engine.exec("moveMouse", { target, x, y, frameId: frame.frameId ?? null }));
	const after = { cursor: cursor() };
	const { rect } = picked;
	const inside =
		after.cursor.x >= rect.x &&
		after.cursor.y >= rect.y &&
		after.cursor.x < rect.x + rect.width &&
		after.cursor.y < rect.y + rect.height;
	const checks: Record<string, boolean> = inputPath
		? {
				window_input_available: windowInput?.available === true,
				move_ok: moved === "ok",
				cursor_inside_target_window: inside,
			}
		: {
				window_input_no_eis: windowInput?.available === false && windowInput.reason === "no_eis",
				move_refused: moved !== "ok",
				cursor_unchanged: after.cursor.x === before.cursor.x && after.cursor.y === before.cursor.y,
			};
	return result("kwin-window-move", checks, { capabilities: caps, moveMouse: moved, target }, { before, after });
}

if (process.platform !== "linux") usage(`runs on the Linux host under test, not ${process.platform}`);
if (!(process.env.XDG_CURRENT_DESKTOP ?? "").split(":").some((name) => name.toLowerCase() === "kde")) {
	usage("XDG_CURRENT_DESKTOP does not name KDE: run inside a Plasma Wayland session");
}
if (spawnSync("kdotool", ["--version"], { encoding: "utf8" }).error !== undefined) {
	usage("kdotool is not installed: it is this script's independent observer");
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
		emit(failure("kwin-window-move", error));
	} finally {
		const closed = await engine.close();
		emit({ receipt: closed, pass: true });
	}
}
process.exitCode = allPassed ? 0 : 1;
