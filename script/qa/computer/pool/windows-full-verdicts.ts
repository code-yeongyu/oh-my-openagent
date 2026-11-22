// Verdicts for the five hosted-Windows questions of the live tier, derived from the raw facts the probe
// (script/qa/computer/probes/hosted-windows-live.ps1) prints one JSON line per leg and run. The probe only
// observes; every rule that turns an observation into CONFIRMS, CONTRADICTS or UNMEASURED lives here.
// A finding needs its positive control in the same run; a failed read or an errored leg is never a negative.

export type Verdict = "CONFIRMS" | "CONTRADICTS" | "UNMEASURED"
export type Reading = { readonly verdict: Verdict; readonly evidence: string }
export type Facts = Readonly<Record<string, unknown>>

const MEDIUM = "S-1-16-8192"
const HIGH = "S-1-16-12288"
/** WTS_CONNECTSTATE_CLASS values read from WTSQuerySessionInformation(WTSConnectState). */
const WTS_ACTIVE = 0
const WTS_DISCONNECTED = 4
/** WTSINFOEX_LEVEL1 SessionFlags: 0 = WTS_SESSIONSTATE_LOCK, 1 = UNLOCK, -1 = unknown. */
const SESSION_LOCKED = 0
const SESSION_UNLOCKED = 1
/** 150 % of 96 DPI, read with GetDpiForMonitor(MDT_EFFECTIVE_DPI). */
const TARGET_DPI = 144
/** DPI_AWARENESS_PER_MONITOR_AWARE from GetAwarenessFromDpiAwarenessContext. */
const PER_MONITOR_AWARE = 2

const field = (o: unknown, k: string): unknown =>
  typeof o === "object" && o !== null && !Array.isArray(o)
    ? Object.entries(o).find(([key]) => key === k)?.[1]
    : undefined
const num = (o: unknown, k: string): number | null => {
  const v = field(o, k)
  return typeof v === "number" && Number.isFinite(v) ? v : null
}
const str = (o: unknown, k: string): string | null => {
  const v = field(o, k)
  return typeof v === "string" ? v : null
}
const yes = (o: unknown, k: string): boolean => field(o, k) === true
const list = (o: unknown, k: string): readonly unknown[] => {
  const v = field(o, k)
  return Array.isArray(v) ? v : []
}

const reading = (verdict: Verdict, evidence: string): Reading => ({ verdict, evidence })
const errored = (f: Facts): Reading | null => {
  const e = str(f, "error")
  return e ? reading("UNMEASURED", `leg errored: ${e}`) : null
}

export function verdictElevated(f: Facts): Reading {
  const err = errored(f)
  if (err) return err
  const worker = str(f, "workerLabel")
  const fixture = str(f, "fixtureLabel")
  const control = str(f, "controlLabel")
  if (worker !== MEDIUM || fixture !== HIGH || control !== HIGH)
    return reading("UNMEASURED", `boundary not established: worker=${worker} control=${control} fixture=${fixture}`)
  const c = field(f, "control")
  const m = field(f, "medium")
  const channels = (["post", "send"] as const).filter((ch) => yes(c, `${ch}Landed`))
  const labels = `worker=${worker} control=${control} fixture=${fixture}`
  if (channels.length === 0)
    return reading("UNMEASURED", `${labels}; no High control landed, so a Medium drop proves nothing`)
  const landed = channels.filter((ch) => yes(m, `${ch}Landed`))
  const detail = `${labels}; controls landed: ${channels.join(",")}; medium post ok=${yes(m, "postOk")} error=${num(m, "postError")}, SendInput count=${num(m, "sendCount")}`
  if (landed.length > 0)
    return reading(
      "CONTRADICTS",
      `medium ${landed.join(" and ")} landed in the High fixture (no UIPI boundary); ${detail}`,
    )
  return reading(
    "CONFIRMS",
    `medium input dropped on ${channels.join(" and ")} while the High control landed; ${detail}`,
  )
}

type SessionSample = {
  readonly ms: number
  readonly connect: number | null
  readonly lock: number | null
  readonly desktop: string | null
}
const samples = (f: Facts): readonly SessionSample[] =>
  list(f, "timeline").map((s) => ({
    ms: num(s, "ms") ?? 0,
    connect: num(s, "connect"),
    lock: num(s, "lock"),
    desktop: str(s, "desktop"),
  }))
const describe = (s: unknown): string =>
  `connect=${num(s, "connect")} lock=${num(s, "lock")} desktop=${str(s, "desktop")}`
const restored = (f: Facts): boolean => {
  const after = field(field(f, "restore"), "after")
  return (
    num(after, "connect") === WTS_ACTIVE &&
    num(after, "lock") === SESSION_UNLOCKED &&
    str(after, "desktop") === "Default"
  )
}
const restoreText = (f: Facts): string => {
  const r = field(f, "restore")
  return `restore task result=${num(r, "taskResult")} after ${describe(field(r, "after"))}`
}

