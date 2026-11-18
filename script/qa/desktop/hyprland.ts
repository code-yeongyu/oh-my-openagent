#!/usr/bin/env bun
// Hyprland live QA for the desktop engine's window-targeted pointer input. Runs INSIDE a live Hyprland
// session (HYPRLAND_INSTANCE_SIGNATURE set), on the host under test; it provisions nothing and is NOT
// part of the hosted sway job (`desktop-linux-qa.yml` runs `linux.ts --all` only):
//
//   bun script/qa/desktop/hyprland.ts --json [--engine BIN]
//
// Every fact is read by an independent observer (`hyprctl -j`, `busctl --user`), never from the engine's
// own report. One JSON line per scenario `{scenario, pass, facts, observer: {before, after}}`, then the
// engine teardown receipt; exit 0 iff every line passed.
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { helloDesktopEngine, locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine"

import { asObject, Engine, type Json, type JsonObject, outcome } from "./linux/engine.ts"
import { failure, type Result, result } from "./linux/scenario.ts"

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    engine: { type: "string" },
  },
})

function usage(message: string): never {
  process.stderr.write(`qa-desktop-hyprland: ${message}\n`)
  process.exit(2)
}

function hyprctl(command: string): Json {
  const run = spawnSync("hyprctl", ["-j", command], { encoding: "utf8", timeout: 10_000 })
  if (run.status !== 0) throw new Error(`hyprctl -j ${command} exited ${run.status}: ${run.stderr.trim()}`)
  return JSON.parse(run.stdout)
}

/** Whether the session bus serves the RemoteDesktop portal (xdg-desktop-portal-hyprland 1.4.1 does not). */
function remoteDesktopPortal(): boolean {
  const run = spawnSync(
    "busctl",
    [
      "--user",
      "get-property",
      "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.RemoteDesktop",
      "version",
    ],
    { encoding: "utf8", timeout: 10_000 },
  )
  return run.status === 0
}

function visibleWorkspaces(): Set<number> {
  const monitors = hyprctl("monitors")
  if (!Array.isArray(monitors)) throw new Error("hyprctl monitors is not an array")
  return new Set(
    monitors
      .map((monitor) => asObject(monitor))
      .filter((monitor) => monitor.disabled !== true)
      .map((monitor) => Number(asObject(monitor.activeWorkspace).id)),
  )
}

/** The first engine window that exactly one shown Hyprland client matches by pid and title. */
function pickWindow(windows: Json): { window: JsonObject; client: JsonObject } | null {
  const clients = hyprctl("clients")
  if (!Array.isArray(windows) || !Array.isArray(clients)) return null
  const visible = visibleWorkspaces()
  const shown = clients
    .map((client) => asObject(client))
    .filter((client) => client.mapped === true && client.hidden !== true)
    .filter((client) => visible.has(Number(asObject(client.workspace).id)))
  for (const candidate of windows) {
    const window = asObject(candidate)
    const matches = shown.filter((client) => client.pid === window.pid && client.title === window.title)
    if (matches.length === 1 && matches[0]?.floating === false) return { window, client: matches[0] }
  }
  return null
}

/** Logical pixels the cursor may sit from the expected point (`cursorpos` rounds to whole pixels). */
const CURSOR_TOLERANCE = 2

function cursor(): { x: number; y: number } {
  const position = asObject(hyprctl("cursorpos"))
  return { x: Number(position.x), y: Number(position.y) }
}

