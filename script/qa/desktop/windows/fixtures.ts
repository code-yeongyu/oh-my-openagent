// Test windows and processes the scenarios act on, all under one per-run temp directory, plus the
// teardown that ends every process the run started and proves it with receipts.
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { asObject, type Engine, type Json } from "./engine"
import { imageOf, stillTracked } from "./process-identity"
import { hangGuard, probeUntil } from "./until"
import { removeTreeSync } from "../../../../test-support/remove-tree"

const WPF_HOST_SCRIPT = fileURLToPath(new URL("./wpf-host.ps1", import.meta.url))
const SCROLL_HOST_SCRIPT = fileURLToPath(new URL("./scroll-host.ps1", import.meta.url))

/** The scroll host's document: 200 lines, its view opened at zero-based line 100. */
export const SCROLL_DOCUMENT = { lines: 200, firstVisibleLine: 100 } as const

export interface QaWindow {
  readonly id: string
  readonly pid: number | null
  readonly title: string
  readonly elevated: boolean | null
}

export interface Notepad extends QaWindow {
  readonly content: string
}

export interface ScrollWindow extends QaWindow {
  /** The host's wheel/focus/activation event log, one event per line. */
  readonly eventLog: string
}

function parseWindow(value: Json): QaWindow {
  const window = asObject(value)
  return {
    id: String(window.id),
    pid: typeof window.pid === "number" ? window.pid : null,
    title: typeof window.title === "string" ? window.title : "",
    elevated: typeof window.elevated === "boolean" ? window.elevated : null,
  }
}

export async function listWindows(engine: Engine): Promise<QaWindow[]> {
  const windows = await engine.result("windows")
  if (!Array.isArray(windows)) throw new Error(`windows() is not an array: ${JSON.stringify(windows)}`)
  return windows.map(parseWindow)
}

async function waitForWindow(engine: Engine, matches: (window: QaWindow) => boolean, label: string): Promise<QaWindow> {
  const windows = await probeUntil(
    () => listWindows(engine),
    (listed) => listed.some(matches),
  )
  const window = windows.find(matches)
  if (window === undefined) throw new Error(`hang guard: ${label} never appeared in windows()`)
  return window
}

export class QaWorkspace {
  readonly dir = mkdtempSync(join(tmpdir(), "omo-desktop-qa-"))
  readonly receipts: string[] = []
  /** Tracked pid -> the image it ran when tracked; a recycled pid is never killed or counted. */
  private readonly pids = new Map<number, string>()

  receipt(line: string): void {
    this.receipts.push(line)
  }

  private track(child: ChildProcess, label: string): void {
    if (child.pid === undefined) throw new Error(`could not spawn ${label}`)
    this.remember(child.pid)
  }

  /** Records `pid` with its current image; a process that already exited needs no teardown. */
  private remember(pid: number): void {
    const image = imageOf(pid)
    if (image !== undefined) this.pids.set(pid, image)
  }

  async notepad(engine: Engine, tag: string): Promise<Notepad> {
    const path = join(this.dir, `omo-qa-${tag}.txt`)
    const content = `omo qa ${tag}`
    writeFileSync(path, content)
    this.track(spawn("notepad.exe", [path], { stdio: "ignore" }), "notepad.exe")
    const name = basename(path)
    const window = await waitForWindow(engine, (candidate) => candidate.title.includes(name), `Notepad ${name}`)
    // Packaged Notepad hands the document to a process other than the one spawned.
    if (window.pid !== null) this.remember(window.pid)
    return { ...window, content }
  }

  async wpfWindow(engine: Engine, tag: string): Promise<QaWindow> {
    return this.hostWindow(engine, WPF_HOST_SCRIPT, ["-Title", `omo-qa-wpf-${tag}`], "WPF window")
  }

  /** A WinForms window whose multi-line EDIT shows `SCROLL_DOCUMENT` from its middle. */
  async scrollWindow(engine: Engine, tag: string): Promise<ScrollWindow> {
    const eventLog = join(this.dir, `omo-qa-scroll-${tag}.log`)
    writeFileSync(eventLog, "")
    const args = ["-Title", `omo-qa-scroll-${tag}`, "-EventLog", eventLog, "-Lines", String(SCROLL_DOCUMENT.lines)]
    args.push("-FirstVisibleLine", String(SCROLL_DOCUMENT.firstVisibleLine))
    return { ...(await this.hostWindow(engine, SCROLL_HOST_SCRIPT, args, "scroll window")), eventLog }
  }

  /** Runs a `-STA` PowerShell window host that prints `ready <hwnd>`, and waits for that window. */
  private async hostWindow(engine: Engine, script: string, scriptArgs: string[], label: string): Promise<QaWindow> {
    const args = ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script]
    const name = basename(script)
    const child = spawn("powershell.exe", [...args, ...scriptArgs], { stdio: ["ignore", "pipe", "inherit"] })
    this.track(child, name)
    if (child.stdout === null) throw new Error(`${name} has no stdout`)
    const lines = createInterface({ input: child.stdout })
    const ready = await hangGuard(
      new Promise<string>((resolve) => lines.once("line", resolve)),
      () => `hang guard: ${name} never reported ready`,
    )
    const hwnd = /^ready (\d+)$/.exec(ready.trim())?.[1]
    if (hwnd === undefined) throw new Error(`${name}: ${ready}`)
    return waitForWindow(engine, (candidate) => candidate.id === hwnd, `${label} ${hwnd}`)
  }

  /**
   * A copy of the engine whose file carries the Low mandatory label: Windows starts a process from
   * such an executable at Low integrity, so every window of this (higher-integrity) runner is
   * "elevated" relative to it.
   */
  lowIntegrityEngine(binary: string): string {
    const copy = join(this.dir, "senpi-desktop-engine-low.exe")
    copyFileSync(binary, copy)
    const labelled = spawnSync("icacls", [copy, "/setintegritylevel", "Low"], { encoding: "utf8" })
    if (labelled.status !== 0) {
      throw new Error(`icacls /setintegritylevel Low failed: ${labelled.stdout}${labelled.stderr}`)
    }
    return copy
  }

  trackEngine(engine: Engine): void {
    this.remember(engine.pid)
  }

  /** Tracks a fixture process a scenario module spawned itself, for the same teardown. */
  trackProcess(child: ChildProcess, label: string): void {
    this.track(child, label)
  }

  teardown(): string[] {
    for (const [pid, image] of this.pids) {
      if (stillTracked(pid, image)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" })
    }
    const alive = [...this.pids].filter(([pid, image]) => stillTracked(pid, image)).map(([pid]) => pid)
    this.receipt(`killed tracked pids ${[...this.pids.keys()].join(",") || "(none)"}`)
    this.receipt(alive.length === 0 ? "procs 0" : `procs ${alive.length} alive: ${alive.join(",")}`)
    // Notepad can hold its file briefly after taskkill; rmSync retries EBUSY on its own.
    removeTreeSync(this.dir, { maxRetries: 10, retryDelay: 200 })
    this.receipt(existsSync(this.dir) ? `dir LEFT ${this.dir}` : `dir REMOVED ${this.dir}`)
    return this.receipts
  }
}
