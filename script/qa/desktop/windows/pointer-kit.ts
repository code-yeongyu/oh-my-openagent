// Fixtures and the independent probe of the foreground pointer scenarios: WinForms pointer hosts
// (pointer-host.ps1) placed at exact screen rects so they overlap, their event logs, and
// pointer-probe.ps1, which reads the cursor, the foreground, and each host's rect, first visible
// line and selection through Win32 - never through the engine.
import { execFile, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { asObject, type Engine, type Json, type JsonObject } from "./engine"
import { listWindows, type QaWorkspace } from "./fixtures"
import { HANG_GUARD_MS, hangGuard, probeUntil } from "./until"

const HOST_SCRIPT = fileURLToPath(new URL("./pointer-host.ps1", import.meta.url))
const PROBE_SCRIPT = fileURLToPath(new URL("./pointer-probe.ps1", import.meta.url))
const TRACE_SCRIPT = fileURLToPath(new URL("./mouse-trace.ps1", import.meta.url))

/** The host's document opens with this zero-based line at the top, so a wheel either way moves it. */
export const HOST_FIRST_VISIBLE_LINE = 100

export interface ScreenRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface PointerHost {
  readonly id: string
  readonly edit: string
  readonly eventLog: string
}

export type Point = { readonly x: number; readonly y: number }

export interface HostState {
  readonly exists: boolean
  readonly rect: ScreenRect | null
  readonly firstVisibleLine: number
  readonly selection: { readonly start: number; readonly end: number }
}

export interface PointerProbe {
  /** SM_X/Y/CX/CYVIRTUALSCREEN: the virtual desktop in physical pixels. */
  readonly virtualScreen: ScreenRect
  readonly cursor: Point
  readonly cursorRoot: string
  readonly foreground: string
  readonly hosts: Readonly<Record<string, HostState>>
  readonly raw: JsonObject
}

/** Starts a pointer host at `rect` (physical pixels) and waits until the engine lists its window. */
export async function pointerHost(
  context: { readonly workspace: QaWorkspace },
  engine: Engine,
  tag: string,
  rect: ScreenRect,
): Promise<PointerHost> {
  const eventLog = join(context.workspace.dir, `omo-qa-pointer-${tag}.log`)
  writeFileSync(eventLog, "")
  const args = ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", HOST_SCRIPT]
  args.push("-Title", `omo-qa-pointer-${tag}`, "-EventLog", eventLog)
  args.push("-Left", String(rect.left), "-Top", String(rect.top))
  args.push("-Width", String(rect.right - rect.left), "-Height", String(rect.bottom - rect.top))
  args.push("-FirstVisibleLine", String(HOST_FIRST_VISIBLE_LINE))
  const child = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "inherit"] })
  context.workspace.trackProcess(child, "pointer-host.ps1")
  if (child.stdout === null) throw new Error("pointer-host.ps1 has no stdout")
  const lines = createInterface({ input: child.stdout })
  const ready = await hangGuard(
    new Promise<string>((resolve) => lines.on("line", (line) => line.startsWith("ready ") && resolve(line))),
    () => "hang guard: pointer-host.ps1 never reported ready",
  )
  const match = /^ready (\d+) (\d+)$/.exec(ready.trim())
  const [, id, edit] = match ?? []
  if (id === undefined || edit === undefined) throw new Error(`pointer-host.ps1: ${ready}`)
  const listed = await probeUntil(
    () => listWindows(engine),
    (windows) => windows.some((window) => window.id === id),
  )
  if (!listed.some((window) => window.id === id)) throw new Error(`hang guard: pointer host ${id} never listed`)
  return { id, edit, eventLog }
}

