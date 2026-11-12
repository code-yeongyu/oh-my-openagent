// SP-W answer rules. Pure: no process, no bus. An answer (yes or no) comes only from a reading that could have come
// out the other way; every reader failure (crash, timeout, missing key, failed call) is UNMEASURED.
import type { Answer, WevEvent } from "./session-kit.ts"

type Rec = Record<string, unknown>

const has = (rec: Rec, key: string) => rec[key] !== undefined && rec[key] !== null
const short = (i: unknown) => String(i).replace("org.freedesktop.", "")
const listed = (rec: Rec) => (Array.isArray(rec.interfaces) ? ` [${rec.interfaces.map(short).join(" ")}]` : "")
const unmeasured = (observed: string, reason: string): Answer => ({ answer: null, observed, reason })

// Presence of a portal interface, read from one of portal.py's records:
//   "iface"   - the record of `portal.py iface <Name>`: {iface, version | absent+interfaces | error}
//   "session" - the record of `portal.py screencast|remote`: {iface_name, iface_version | result: interface_*}
// null = present (go on measuring). An absent answer carries `precondition`: the portal every later step needs.
export function presence(rec: Rec, kind: "iface" | "session"): Answer | null {
  const name = String(rec[kind === "iface" ? "iface" : "iface_name"] ?? "the portal interface")
  const err = kind === "iface" ? rec.error : rec.iface_error
  if (err !== undefined || rec.result === "interface_error")
    return unmeasured(
      `call errored: ${String(err)}`,
      `the interface check for ${name} errored, so presence was not measured`,
    )
  if (rec.absent === true || rec.result === "interface_absent")
    return {
      answer: false,
      observed: `enumerated ${String(rec.interfaces_enumerated)} interfaces${listed(rec)}, ${name} not among them`,
      precondition: name,
    }
  if (has(rec, kind === "iface" ? "version" : "iface_version")) return null
  return unmeasured(
    `no usable record: ${JSON.stringify(rec).slice(0, 200)}`,
    "the portal client left no presence result (crash, timeout or missing key), so nothing was measured",
  )
}

// GlobalShortcuts: the portal itself is the question, so an absent answer is a plain no (no precondition mark).
export function gsAnswer(rec: Rec): Answer {
  const p = presence(rec, "iface")
  if (p) return { answer: p.answer, observed: p.observed, ...(p.reason ? { reason: p.reason } : {}) }
  return {
    answer: true,
    observed: `enumerated ${String(rec.interfaces_enumerated)} interfaces${listed(rec)}, version ${String(rec.version)}`,
  }
}

// The restore leg ran with no dialog answerer: started = the token was honoured; timeout = a dialog waited, so it
// was not. Anything else (a backend error code, a crashed client) is not a reading of the token.
export function restoreAnswer(rec: Rec): boolean | null {
  if (presence(rec, "session")) return null
  if (rec.result === "started" && rec.start_code === 0) return true
  if (rec.result === "timeout") return false
  return null
}

export function parseGlobals(out: string, code: number): string[] | null {
  if (code !== 0) return null
  const g = [...out.matchAll(/interface: '([^']+)'/g)].map((m) => m[1] ?? "")
  return g.length ? g : null
}

export function gsettingsBool(out: string, code: number): boolean | null {
  const v = out.trim()
  if (code !== 0) return null
  return v === "true" ? true : v === "false" ? false : null
}

// One AT-SPI listing; a listing that names no application at all (not even the shell) is no reading.
export function appsFrom(out: string, code: number): string[] | null {
  if (code !== 0) return null
  const line = out
    .split("\n")
    .reverse()
    .find((l) => l.trim().startsWith("{"))
  if (!line) return null
  try {
    const apps: unknown = JSON.parse(line).apps
    return Array.isArray(apps) && apps.length ? apps.map(String) : null
  } catch {
    return null
  }
}

// The release read: the first `a`/`A` press the reader got after t0, and the depressed mask in force at it.
export function shiftedAtRead(events: readonly WevEvent[], t0: number): boolean | null {
  const key = events.find((e) => e.t > t0 && e.kind === "key" && e.pressed && (e.sym === "a" || e.sym === "A"))
  if (!key) return null
  const mods = [...events].reverse().find((e) => e.kind === "mods" && e.t <= key.t)
  return key.sym === "A" || ((mods?.depressed ?? 0) & 1) !== 0
}