async function windowMove(engine: Engine): Promise<Result> {
  const caps = asObject(await engine.result("capabilities"))
  const libeiSocket = process.env.LIBEI_SOCKET !== undefined
  const portal = remoteDesktopPortal()
  const windowInput = caps.windowInput === undefined ? null : asObject(caps.windowInput)
  const inputPath = libeiSocket || portal
  const picked = pickWindow(await engine.result("windows"))
  const before = { libeiSocket, remoteDesktopPortal: portal, cursor: cursor(), client: picked?.client ?? null }
  if (picked === null) {
    return result(
      "hyprland-window-move",
      { window_input_matches_input_paths: windowInput?.available === inputPath, a_shown_tiled_window_exists: false },
      { capabilities: caps },
      { before, after: {} },
    )
  }
  const target = String(picked.window.id)
  const frame = asObject(await engine.result("capture", { target }))
  const x = Math.floor(Number(frame.width) / 2)
  const y = Math.floor(Number(frame.height) / 2)
  const moved = outcome(await engine.exec("moveMouse", { target, x, y, frameId: frame.frameId ?? null }))
  const after = { cursor: cursor() }
  const at = picked.client.at
  const size = picked.client.size
  // The frame is cropped at the client rect, so frame pixel (x, y) is the client's `at` plus (x, y)
  // in logical units (frame pixels scaled by size / frame size); a cursor merely inside the client
  // would also pass with the crop and the click on different rects.
  const expected =
    Array.isArray(at) && Array.isArray(size)
      ? {
          x: Number(at[0]) + (x * Number(size[0])) / Number(frame.width),
          y: Number(at[1]) + (y * Number(size[1])) / Number(frame.height),
        }
      : null
  const atExpectedPoint =
    expected !== null &&
    Math.abs(after.cursor.x - expected.x) <= CURSOR_TOLERANCE &&
    Math.abs(after.cursor.y - expected.y) <= CURSOR_TOLERANCE
  const checks: Record<string, boolean> = inputPath
    ? {
        window_input_available: windowInput?.available === true,
        move_ok: moved === "ok",
        cursor_at_frame_center_of_target_client: atExpectedPoint,
      }
    : {
        window_input_no_eis: windowInput?.available === false && windowInput.reason === "no_eis",
        move_refused: moved !== "ok",
        cursor_unchanged: after.cursor.x === before.cursor.x && after.cursor.y === before.cursor.y,
      }
  return result(
    "hyprland-window-move",
    checks,
    { capabilities: caps, moveMouse: moved, target, expectedCursor: expected },
    { before, after },
  )
}

if (process.platform !== "linux") usage(`runs on the Linux host under test, not ${process.platform}`)
if (!process.env.HYPRLAND_INSTANCE_SIGNATURE)
  usage("HYPRLAND_INSTANCE_SIGNATURE is unset: run inside a Hyprland session")

const engineBinary = (() => {
  if (values.engine !== undefined) return values.engine
  const located = locateDesktopEngine({
    repoRoot: REPO_ROOT,
    packageDir: join(REPO_ROOT, "packages/senpi-desktop-engine"),
  })
  if (located.path === null) usage(`${located.diagnostic.message} ${located.diagnostic.cause}`)
  return located.path
})()

let allPassed = true
function emit(line: Result | { receipt: string; pass: boolean }): void {
  allPassed &&= line.pass
  const text = values.json
    ? JSON.stringify(line)
    : `${"scenario" in line ? line.scenario : line.receipt}: ${line.pass ? "PASS" : "FAIL"}`
  process.stdout.write(`${text}\n`)
}

const hello = await helloDesktopEngine(engineBinary).then(
  (reply) => ({ receipt: `engine ${engineBinary} abi ${reply.abi} protocol ${reply.protocolVersion}`, pass: true }),
  (error: unknown) => ({ receipt: `engine ${error instanceof Error ? error.message : String(error)}`, pass: false }),
)
emit(hello)
if (hello.pass) {
  const engine = Engine.spawn(engineBinary, process.env)
  try {
    await engine.result("session.open", { allowHostRelayOnlyStop: true, reportMode: "object" })
    await engine.result("stopPath.start", { chord: "ctrl+alt+shift+escape" })
    emit(await windowMove(engine))
  } catch (error) {
    emit(failure("hyprland-window-move", error))
  } finally {
    const closed = await engine.close()
    emit({ receipt: closed, pass: true })
  }
}
process.exitCode = allPassed ? 0 : 1
