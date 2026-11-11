// SP-W portal questions, asked on every compositor. Each one runs in its own fresh session and $HOME.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import {
  type Answer,
  type Compositor,
  brief,
  freshSession,
  outputRects,
  portal,
  rectKey,
  restartSession,
} from "./session-kit.ts"

const SWAY = "/probes/containers/sway"

// sway: the first grant picks HEADLESS-1 through a chooser; the restore leg swaps in a chooser that always fails.
async function xdpwConfig(home: string, which: "grant" | "deny") {
  mkdirSync(`${home}/.config/xdg-desktop-portal-wlr`, { recursive: true })
  copyFileSync(`${SWAY}/xdpw-${which}.ini`, `${home}/.config/xdg-desktop-portal-wlr/config`)
}
const prep = (c: Compositor) => (home: string) => (c === "sway" ? xdpwConfig(home, "grant") : Promise.resolve())

const SC_KEYS = [
  "result",
  "start_code",
  "start_ms",
  "restore_token_returned",
  "persist_mode_returned",
  "restore_file_mode",
  "streams",
]
const RD_KEYS = [
  "result",
  "start_code",
  "start_ms",
  "devices",
  "streams",
  "restore_token_returned",
  "clipboard_enabled",
  "clipboard_request",
]

const readLog = () =>
  ["dbus", "xdpw"]
    .map((n) => {
      try {
        return readFileSync(`/tmp/spw-logs/${n}.log`, "utf8")
      } catch {
        return ""
      }
    })
    .join("\n")

// The last backend complaint in the session bus log (activated portal backends write there).
function backendComplaint(): string {
  try {
    const lines = readLog().split("\n")
    return (
      lines
        .filter(
          (l) => /unable|failed|error|denied|not permitted/i.test(l) && !/fuse|RealtimeKit|Document portal/.test(l),
        )
        .slice(-2)
        .join(" | ")
        .slice(0, 300) || "none"
    )
  } catch {
    return "none"
  }
}

// The interface presence check (iface_probe.py): absent ONLY when the frontend's interface list came back without
// the name; a failed call is UNMEASURED with its error text, never CONTRADICTS.
const listed = (rec: Record<string, unknown>) =>
  Array.isArray(rec.interfaces)
    ? ` [${rec.interfaces.map((i) => String(i).replace("org.freedesktop.", "")).join(" ")}]`
    : ""

function presence(rec: Record<string, unknown>, nameKey = "iface_name"): Answer | null {
  const name = String(rec[nameKey] ?? rec.iface ?? "?")
  const err = rec.iface_error ?? rec.error
  if (rec.result === "interface_error" || err !== undefined)
    return {
      answer: null,
      observed: `call errored: ${String(err)}`,
      reason: `the interface check for ${name} errored (${String(err)}), so presence was not measured`,
    }
  if (rec.result === "interface_absent" || rec.absent === true)
    return {
      answer: false,
      observed: `enumerated ${String(rec.interfaces_enumerated)} interfaces${listed(rec)}, ${name} not among them`,
    }
  return null
}

function firstGrantFailed(rec: Record<string, unknown>, log: string): Answer | null {
  const p = presence(rec)
  if (p) return p
  if (rec.start_code === 0) return null
  const complaint = backendComplaint()
  if (/OpenGL compositing is required/.test(readLog())) {
    return {
      answer: null,
      observed: brief(rec, RD_KEYS),
      reason:
        "KWin refuses every stream here: 'OpenGL compositing is required for screencasting'. kwin_wayland --virtual composites with QPainter because this host exposes no DRM render node (/dev/dri absent), so none can be passed into the container",
    }
  }
  if (/unable to receive a valid format from wlr_screencopy/.test(readLog())) {
    return {
      answer: null,
      observed: brief(rec, RD_KEYS),
      reason:
        "xdg-desktop-portal-wlr: 'unable to receive a valid format from wlr_screencopy', so no stream starts and no token can be granted. sway runs headless on the pixman renderer because this host exposes no DRM render node (/dev/dri absent), so none can be passed into the container",
    }
  }
  const approver = log.trim() ? log.trim().split("\n").slice(-2).join(" ").slice(0, 300) : "not used"
  return {
    answer: null,
    observed: brief(rec, RD_KEYS),
    reason: `first grant not obtained (${rec.result}); backend log: ${complaint}; approver: ${approver}`,
  }
}

export async function scRestoreSession(c: Compositor): Promise<Answer> {
  const home = await freshSession(c, "sc-restore-session", prep(c))
  const tok = `${home}/screencast.token`
  const a = await portal(c, ["screencast", "--save-file", tok, "--timeout", "30"], true)
  const fail = firstGrantFailed(a.rec, a.approverLog)
  if (fail) return fail
  if (!a.rec.restore_token_returned)
    return { answer: false, observed: `first grant: ${brief(a.rec, SC_KEYS)}; no restore_token returned` }
  if (c === "sway") await xdpwConfig(home, "deny")
  await restartSession(c)
  const b = await portal(c, ["screencast", "--restore-file", tok, "--timeout", "15"], false)
  return {
    answer: b.rec.start_code === 0,
    observed: `first grant: ${brief(a.rec, SC_KEYS)}; after session restart, no dialog answered: ${brief(b.rec, SC_KEYS)}`,
  }
}

