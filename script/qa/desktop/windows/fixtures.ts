// Test windows and processes the scenarios act on, all under one per-run temp directory, plus the
// teardown that ends every process the run started and proves it with receipts.
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { asObject, type Engine, type Json } from "./engine"
import { hangGuard, probeUntil } from "./until"

const WPF_HOST_SCRIPT = fileURLToPath(new URL("./wpf-host.ps1", import.meta.url))

export interface QaWindow {
  readonly id: string
  readonly pid: number | null
  readonly title: string
  readonly elevated: boolean | null
}

export interface Notepad extends QaWindow {
  readonly content: string
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

function isAlive(pid: number): boolean {
  const listed = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8" })
  return listed.stdout.includes(`"${pid}"`)
}

export class QaWorkspace {
  readonly dir = mkdtempSync(join(tmpdir(), "omo-desktop-qa-"))
  readonly receipts: string[] = []
  private readonly pids = new Set<number>()

  receipt(line: string): void {
    this.receipts.push(line)
  }

  private track(child: ChildProcess, label: string): void {
    if (child.pid === undefined) throw new Error(`could not spawn ${label}`)
    this.pids.add(child.pid)
  }

  async notepad(engine: Engine, tag: string): Promise<Notepad> {
    const path = join(this.dir, `omo-qa-${tag}.txt`)
    const content = `omo qa ${tag}`
    writeFileSync(path, content)
    this.track(spawn("notepad.exe", [path], { stdio: "ignore" }), "notepad.exe")
    const name = basename(path)
    const window = await waitForWindow(engine, (candidate) => candidate.title.includes(name), `Notepad ${name}`)
    // Packaged Notepad hands the document to a process other than the one spawned.
    if (window.pid !== null) this.pids.add(window.pid)
    return { ...window, content }
  }

  async wpfWindow(engine: Engine, tag: string): Promise<QaWindow> {
    const args = ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", WPF_HOST_SCRIPT]
    const child = spawn("powershell.exe", [...args, "-Title", `omo-qa-wpf-${tag}`], {
      stdio: ["ignore", "pipe", "inherit"],
    })
    this.track(child, "wpf-host.ps1")
    if (child.stdout === null) throw new Error("wpf-host.ps1 has no stdout")
    const lines = createInterface({ input: child.stdout })
    const ready = await hangGuard(
      new Promise<string>((resolve) => lines.once("line", resolve)),
      () => "hang guard: wpf-host.ps1 never reported ready",
    )
    const hwnd = /^ready (\d+)$/.exec(ready.trim())?.[1]
    if (hwnd === undefined) throw new Error(`wpf-host.ps1: ${ready}`)
    return waitForWindow(engine, (candidate) => candidate.id === hwnd, `WPF window ${hwnd}`)
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
    this.pids.add(engine.pid)
  }

  teardown(): string[] {
    for (const pid of this.pids) {
      if (isAlive(pid)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" })
    }
    const alive = [...this.pids].filter(isAlive)
    this.receipt(`killed tracked pids ${[...this.pids].join(",") || "(none)"}`)
    this.receipt(alive.length === 0 ? "procs 0" : `procs ${alive.length} alive: ${alive.join(",")}`)
    // Notepad can hold its file briefly after taskkill; rmSync retries EBUSY on its own.
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    this.receipt(existsSync(this.dir) ? `dir LEFT ${this.dir}` : `dir REMOVED ${this.dir}`)
    return this.receipts
  }
}
