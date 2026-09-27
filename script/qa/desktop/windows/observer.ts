// Runs observer.ps1 in its own PowerShell process: every fact a scenario asserts about the desktop
// comes from this independent read, never from the engine's own report.
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { asObject, type Json, type JsonObject } from "./engine"
import { HANG_GUARD_MS, probeUntil } from "./until"

const OBSERVER_SCRIPT = fileURLToPath(new URL("./observer.ps1", import.meta.url))

export interface WindowObservation {
  readonly exists: boolean
  readonly class?: string
  readonly pid?: number
  readonly processName?: string | null
  readonly controlType?: string | null
  readonly text?: string | null
  /** Which read produced `text`: `uia-find`, `uia-walk`, or `win32` (WM_GETTEXT on the Edit child). */
  readonly readVia?: string | null
  readonly readError?: string
}

export interface Observation {
  readonly foreground: number
  readonly foregroundClass: string
  readonly cursor: { readonly x: number; readonly y: number }
  readonly primaryScreen: { readonly width: number; readonly height: number }
  readonly runnerIntegrity: string | null
  readonly windows: Readonly<Record<string, WindowObservation>>
  readonly integrityRid?: number
  readonly raw: JsonObject
}

function numberField(object: JsonObject, key: string): number {
  const value = object[key]
  if (typeof value !== "number") throw new Error(`observer: ${key} is not a number: ${JSON.stringify(object)}`)
  return value
}

function optionalString(value: Json | undefined): string | null {
  if (value === null || value === undefined) return null
  return typeof value === "string" ? value : String(value)
}

function parseWindow(value: Json | undefined): WindowObservation {
  const entry = asObject(value)
  return {
    exists: entry.exists === true,
    ...(typeof entry.class === "string" ? { class: entry.class } : {}),
    ...(typeof entry.pid === "number" ? { pid: entry.pid } : {}),
    processName: optionalString(entry.processName),
    controlType: optionalString(entry.controlType),
    text: optionalString(entry.text),
    readVia: optionalString(entry.readVia),
    ...(typeof entry.readError === "string" ? { readError: entry.readError } : {}),
  }
}

function parseObservation(stdout: string): Observation {
  const parsed: Json = JSON.parse(stdout)
  const raw = asObject(parsed)
  const cursor = asObject(raw.cursor)
  const screen = asObject(raw.primaryScreen)
  const windows: Record<string, WindowObservation> = {}
  for (const [id, entry] of Object.entries(asObject(raw.windows ?? {}))) windows[id] = parseWindow(entry)
  const rid = raw.integrityRid
  return {
    foreground: numberField(raw, "foreground"),
    foregroundClass: typeof raw.foregroundClass === "string" ? raw.foregroundClass : "",
    cursor: { x: numberField(cursor, "x"), y: numberField(cursor, "y") },
    primaryScreen: { width: numberField(screen, "width"), height: numberField(screen, "height") },
    runnerIntegrity: typeof raw.runnerIntegrity === "string" ? raw.runnerIntegrity : null,
    windows,
    ...(typeof rid === "number" ? { integrityRid: rid } : {}),
    raw,
  }
}

export function observe(hwnds: readonly string[], integrityPid = 0): Promise<Observation> {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", OBSERVER_SCRIPT]
  args.push("-Hwnds", hwnds.join(","), "-IntegrityPid", String(integrityPid))
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", args, { timeout: HANG_GUARD_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`observer failed: ${error.message}\n${stderr}`))
        return
      }
      resolve(parseObservation(stdout))
    })
  })
}

/** Observes until `settled` holds; the last observation when the hang guard expires first. */
export function observeUntil(
  hwnds: readonly string[],
  settled: (observation: Observation) => boolean,
): Promise<Observation> {
  return probeUntil(() => observe(hwnds), settled)
}

export function windowText(observation: Observation, id: string): string {
  return observation.windows[id]?.text ?? ""
}

/** The engine's integrity label for a mandatory-label RID, as `integrity.rs` bands them. */
export function integrityLabel(rid: number | undefined): string | null {
  if (rid === undefined || rid < 0) return null
  if (rid >= 0x4000) return "system"
  if (rid >= 0x3000) return "high"
  if (rid >= 0x2000) return "medium"
  return "low"
}