export type ReleaseState = "proven" | "contradicted" | "unproven"

// control = the same read with the holder ALIVE (must be shifted, or the read cannot see a held modifier at all);
// kill = the read after the holder was SIGKILLed.
export function releaseVerdict(
  control: boolean | null,
  kill: boolean | null,
): { answer: boolean | null; state: ReleaseState; reason?: string } {
  if (control === null)
    return { answer: null, state: "unproven", reason: "the control leg (holder alive) produced no key at the reader" }
  if (!control)
    return {
      answer: null,
      state: "unproven",
      reason:
        "the control leg (holder alive) read came out unshifted: the reader cannot see a held modifier, so the method cannot discriminate",
    }
  if (kill === null)
    return { answer: null, state: "unproven", reason: "the kill leg produced no key at the reader within 2 s" }
  return kill ? { answer: false, state: "contradicted" } : { answer: true, state: "proven" }
}

// ---- readers that can see nothing ----

export type HelperEvent = {
  event?: string
  abs?: number
  kbd?: number
  regions?: { x: number; y: number; w: number; h: number }[]
}
const bucket8 = (n: number) => Math.round(n / 8) * 8
const regionKey = (r: { x: number; y: number; w: number; h: number }) =>
  `${bucket8(r.x)},${bucket8(r.y)},${bucket8(r.w)}x${bucket8(r.h)}`

// A libei helper's devices, only when it connected, announced at least one device, was not dropped, and ran its whole
// window (its closing "timeout" event); anything less is no reading.
export function eisDevices(events: readonly HelperEvent[]): HelperEvent[] | null {
  const kinds = events.map((e) => e.event)
  if (!kinds.includes("connect") || !kinds.includes("timeout") || kinds.includes("disconnect")) return null
  const devices = events.filter((e) => e.event === "device")
  return devices.length ? devices : null
}

// outKeys: the outputs' xdg-output rectangles in the same 8 px buckets as the regions.
export function regionsAnswer(
  withStream: boolean,
  outKeys: readonly string[],
  devices: readonly HelperEvent[] | null,
): boolean | null {
  if (devices === null || outKeys.length === 0) return null
  const regions = devices.filter((d) => d.abs).flatMap((d) => d.regions ?? [])
  if (!withStream) return regions.length > 0
  const keys = new Set(regions.map(regionKey))
  return outKeys.every((k) => keys.has(k))
}

// first, second: portal.py's "ok" or "error:<text>" for each ConnectToEIS; report: the second socket's helper events.
export function secondConnectAnswer(first: unknown, second: unknown, report: readonly HelperEvent[]): boolean | null {
  if (first !== "ok") return null
  if (typeof second === "string" && second.startsWith("error:")) return false
  if (second !== "ok") return null
  const kinds = report.map((e) => e.event)
  if (kinds.includes("connect") && kinds.includes("disconnect")) return false
  if (kinds.includes("connect") && kinds.includes("timeout")) return true
  return null
}

// rec: kde-pwm.py's record; firstPid: the older window (the target), secondPid: the newer, active one.
export function activateAnswer(rec: Record<string, unknown>, firstPid: number, secondPid: number): boolean | null {
  if (!firstPid || !secondPid || rec.bound !== true || rec.target_found !== true) return null
  if (rec.active_before !== secondPid || typeof rec.active_after !== "number") return null
  return rec.active_after === firstPid
}

// names: the last successful AT-SPI listing (null = none succeeded); appAlive: the app still ran when the window ended.
export function registryAnswer(
  names: readonly string[] | null,
  wanted: readonly string[],
  appAlive: boolean,
): boolean | null {
  if (names === null) return null
  if (names.some((n) => wanted.includes(n))) return true
  return appAlive ? false : null
}

// globals: wayland-info's list (null = no reading); cacheBuilt: the service cache that carries a desktop file built.
export function pwmAnswer(globals: readonly string[] | null, name: string, cacheBuilt: boolean): boolean | null {
  if (globals === null || !cacheBuilt) return null
  return globals.includes(name)
}