export function hostEvents(host: PointerHost): string[] {
  return readFileSync(host.eventLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
}

/** The screen points of the host's `mousedown`/`mouseup`/`wheel` events, in order. */
export function pointerEvents(host: PointerHost, kind: "mousedown" | "mouseup" | "wheel"): string[] {
  return hostEvents(host).filter((line) => line.startsWith(`${kind} `))
}

/** Whether a logged event line's trailing `x y` lies within `tolerance` px of `point`. */
export function eventAt(line: string, point: Point, tolerance: number): boolean {
  const parts = line.split(" ")
  const x = Number(parts.at(-2))
  const y = Number(parts.at(-1))
  return Math.abs(x - point.x) <= tolerance && Math.abs(y - point.y) <= tolerance
}

function numberOf(object: JsonObject, key: string): number {
  const value = object[key]
  if (typeof value !== "number") throw new Error(`pointer-probe: ${key} is not a number: ${JSON.stringify(object)}`)
  return value
}

function parseHost(value: Json | undefined): HostState {
  const entry = asObject(value)
  const exists = entry.exists === true
  const rect = exists ? asObject(entry.rect) : null
  const selection = exists ? asObject(entry.selection) : null
  return {
    exists,
    rect:
      rect === null
        ? null
        : { left: numberOf(rect, "left"), top: numberOf(rect, "top"), right: numberOf(rect, "right"), bottom: numberOf(rect, "bottom") },
    firstVisibleLine: exists ? numberOf(entry, "firstVisibleLine") : -1,
    selection: selection === null ? { start: -1, end: -1 } : { start: numberOf(selection, "start"), end: numberOf(selection, "end") },
  }
}

/** One probe of `hosts`; `park` first moves the cursor there with SetCursorPos (the QA side's own). */
export function probe(hosts: readonly PointerHost[], park?: Point): Promise<PointerProbe> {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PROBE_SCRIPT]
  if (hosts.length > 0) args.push("-Windows", hosts.map((host) => `${host.id}:${host.edit}`).join(","))
  if (park !== undefined) args.push("-ParkX", String(park.x), "-ParkY", String(park.y))
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", args, { timeout: HANG_GUARD_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`pointer-probe failed: ${error.message}\n${stderr}`))
        return
      }
      const raw = asObject(JSON.parse(stdout))
      const cursor = asObject(raw.cursor)
      const hostsRaw = asObject(raw.windows ?? {})
      const parsed: Record<string, HostState> = {}
      for (const host of hosts) parsed[host.id] = parseHost(hostsRaw[host.id])
      const screen = asObject(raw.virtualScreen)
      resolve({
        virtualScreen: {
          left: numberOf(screen, "x"),
          top: numberOf(screen, "y"),
          right: numberOf(screen, "x") + numberOf(screen, "width"),
          bottom: numberOf(screen, "y") + numberOf(screen, "height"),
        },
        cursor: { x: numberOf(cursor, "x"), y: numberOf(cursor, "y") },
        cursorRoot: String(raw.cursorRoot),
        foreground: String(raw.foreground),
        hosts: parsed,
        raw,
      })
    })
  })
}

export function probeHostsUntil(hosts: readonly PointerHost[], settled: (seen: PointerProbe) => boolean): Promise<PointerProbe> {
  return probeUntil(() => probe(hosts), settled)
}

export function inside(rect: ScreenRect | null, point: Point): boolean {
  return rect !== null && point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom
}

export interface MouseTrace {
  /** `<message hex> <x> <y> <wheel delta> <injected> <top-level hwnd at the point>`, one per routed event. */
  readonly lines: () => string[]
  readonly stop: () => Promise<void>
}

/** Starts mouse-trace.ps1 (a WH_MOUSE_LL hook in its own process) and waits until the hook is installed. */
export async function mouseTrace(context: { readonly workspace: QaWorkspace }, tag: string): Promise<MouseTrace> {
  const log = join(context.workspace.dir, `omo-qa-mouse-trace-${tag}.log`)
  writeFileSync(log, "")
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", TRACE_SCRIPT, "-Log", log]
  const child = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "inherit"] })
  context.workspace.trackProcess(child, "mouse-trace.ps1")
  const stdout = child.stdout
  if (stdout === null) throw new Error("mouse-trace.ps1 has no stdout")
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  const ready = await hangGuard(
    new Promise<string>((resolve) => createInterface({ input: stdout }).once("line", resolve)),
    () => "hang guard: mouse-trace.ps1 never reported ready",
  )
  if (ready.trim() !== "ready") throw new Error(`mouse-trace.ps1: ${ready}`)
  return {
    lines: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== ""),
    stop: async () => {
      child.kill()
      await hangGuard(exited, () => undefined)
    },
  }
}