export function verdictLock(f: Facts): Reading {
  const err = errored(f)
  if (err) return err
  const tl = samples(f)
  const locked = tl.find((s) => s.lock === SESSION_LOCKED)
  if (!locked)
    return reading(
      "UNMEASURED",
      `no WTS_SESSIONSTATE_LOCK read in ${tl.length} samples; a failed desktop read proves nothing`,
    )
  const seen = `lock flag read at ${locked.ms} ms; ${restoreText(f)}`
  if (!restored(f)) return reading("CONTRADICTS", `locked session not restored by a SYSTEM task; ${seen}`)
  return reading("CONFIRMS", `locked and restored (connected, unlocked, input desktop Default); ${seen}`)
}

export function verdictDisconnect(f: Facts): Reading {
  const err = errored(f)
  if (err) return err
  const tl = samples(f)
  const hold = num(f, "holdTargetMs") ?? 0
  const first = tl.findIndex((s) => s.connect === WTS_DISCONNECTED)
  const start = tl[first]
  if (!start) return reading("UNMEASURED", `WTSDisconnected never read in ${tl.length} samples`)
  const back = tl.slice(first).find((s) => s.connect !== WTS_DISCONNECTED && s.connect !== null)
  const last = tl[tl.length - 1] ?? start
  const held = (back ? back.ms : last.ms) - start.ms
  if (back && held < hold)
    return reading("CONTRADICTS", `reconnected by itself after ${held} ms (needed ${hold} ms held); ${describe(back)}`)
  const seen = `disconnected at ${start.ms} ms, held ${held} ms; ${restoreText(f)}`
  if (!restored(f)) return reading("CONTRADICTS", `disconnected session not restored; ${seen}`)
  return reading("CONFIRMS", seen)
}

export function verdictMixedDpi(f: Facts): Reading {
  const err = errored(f)
  if (err) return err
  const ins = field(f, "install")
  const steps = ["downloadOk", "certOk", "deviceOk", "driverOk"].filter((k) => !yes(ins, k))
  if (steps.length > 0)
    return reading("UNMEASURED", `driver install incomplete (${steps.join(",")} false): ${str(ins, "error") ?? "-"}`)
  const awareness = num(f, "awareness")
  if (awareness !== PER_MONITOR_AWARE)
    return reading("UNMEASURED", `DPI read from awareness ${awareness}, not per-monitor aware`)
  const mons = list(f, "monitors")
  const shown = mons.map((m) => `${yes(m, "primary") ? "primary" : "secondary"} dpi=${num(m, "dpi")}`).join("; ")
  const scaleSteps = `mode=${str(f, "mode") ?? "-"} setScale=${str(f, "setScale") || "ok"}`
  if (!mons.some((m) => yes(m, "primary")))
    return reading("UNMEASURED", `no primary monitor in the enumeration [${shown}]`)
  const secondary = mons.filter((m) => !yes(m, "primary"))
  if (secondary.length === 0)
    return reading("CONTRADICTS", `driver installed but only one monitor enumerated [${shown}]`)
  if (secondary.some((m) => num(m, "dpi") === TARGET_DPI))
    return reading("CONFIRMS", `${mons.length} monitors [${shown}]; ${scaleSteps}`)
  return reading("CONTRADICTS", `secondary never reached ${TARGET_DPI} effective DPI [${shown}]; ${scaleSteps}`)
}

export function verdictSecureDesktop(f: Facts): Reading {
  const err = errored(f)
  if (err) return err
  const worker = str(f, "workerLabel")
  if (worker !== MEDIUM) return reading("UNMEASURED", `runas not issued from Medium: worker=${worker}`)
  const lua = num(f, "enableLua")
  const policy = `EnableLUA=${lua} PromptOnSecureDesktop=${num(f, "promptOnSecureDesktop")} ConsentPromptBehaviorAdmin=${num(f, "consentPromptBehaviorAdmin")}`
  const desktops = list(f, "desktops").filter((d) => typeof d === "string")
  const seen = `${policy}; input desktops read [${desktops.join(",")}]`
  if (yes(f, "consentSeen") && desktops.includes("Winlogon"))
    return reading("CONFIRMS", `consent.exe up on Winlogon; ${seen}`)
  if (yes(f, "consentSeen")) return reading("UNMEASURED", `consent.exe up but Winlogon never read; ${seen}`)
  if (!yes(f, "controlSeen")) return reading("UNMEASURED", `process list missed its own control; ${seen}`)
  // EnableLUA=0 (no UAC) or ConsentPromptBehaviorAdmin=0 (administrators elevate without prompting): the policy read
  // itself says no prompt can appear, so the absence is a finding; with a prompting policy it is not.
  if (lua === 0 || num(f, "consentPromptBehaviorAdmin") === 0)
    return reading("CONTRADICTS", `no elevation prompt: ${seen}`)
  return reading("UNMEASURED", `no consent.exe under a prompting policy; ${seen}`)
}

export function combineRuns(readings: readonly Reading[]): Reading {
  const [first] = readings
  if (!first) return reading("UNMEASURED", "no facts for this leg")
  const same = readings.filter((r) => r.verdict === first.verdict).length
  if (same !== readings.length)
    return reading("UNMEASURED", `runs disagree: ${readings.map((r) => `${r.verdict} (${r.evidence})`).join(" | ")}`)
  return reading(first.verdict, `${same}/${readings.length} runs: ${first.evidence}`)
}