export async function rdRestore(c: Compositor, across: "engine" | "session"): Promise<Answer> {
  const home = await freshSession(c, `rd-restore-${across}`, prep(c))
  const tok = `${home}/remote.token`
  const a = await portal(c, ["remote", "--save-file", tok, "--timeout", "30"], true)
  const fail = firstGrantFailed(a.rec, a.approverLog)
  if (fail) return fail
  if (!a.rec.restore_token_returned)
    return { answer: false, observed: `first grant: ${brief(a.rec, RD_KEYS)}; no restore_token returned` }
  if (across === "session") await restartSession(c)
  const b = await portal(c, ["remote", "--restore-file", tok, "--timeout", "15"], false)
  return {
    answer: b.rec.start_code === 0,
    observed: `first grant: ${brief(a.rec, RD_KEYS)}; after ${across} restart, no dialog answered: ${brief(b.rec, RD_KEYS)}`,
  }
}

export async function globalShortcuts(c: Compositor): Promise<Answer> {
  await freshSession(c, "gs-version", prep(c))
  const r = await portal(c, ["iface", "GlobalShortcuts"], false)
  return (
    presence(r.rec, "iface") ?? {
      answer: true,
      observed: `enumerated ${String(r.rec.interfaces_enumerated)} interfaces${listed(r.rec)}, org.freedesktop.portal.GlobalShortcuts version ${String(r.rec.version)}`,
    }
  )
}

type Device = { event?: string; abs?: number; kbd?: number; regions?: { x: number; y: number; w: number; h: number }[] }
function helperDevices(raw: string): Device[] {
  return raw
    .split("\n")
    .filter((l) => l.includes('"helper"'))
    .map((l) => JSON.parse(l).helper)
    .filter((d: Device) => d.event === "device")
}

export async function eiRegions(c: Compositor, withStream: boolean): Promise<Answer> {
  await freshSession(c, withStream ? "ei-regions-combined" : "ei-regions-nostream", prep(c))
  const outs = await outputRects()
  const args = [
    "remote",
    "--eis-helper",
    "regions",
    "--hold-seconds",
    "3",
    "--timeout",
    "30",
    ...(withStream ? ["--screencast"] : []),
  ]
  const r = await portal(c, args, true)
  const fail = firstGrantFailed(r.rec, r.approverLog)
  if (fail) return fail
  if (r.rec.eis_connect_1 !== "ok") return { answer: false, observed: `ConnectToEIS: ${r.rec.eis_connect_1}` }
  const abs = helperDevices(r.raw).filter((d) => d.abs)
  const regions = abs.flatMap((d) => d.regions ?? [])
  const outKeys = outs.map(rectKey)
  const regionKeys = new Set(regions.map(rectKey))
  const seen = `outputs=[${outKeys.join(" ")}] abs_devices=${abs.length} regions=[${[...regionKeys].join(" ")}] (8px buckets)`
  if (withStream) return { answer: outKeys.length > 0 && outKeys.every((k) => regionKeys.has(k)), observed: seen }
  return { answer: regions.length > 0, observed: seen }
}

export async function secondConnect(c: Compositor): Promise<Answer> {
  await freshSession(c, "eis-second-connect", prep(c))
  const r = await portal(
    c,
    ["remote", "--eis-helper", "regions", "--hold-seconds", "2", "--second-eis", "--timeout", "30"],
    true,
  )
  const fail = firstGrantFailed(r.rec, r.approverLog)
  if (fail) return fail
  const report = (r.rec.eis_2_report ?? []) as { event?: string }[]
  const connected = report.some((e) => e.event === "connect") && !report.some((e) => e.event === "disconnect")
  return {
    answer: r.rec.eis_connect_1 === "ok" && r.rec.eis_connect_2 === "ok" && connected,
    observed: `first=${r.rec.eis_connect_1} second=${r.rec.eis_connect_2} second_events=[${report.map((e) => e.event).join(",")}] (first socket still open)`,
  }
}

export async function clipboardGrant(c: Compositor): Promise<Answer> {
  await freshSession(c, "clipboard-grant", prep(c))
  const v = await portal(c, ["iface", "Clipboard"], false)
  const clip = presence(v.rec, "iface")
  if (clip)
    return clip.answer === false
      ? { ...clip, observed: `${clip.observed}, so RequestClipboard cannot be granted` }
      : clip
  const r = await portal(c, ["remote", "--screencast", "--clipboard", "--timeout", "30"], true)
  const fail = firstGrantFailed(r.rec, r.approverLog)
  if (fail) return fail
  return {
    answer: r.rec.clipboard_enabled === true,
    observed: `Clipboard iface version=${JSON.stringify(r.rec.clipboard_iface_version)} ${brief(r.rec, RD_KEYS)}`,
  }
}
