#!/usr/bin/env bun
// SP-N: Windows background delivery numbers. A spike probe, not engine code.
//
//   bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --measure [--out <tsv>] [--host <label>] [--row <id>]...
//   bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --verify <tsv> [--host <label>] [--row <id>]...
//
// --measure runs every leg on this host and writes one ledger row per question
// and condition (rows of other hosts already in the file are kept). --verify
// measures the rows of this host again and exits 0 only when every verdict is
// identical. Both need a Windows interactive desktop and an elevated
// administrator shell; without one the probe prints one line naming the
// missing precondition, exits 2 and writes nothing. The questions are the SPEC
// table; the native calls are in sp-n.ps1 and its fragments beside this file.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const HERE = import.meta.dir
const HELPER = join(HERE, "sp-n.ps1")
const TARGET = join(HERE, "sp-n-target.ps1")
export const LEDGER = "crates/omo-computer-backend-win32/probes/win32-delivery.tsv"
const SELF = "crates/omo-computer-backend-win32/probes/probe-sp-n.ts"
export const HEADER = ["id", "question", "condition", "measured", "verdict", "rerun", "host", "build"] as const
export const H6 = "H6 Windows 11 VM"
const HOSTED = "hosted windows-latest"
const WARM = 5
const RUNS = 31
const FRAME_MS = 1000 / 60

export type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED"
type Result = { readonly measured: string; readonly verdict: Verdict }
type Json = { readonly [key: string]: unknown }
type Target = {
  readonly top: number
  readonly edit: number | undefined
  readonly state: string | undefined
  readonly title: string
}
type Killable = { kill(): void }
type Ctx = {
  tmp: string
  shared: string
  facts: Json
  targets: Map<string, Target>
  spawned: Killable[]
  // why a target did not start, keyed by its title
  notes: Map<string, string>
  // helper processes of the running group, killed when it runs out of budget
  live: Set<Killable>
  token: { aborted: boolean }
}
type Spec = { readonly question: string; readonly condition: string; readonly h6Only?: true }

// ------------------------------------------------------------------ the questions

const FAMILIES = [
  ["notepad", "Notepad (inbox; RichEditD2DPT or classic Edit)"],
  ["webview2", "a WebView2 host (WinForms + WebView2 textarea)"],
  ["wpf", "a WPF host (TextBox in HwndWrapper)"],
] as const
const FG = "foreground SendInput KEYEVENTF_UNICODE, one char per run"
const POSTED = "background PostMessageW WM_CHAR to the deepest focus window, target not foreground"
const CAPTURE_APIS = [
  ["wgc-monitor", "wgcMonitor", "WGC monitor capture TryGetNextFrame"],
  ["wgc-window", "wgcWindow", "WGC window capture TryGetNextFrame"],
  ["printwindow", "printWindow", "PrintWindow PW_RENDERFULLCONTENT"],
] as const
const CAPTURE_STATES = {
  active: "control: active console session, display on",
  "display-off": "GUID_CONSOLE_DISPLAY_STATE off on the console (SC_MONITORPOWER 2)",
  disconnected: "WTSConnectState == WTSDisconnected (session alive, console disconnected)",
  locked: "LockWorkStation (input desktop Winlogon)",
} as const
type CaptureState = keyof typeof CAPTURE_STATES
const AFFINITY_Q =
  "is a WS_EX_LAYERED overlay drawn with UpdateLayeredWindow and flagged WDA_EXCLUDEFROMCAPTURE excluded from capture"
const overlay = (what: string) =>
  `overlay over an overlapped Notepad window; ${what}; magenta fraction inside the overlay rect`
const ELEVATED = "medium-integrity process (runas /trustlevel:0x20000) against an elevated WinForms TextBox window"
const chordQ = (what: string) =>
  `does a posted ctrl+a act as the chord in ${what} (negative leg win-posted-ctrl-chord-negative)`

export const SPEC: Readonly<Record<string, Spec>> = {
  "n-host-admin": {
    question: "is the Windows desktop of host prerequisite H6 reachable with an administrator account",
    condition: "an interactive session of the run's administrator account",
    h6Only: true,
  },
  "n-host-second-monitor": {
    question: "does the Windows desktop of host prerequisite H6 have a second monitor",
    condition: "monitors attached to the interactive session",
    h6Only: true,
  },
  "n-wgc-issupported-session0": {
    question: "is GraphicsCaptureSession::IsSupported false in Session 0",
    condition: "SYSTEM scheduled task (Session 0)",
  },
  "n-wgc-issupported-interactive": {
    question: "control: does the same IsSupported read return true in the interactive session",
    condition: "elevated process in the interactive session",
  },
  "n-dwmflush-ms": {
    question: "what does DwmFlush cost before a foreground pointer event (old doc comment: 6 to 35 ms)",
    condition: "interactive session, composited desktop",
  },
  "n-poll-sleep1-ms": {
    question: "does a 1 ms barrier poll interval hold (old doc comment POLL = 1 ms)",
    condition: "Sleep(1), default timer resolution",
  },
  "n-poll-hrtimer1-ms": {
    question: "does a 1 ms barrier poll interval hold (old doc comment POLL = 1 ms)",
    condition: "high-resolution waitable timer, 1 ms",
  },
  ...Object.fromEntries(
    FAMILIES.flatMap(([key, label]) => [
      [
        `n-barrier-fg-proves-${key}`,
        {
          question: `does the hook-free barrier (sentinel VK 0xE8 routed hop + 1-px invalidate consumed hop) prove routed-and-consumed for ${label}`,
          condition: FG,
        },
      ],
      [
        `n-barrier-fg-ms-${key}`,
        {
          question: `what does the routed-and-consumed barrier cost for ${label} (old doc comment: well under a frame, 5 s hang guard)`,
          condition: FG,
        },
      ],
      [
        `n-barrier-posted-proves-${key}`,
        {
          question: `does the consumed hop prove a posted WM_CHAR landed in ${label}${key === "notepad" ? "" : " (drop matrix: background refused for this family)"}`,
          condition: POSTED,
        },
      ],
      [
        `n-barrier-posted-ms-${key}`,
        { question: `what does the consumed hop cost after a posted WM_CHAR to ${label}`, condition: POSTED },
      ],
    ]),
  ),
  "n-fg-chord-ctrl-a-notepad-control": {
    question: "control: does the same chord through SendInput act, so the oracle can see a chord",
    condition: "Notepad; foreground SendInput VK_CONTROL+A then Z",
  },
  "n-posted-chord-ctrl-a-notepad": {
    question: chordQ("Notepad"),
    condition: "posted WM_KEYDOWN VK_CONTROL, A down/up, VK_CONTROL up, then WM_CHAR Z; target not foreground",
  },
  "n-fg-chord-ctrl-a-classic-edit-control": {
    question: "control: does the same chord through SendInput act, so the oracle can see a chord",
    condition: "classic Edit; foreground SendInput VK_CONTROL+A then Z",
  },
  "n-posted-chord-ctrl-a-classic-edit": {
    question: chordQ("a classic Edit (WinForms TextBox)"),
    condition: "posted WM_KEYDOWN VK_CONTROL, A down/up, VK_CONTROL up, then WM_CHAR Z; target not foreground",
  },
  "n-wheel-after-raise-dwmflush": {
    question: "is a wheel sent after a raise and DwmFlush delivered (old doc comment: 18 of 18)",
    condition: "cover window raised, target raised, DwmFlush, SendInput wheel at the uncovered point",
  },
  "n-wheel-after-raise-5ms": {
    question: "is a wheel sent 5 ms after a raise lost (old doc comment: lost in 6 of 6)",
    condition: "cover window raised, target raised, 5 ms sleep, SendInput wheel at the uncovered point",
  },
  "n-affinity-control-wgc-monitor": {
    question: "control: does WGC monitor capture show the same overlay without the affinity flag",
    condition: overlay("no affinity, WGC monitor capture"),
  },
  "n-affinity-wgc-monitor": { question: AFFINITY_Q, condition: overlay("WDA_EXCLUDEFROMCAPTURE, WGC monitor capture") },
  "n-affinity-printwindow-overlapped": {
    question: AFFINITY_Q,
    condition: overlay("WDA_EXCLUDEFROMCAPTURE, PrintWindow PW_RENDERFULLCONTENT of the overlapped target"),
  },
  "n-affinity-wgc-window-overlapped": {
    question: AFFINITY_Q,
    condition: overlay("WDA_EXCLUDEFROMCAPTURE, WGC window capture of the overlapped target"),
  },
  "n-affinity-gdi-bitblt": {
    question: AFFINITY_Q,
    condition: overlay("WDA_EXCLUDEFROMCAPTURE, GDI screen BitBlt with CAPTUREBLT (third-party capture)"),
  },
  "n-affinity-wgc-monitor-secondary": {
    question: AFFINITY_Q,
    condition: "overlay on the second monitor, WGC monitor capture of that monitor",
    h6Only: true,
  },
  "n-uipi-sendinput": {
    question: "does SendInput under UIPI drop with last error 0",
    condition: `${ELEVATED}; target foreground`,
  },
  "n-uipi-postmessage": {
    question: "does a posted WM_CHAR to an elevated window get dropped by UIPI",
    condition: ELEVATED,
  },
  "n-elevated-printwindow": {
    question: "does PrintWindow capture an elevated window from medium integrity",
    condition: ELEVATED,
  },
  "n-elevated-wgc-window": {
    question: "does a WGC window capture of an elevated window work from medium integrity",
    condition: ELEVATED,
  },
  "n-elevated-uia-read": {
    question:
      "can UI Automation read an elevated window's edit value from medium integrity (engine answers elevated_target before any walk)",
    condition: ELEVATED,
  },
  ...Object.fromEntries(
    (Object.keys(CAPTURE_STATES) as CaptureState[]).flatMap((state) =>
      CAPTURE_APIS.map(([key, , api]) => [
        `n-capture-${key}-${state}`,
        {
          question:
            state === "active"
              ? `control: does ${api} return a frame in an active session`
              : `which of frame, null_frame and black_frame does ${api} return`,
          condition: CAPTURE_STATES[state],
        },
      ]),
    ),
  ),
}

// ------------------------------------------------------------------ JSON from the helper (untyped at the process boundary)

const obj = (v: unknown): Json => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : v === undefined || v === null ? [] : [obj(v)])
const num = (v: unknown): number => (typeof v === "number" ? v : Number.NaN)
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v))
const at = (j: Json, ...path: string[]): unknown => path.reduce<unknown>((v, k) => obj(v)[k], j)

// ------------------------------------------------------------------ helper processes

function fail(line: string): never {
  console.log(line)
  process.exit(2)
}

async function run(cmd: string[], live?: Set<Killable>): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  live?.add(p)
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { code, out: `${out}${err}`.trim() }
  } finally {
    live?.delete(p)
  }
}

async function leg(ctx: Ctx, name: string, arg: Json = {}): Promise<Json> {
  if (ctx.token.aborted) throw new Error(`leg ${name} not started: the group ran out of budget`)
  const argFile = join(ctx.tmp, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(argFile, JSON.stringify(arg))
  const r = await run(
    ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", HELPER, "-Leg", name, "-ArgFile", argFile],
    ctx.live,
  )
  const line = r.out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"))
    .at(-1)
  if (!line) throw new Error(`leg ${name} exited ${r.code}: ${r.out.split(/\r?\n/).slice(-3).join(" | ")}`)
  return obj(JSON.parse(line))
}

async function waitFile(path: string, ms: number): Promise<Json | undefined> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (existsSync(path)) {
      try {
        return obj(JSON.parse(readFileSync(path, "utf8")))
      } catch {
        // another process is still writing it; read again
      }
    }
    await Bun.sleep(100)
  }
  return undefined
}

function psCommand(ctx: Ctx, name: string, arg: Json, out: string): string {
  const argFile = join(ctx.shared, `${name}.arg.json`)
  writeFileSync(argFile, JSON.stringify(arg))
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ${HELPER} -Leg ${name} -ArgFile ${argFile} -Out ${out}`
}

// A leg as a medium-integrity process (basic-user trust level of this account).
async function medium(ctx: Ctx, name: string, arg: Json): Promise<Json | undefined> {
  const out = join(ctx.shared, `${name}.medium.json`)
  rmSync(out, { force: true })
  await run(["runas.exe", "/trustlevel:0x20000", psCommand(ctx, name, arg, out)], ctx.live)
  return waitFile(out, 90_000)
}

// A command as SYSTEM through a one-shot scheduled task (Session 0). The task runs a .cmd wrapper, because
// schtasks refuses a /TR command longer than 261 characters.
async function asSystem(ctx: Ctx, task: string, command: string): Promise<{ code: number; out: string }> {
  const name = `omo-sp-n-${task}`
  const wrapper = join(ctx.shared, `${name}.cmd`)
  writeFileSync(wrapper, `@echo off\r\n${command}\r\n`)
  const created = await run([
    "schtasks.exe",
    "/Create",
    "/TN",
    name,
    "/SC",
    "ONCE",
    "/ST",
    "00:00",
    "/RU",
    "SYSTEM",
    "/RL",
    "HIGHEST",
    "/TR",
    wrapper,
    "/F",
  ])
  return created.code === 0 ? run(["schtasks.exe", "/Run", "/TN", name]) : created
}
const dropTask = (task: string) => run(["schtasks.exe", "/Delete", "/TN", `omo-sp-n-${task}`, "/F"])

// ------------------------------------------------------------------ targets

async function startTarget(ctx: Ctx, kind: "edit" | "wpf" | "webview2", title: string, x: number, y: number) {
  const state = join(ctx.tmp, `${title}.state.json`)
  rmSync(state, { force: true })
  const cmd = [
    "powershell.exe",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    TARGET,
    "-Kind",
    kind,
    "-State",
    state,
    "-Title",
    title,
    "-X",
    String(x),
    "-Y",
    String(y),
  ]
  const errFile = join(ctx.tmp, `${title}.stderr.txt`)
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: Bun.file(errFile) })
  ctx.spawned.push(proc)
  const ready = await Promise.race([waitFile(state, 120_000), proc.exited.then(() => undefined)])
  if (!ready) {
    const why = existsSync(errFile) ? clean(readFileSync(errFile, "utf8")).slice(-200) : ""
    ctx.notes.set(
      title,
      `the ${title} target did not start${proc.exitCode !== null ? ` (exit ${proc.exitCode})` : " within 120 s"}${why ? `: ${why}` : ""}`,
    )
    return
  }
  const child = kind === "webview2" ? "Chrome_RenderWidgetHostHWND" : undefined
  let found = await leg(ctx, "find", { title, child })
  for (let i = 0; i < 20 && kind === "webview2" && !num(found.edit); i++) {
    await Bun.sleep(250)
    found = await leg(ctx, "find", { title, child })
  }
  const top = num(found.top)
  if (!top) return
  const edit = kind === "edit" ? num(ready.editHwnd) : kind === "wpf" ? top : num(found.edit) || undefined
  ctx.targets.set(title, { top, edit, state, title })
}

async function startNotepad(ctx: Ctx) {
  const before = await leg(ctx, "find", { cls: "Notepad" })
  // Tracked so it is ended with the run: an untracked live child kept the hosted --measure from exiting.
  ctx.spawned.push(Bun.spawn(["notepad.exe"], { stdout: "ignore", stderr: "ignore" }))
  const exclude = arr(before.all).length ? before.all : []
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(250)
    // Windows 11's Notepad edits in RichEditD2DPT; the classic Notepad of Windows Server in Edit.
    for (const child of ["RichEditD2DPT", "Edit"]) {
      const f = await leg(ctx, "find", { cls: "Notepad", exclude, child })
      if (num(f.top) && num(f.edit)) {
        ctx.targets.set("Notepad", { top: num(f.top), edit: num(f.edit), state: undefined, title: "Notepad" })
        return
      }
    }
  }
  ctx.notes.set("Notepad", "Notepad did not start: no Notepad window with a RichEditD2DPT or Edit child within 15 s")
}

const notStarted = (ctx: Ctx, title: string) => ctx.notes.get(title) ?? `the ${title} target did not start`

const oracle = (t: Target): Json => ({ top: t.top, edit: t.edit, state: t.state })

// ------------------------------------------------------------------ verdict helpers

const ms = (s: Json) =>
  num(s.n)
    ? `p50=${num(s.p50)}ms p95=${num(s.p95)}ms min=${num(s.min)}ms max=${num(s.max)}ms n=${num(s.n)} after ${WARM} warm-ups`
    : "no samples"
const count = (runs: unknown, key: string) => arr(runs).filter((r) => r[key] === true).length
const pick = (cond: boolean, yes: Verdict, no: Verdict): Verdict => (cond ? yes : no)
const UN = (reason: string): Result => ({ measured: `UNMEASURED: ${reason}`, verdict: "UNMEASURED" })
const tail = (v: unknown) => {
  const s = str(v)
  return JSON.stringify(s.length > 24 ? `...${s.slice(-24)}` : s)
}
const all = (ids: readonly string[], r: Result) => Object.fromEntries(ids.map((id) => [id, r]))

// ------------------------------------------------------------------ legs grouped by what they set up

type Group = {
  readonly ids: readonly string[]
  // The most this group may run before its rows are written UNMEASURED "timeout after Ns".
  readonly budgetS: number
  run(ctx: Ctx): Promise<Record<string, Result>>
}

const hostFacts: Group = {
  budgetS: 30,
  ids: ["n-host-admin", "n-host-second-monitor", "n-affinity-wgc-monitor-secondary"],
  async run(ctx) {
    const f = ctx.facts
    const monitors = arr(f.monitors)
    const admin =
      f.inAdministrators === true && f.elevated === true && num(f.sessionId) !== 0 && f.inputDesktop === "Default"
    return {
      "n-host-admin": {
        measured: `inAdministrators=${str(f.inAdministrators)} elevated=${str(f.elevated)} integrity=${str(f.integrity)} sessionId=${num(f.sessionId)} inputDesktop=${str(f.inputDesktop)} connectState=${num(f.connectState)}`,
        verdict: pick(admin, "CONFIRMS", "CONTRADICTS"),
      },
      "n-host-second-monitor": {
        measured: `monitors=${monitors.length} ${monitors.map((m) => `${num(m.w)}x${num(m.h)}@${num(m.x)},${num(m.y)}`).join(" ")}`,
        verdict: pick(monitors.length >= 2, "CONFIRMS", "CONTRADICTS"),
      },
      "n-affinity-wgc-monitor-secondary": UN(
        monitors.length >= 2
          ? "the second-monitor capture leg is not implemented in this probe"
          : `no second monitor on this host (monitors=${monitors.length})`,
      ),
    }
  },
}

const isSupported: Group = {
  budgetS: 120,
  ids: ["n-wgc-issupported-session0", "n-wgc-issupported-interactive"],
  async run(ctx) {
    const here = await leg(ctx, "issupported")
    const out = join(ctx.shared, "issupported.system.json")
    rmSync(out, { force: true })
    const started = await asSystem(ctx, "s0", psCommand(ctx, "issupported", {}, out))
    const s0 = started.code === 0 ? await waitFile(out, 90_000) : undefined
    await dropTask("s0")
    const read = (j: Json) =>
      `sessionId=${num(j.sessionId)} isSupported=${str(j.isSupported)} hresult=${num(j.hresult)}`
    return {
      "n-wgc-issupported-session0": !s0
        ? UN(`the SYSTEM task produced no result (schtasks: ${started.out.split(/\r?\n/)[0]})`)
        : {
            measured: read(s0),
            verdict: num(s0.sessionId) !== 0 ? "UNMEASURED" : pick(s0.isSupported === false, "CONFIRMS", "CONTRADICTS"),
          },
      "n-wgc-issupported-interactive": {
        measured: read(here),
        verdict: pick(here.isSupported === true, "CONFIRMS", "CONTRADICTS"),
      },
    }
  },
}

const timers: Group = {
  budgetS: 60,
  ids: ["n-dwmflush-ms", "n-poll-sleep1-ms", "n-poll-hrtimer1-ms"],
  async run(ctx) {
    const d = obj((await leg(ctx, "dwmflush", { warm: WARM, n: RUNS })).stats)
    const s = await leg(ctx, "sleep", { warm: WARM, n: RUNS })
    const sleep1 = obj(s.sleep1)
    const hr = obj(s.hrtimer1)
    return {
      "n-dwmflush-ms": {
        measured: `${ms(d)} hresult=${num(d.hresult)}`,
        verdict: num(d.hresult) !== 0 ? "NEW-EDGE" : pick(num(d.p95) <= 35, "CONFIRMS", "CONTRADICTS"),
      },
      "n-poll-sleep1-ms": { measured: ms(sleep1), verdict: pick(num(sleep1.p95) <= 2, "CONFIRMS", "CONTRADICTS") },
      "n-poll-hrtimer1-ms":
        hr.error !== undefined
          ? { measured: `CreateWaitableTimerExW error ${num(hr.error)}`, verdict: "NEW-EDGE" }
          : { measured: ms(hr), verdict: pick(num(hr.p95) <= 2, "CONFIRMS", "CONTRADICTS") },
    }
  },
}

const barriers: Group = {
  budgetS: 480,
  ids: FAMILIES.flatMap(([k]) => [
    `n-barrier-fg-proves-${k}`,
    `n-barrier-fg-ms-${k}`,
    `n-barrier-posted-proves-${k}`,
    `n-barrier-posted-ms-${k}`,
  ]),
  async run(ctx) {
    const out: Record<string, Result> = {}
    const away = ctx.targets.get("SPN-COVER")?.top
    for (const [key] of FAMILIES) {
      const ids = [
        `n-barrier-fg-proves-${key}`,
        `n-barrier-fg-ms-${key}`,
        `n-barrier-posted-proves-${key}`,
        `n-barrier-posted-ms-${key}`,
      ]
      const t = ctx.targets.get(key === "notepad" ? "Notepad" : key === "wpf" ? "SPN-WPF" : "SPN-WV2")
      if (!t) {
        Object.assign(
          out,
          all(ids, UN(notStarted(ctx, key === "notepad" ? "Notepad" : key === "wpf" ? "SPN-WPF" : "SPN-WV2"))),
        )
        continue
      }
      const fg = await leg(ctx, "fg-barrier", { ...oracle(t), ch: "x", warm: WARM, n: RUNS })
      const fgDone = count(fg.runs, "routed") === RUNS && count(fg.runs, "consumed") === RUNS
      const oracleSeen = count(fg.runs, "within2s") > 0
      if (fg.acquired !== true)
        Object.assign(out, all(ids.slice(0, 2), UN("the probe could not take the foreground for the target")))
      else {
        const measured = `sent ${count(fg.runs, "sent")}/${RUNS} routed ${count(fg.runs, "routed")}/${RUNS} consumed ${count(fg.runs, "consumed")}/${RUNS} effect at barrier return ${count(fg.runs, "atReturn")}/${RUNS} within 2 s ${count(fg.runs, "within2s")}/${RUNS} paint probe ${str(fg.probeClass)} foreground by ${str(fg.acquire)}`
        out[`n-barrier-fg-proves-${key}`] = {
          measured,
          verdict: !oracleSeen
            ? "UNMEASURED"
            : pick(fgDone && count(fg.runs, "atReturn") === RUNS, "CONFIRMS", "CONTRADICTS"),
        }
        out[`n-barrier-fg-ms-${key}`] = {
          measured: `${ms(obj(fg.stats))} hang-guard expiries ${RUNS - Math.min(count(fg.runs, "routed"), count(fg.runs, "consumed"))}`,
          verdict: pick(fgDone && num(at(fg, "stats", "p95")) < FRAME_MS, "CONFIRMS", "CONTRADICTS"),
        }
      }
      const po = await leg(ctx, "posted-barrier", { ...oracle(t), ch: "y", warm: WARM, n: RUNS, away })
      const poDone = count(po.runs, "consumed") === RUNS
      const measured = `posted ${count(po.runs, "posted")}/${RUNS} consumed ${count(po.runs, "consumed")}/${RUNS} effect at return ${count(po.runs, "atReturn")}/${RUNS} within 2 s ${count(po.runs, "within2s")}/${RUNS} dst ${str(po.dstClass)} targetForeground=${str(po.foregroundIsTarget)}`
      // Notepad must land; the drop matrix refuses the other two families, so nothing landing CONFIRMS it.
      const landed =
        key === "notepad" ? poDone && count(po.runs, "atReturn") === RUNS : count(po.runs, "within2s") === 0
      out[`n-barrier-posted-proves-${key}`] = oracleSeen
        ? { measured, verdict: pick(landed, "CONFIRMS", "CONTRADICTS") }
        : UN(`the effect oracle never saw a foreground char; ${measured}`)
      out[`n-barrier-posted-ms-${key}`] = {
        measured: `${ms(obj(po.stats))} hang-guard expiries ${RUNS - count(po.runs, "consumed")}`,
        verdict: pick(poDone && num(at(po, "stats", "p95")) < FRAME_MS, "CONFIRMS", "CONTRADICTS"),
      }
    }
    return out
  },
}

const chords: Group = {
  budgetS: 120,
  ids: [
    "n-fg-chord-ctrl-a-notepad-control",
    "n-posted-chord-ctrl-a-notepad",
    "n-fg-chord-ctrl-a-classic-edit-control",
    "n-posted-chord-ctrl-a-classic-edit",
  ],
  async run(ctx) {
    const out: Record<string, Result> = {}
    for (const [key, title] of [
      ["notepad", "Notepad"],
      ["classic-edit", "SPN-EDIT"],
    ] as const) {
      const t = ctx.targets.get(title)
      if (!t) {
        Object.assign(
          out,
          all([`n-fg-chord-ctrl-a-${key}-control`, `n-posted-chord-ctrl-a-${key}`], UN(notStarted(ctx, title))),
        )
        continue
      }
      const fg = await leg(ctx, "chord", { ...oracle(t), route: "fg" })
      const fgActs = fg.acquired === true && str(fg.after) === "Z"
      out[`n-fg-chord-ctrl-a-${key}-control`] =
        fg.acquired !== true
          ? UN("foreground not acquired")
          : {
              measured: `before=${tail(fg.before)} after=${tail(fg.after)} foreground by ${str(fg.acquire)}`,
              verdict: pick(fgActs, "CONFIRMS", "CONTRADICTS"),
            }
      const po = await leg(ctx, "chord", { ...oracle(t), route: "posted", away: ctx.targets.get("SPN-COVER")?.top })
      const before = str(po.before)
      const after = str(po.after)
      const measured = `before=${tail(before)} after=${tail(after)} dst ${str(po.dstClass)}`
      const verdict: Verdict =
        after === "Z"
          ? "CONTRADICTS"
          : after.startsWith(before) && after.slice(before.length).toLowerCase() === "az"
            ? "CONFIRMS"
            : "NEW-EDGE"
      out[`n-posted-chord-ctrl-a-${key}`] = fgActs
        ? { measured, verdict }
        : UN(`the SendInput control did not act; ${measured}`)
    }
    return out
  },
}

const wheel: Group = {
  budgetS: 120,
  ids: ["n-wheel-after-raise-dwmflush", "n-wheel-after-raise-5ms"],
  async run(ctx) {
    const t = ctx.targets.get("SPN-EDIT")
    const cover = ctx.targets.get("SPN-COVER")
    if (!t || !cover) return all(this.ids, UN(notStarted(ctx, t ? "SPN-COVER" : "SPN-EDIT")))
    const a = await leg(ctx, "wheel", { top: t.top, cover: cover.top, state: t.state, mode: "dwmflush", n: 18 })
    const b = await leg(ctx, "wheel", { top: t.top, cover: cover.top, state: t.state, mode: "delay", delayMs: 5, n: 6 })
    return {
      "n-wheel-after-raise-dwmflush": {
        measured: `delivered ${num(a.delivered)}/${num(a.runs)} foreground by ${str(a.acquire)}`,
        verdict: pick(num(a.delivered) === num(a.runs), "CONFIRMS", "CONTRADICTS"),
      },
      "n-wheel-after-raise-5ms": {
        measured: `lost ${num(b.runs) - num(b.delivered)}/${num(b.runs)} foreground by ${str(b.acquire)}`,
        verdict: pick(num(b.delivered) === 0, "CONFIRMS", "CONTRADICTS"),
      },
    }
  },
}

const affinity: Group = {
  budgetS: 120,
  ids: [
    "n-affinity-control-wgc-monitor",
    "n-affinity-wgc-monitor",
    "n-affinity-printwindow-overlapped",
    "n-affinity-wgc-window-overlapped",
    "n-affinity-gdi-bitblt",
  ],
  async run(ctx) {
    const t = ctx.targets.get("Notepad")
    if (!t) return all(this.ids, UN(notStarted(ctx, "Notepad")))
    const control = await leg(ctx, "affinity", { top: t.top, exclude: false })
    const ex = await leg(ctx, "affinity", { top: t.top, exclude: true })
    const m = (j: Json, k: string) => num(at(j, k, "magenta"))
    const seen = m(control, "wgcMonitor") >= 0.9
    const pre = seen ? "" : "UNMEASURED: the no-affinity control did not show the overlay; "
    const v = (x: number, oracleOk = seen): Verdict =>
      !oracleOk || !(x >= 0) ? "UNMEASURED" : pick(x < 0.01, "CONFIRMS", "CONTRADICTS")
    return {
      "n-affinity-control-wgc-monitor": {
        measured: `magenta=${m(control, "wgcMonitor")} gdi=${m(control, "gdiBitBlt")} affinityRead=${num(control.affinityRead)}`,
        verdict: pick(seen, "CONFIRMS", "CONTRADICTS"),
      },
      "n-affinity-wgc-monitor": {
        measured: `${pre}magenta=${m(ex, "wgcMonitor")} setAffinity=${str(ex.setAffinityOk)} affinityRead=0x${num(ex.affinityRead).toString(16)}`,
        verdict: v(m(ex, "wgcMonitor")),
      },
      "n-affinity-printwindow-overlapped": {
        measured: `${pre}magenta=${m(ex, "printWindow")} ok=${str(at(ex, "printWindow", "ok"))}`,
        verdict: v(m(ex, "printWindow")),
      },
      "n-affinity-wgc-window-overlapped": {
        measured: `${pre}magenta=${m(ex, "wgcWindow")} ${str(at(ex, "wgcWindow", "info", "error"))}`.trim(),
        verdict: v(m(ex, "wgcWindow")),
      },
      "n-affinity-gdi-bitblt": {
        measured: `${pre}magenta=${m(ex, "gdiBitBlt")} control=${m(control, "gdiBitBlt")}`,
        verdict: v(m(ex, "gdiBitBlt"), m(control, "gdiBitBlt") >= 0.9),
      },
    }
  },
}

const elevated: Group = {
  budgetS: 120,
  ids: [
    "n-uipi-sendinput",
    "n-uipi-postmessage",
    "n-elevated-printwindow",
    "n-elevated-wgc-window",
    "n-elevated-uia-read",
  ],
  async run(ctx) {
    const t = ctx.targets.get("SPN-ELEV")
    const state = t?.state
    if (!t || !state) return all(this.ids, UN(notStarted(ctx, "SPN-ELEV")))
    const before = str((await waitFile(state, 5000))?.text)
    const r = await medium(ctx, "uipi", { top: t.top, edit: t.edit })
    if (!r) return all(this.ids, UN("the medium-integrity helper produced no result"))
    await Bun.sleep(1000)
    const after = str((await waitFile(state, 5000))?.text)
    const got = (c: string) => after.split(c).length - before.split(c).length
    if (r.integrity !== "medium") return all(this.ids, UN(`helper integrity is ${str(r.integrity)}, not medium`))
    const fgOk = r.foregroundIsTarget === true
    const cls = (k: string) => str(at(r, k, "class"))
    return {
      "n-uipi-sendinput": {
        measured: `returned ${num(r.sendInputReturned)}/${num(r.sendInputOf)} lastError=${num(r.sendInputLastError)} chars arrived=${got("q")} targetForeground=${fgOk} foreground by ${str(r.acquire)}`,
        verdict: !fgOk
          ? "UNMEASURED"
          : pick(
              num(r.sendInputReturned) === num(r.sendInputOf) && num(r.sendInputLastError) === 0 && got("q") === 0,
              "CONFIRMS",
              "CONTRADICTS",
            ),
      },
      "n-uipi-postmessage": {
        measured: `PostMessageW returned ${str(r.postReturned)} lastError=${num(r.postLastError)} chars arrived=${got("w")}`,
        verdict: pick(got("w") === 0, "CONFIRMS", "CONTRADICTS"),
      },
      "n-elevated-printwindow": {
        measured: `class=${cls("printWindow")} ok=${str(at(r, "printWindow", "ok"))} nearBlack=${num(at(r, "printWindow", "nearBlack"))}`,
        verdict: pick(cls("printWindow") === "frame", "CONFIRMS", "CONTRADICTS"),
      },
      "n-elevated-wgc-window": {
        measured: `class=${cls("wgcWindow")} ${str(at(r, "wgcWindow", "info", "error"))}`.trim(),
        verdict: pick(cls("wgcWindow") === "frame", "CONFIRMS", "CONTRADICTS"),
      },
      "n-elevated-uia-read": {
        measured:
          `name=${tail(r.uiaName)} descendants=${num(r.uiaDescendants)} value=${tail(r.uiaValue)} ${str(r.uiaError)}`.trim(),
        verdict: pick(r.uiaValue === null || r.uiaValue === undefined, "CONFIRMS", "CONTRADICTS"),
      },
    }
  },
}

const captureIds = (state: CaptureState) => CAPTURE_APIS.map(([k]) => `n-capture-${k}-${state}`)
function captureResults(state: CaptureState, r: Json | undefined, skip?: string): Record<string, Result> {
  if (skip || !r) return all(captureIds(state), UN(skip ?? "no result"))
  const session = `connectState=${num(r.connectState)}->${num(r.connectStateAfter)} inputDesktop=${str(r.inputDesktop)}${r.displayStateDuring !== undefined ? ` displayState=${num(r.displayStateBefore)}->${num(r.displayStateDuring)}->${num(r.displayStateAfterWake)}` : ""}`
  return Object.fromEntries(
    CAPTURE_APIS.map(([k, field]) => {
      const c = obj(r[field])
      const cls = str(c.class)
      const measured = `class=${cls} nearBlack=${num(c.nearBlack)} ${str(at(c, "info", "error"))} ${session}`.replace(
        /\s+/g,
        " ",
      )
      const ok = state === "active" ? cls === "frame" : cls === "null_frame" || cls === "black_frame"
      return [`n-capture-${k}-${state}`, { measured, verdict: pick(ok, "CONFIRMS", "CONTRADICTS") }]
    }),
  )
}

// The disconnected and locked legs: a capture helper waits in this session
// while it changes state; a SYSTEM task (tscon) then reconnects it to the console.
async function sessionLeg(ctx: Ctx, t: Target, state: "disconnected" | "locked") {
  const sid = num(ctx.facts.sessionId)
  const out = join(ctx.shared, `capture-${state}.json`)
  rmSync(out, { force: true })
  const argFile = join(ctx.shared, `capture-${state}.arg.json`)
  writeFileSync(argFile, JSON.stringify({ top: t.top, delayMs: 8000 }))
  ctx.spawned.push(
    Bun.spawn(
      [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        HELPER,
        "-Leg",
        "capture",
        "-ArgFile",
        argFile,
        "-Out",
        out,
      ],
      { stdout: "ignore", stderr: "ignore" },
    ),
  )
  await Bun.sleep(1500)
  const changed = await leg(ctx, state === "disconnected" ? "disconnect" : "lock")
  const r = await waitFile(out, 60_000)
  const started = await asSystem(ctx, "tscon", `tscon.exe ${sid} /dest:console`)
  let back = `not-restored(schtasks=${started.code})`
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(500)
    const s = await leg(ctx, "disconnect-state", { sid }).catch(() => undefined)
    if (s && num(s.connectState) === 0 && s.inputDesktop === "Default") {
      back = "active"
      break
    }
  }
  await dropTask("tscon")
  const skip = !r
    ? "the capture helper produced no result"
    : state === "disconnected" && num(r.connectState) !== 4
      ? `session did not read WTSDisconnected (connectState=${num(r.connectState)}, ${JSON.stringify(changed)})`
      : state === "locked" && r.inputDesktop === "Default"
        ? "input desktop still Default after LockWorkStation"
        : undefined
  const res = captureResults(state, r, skip)
  return Object.fromEntries(
    Object.entries(res).map(([id, x]) => [id, { ...x, measured: `${x.measured} reconnect=${back}` }]),
  )
}

const capture: Group = {
  budgetS: 240,
  ids: (Object.keys(CAPTURE_STATES) as CaptureState[]).flatMap(captureIds),
  async run(ctx) {
    const t = ctx.targets.get("Notepad")
    if (!t) return all(this.ids, UN(notStarted(ctx, "Notepad")))
    const active = await leg(ctx, "capture", { top: t.top })
    const off = await leg(ctx, "capture", { top: t.top, displayOff: true })
    return {
      ...captureResults("active", active),
      ...captureResults(
        "display-off",
        off,
        num(off.displayStateDuring) === 0
          ? undefined
          : `GUID_CONSOLE_DISPLAY_STATE never read off (before=${num(off.displayStateBefore)} during=${num(off.displayStateDuring)})`,
      ),
      ...(await sessionLeg(ctx, t, "disconnected")),
      // Last: a lock the reconnect cannot end leaves the desktop unusable for later legs.
      ...(await sessionLeg(ctx, t, "locked")),
    }
  },
}

const GROUPS: readonly Group[] = [hostFacts, isSupported, timers, barriers, chords, wheel, affinity, elevated, capture]

// Budget of one --measure run: starting the target windows plus every group's own budget. The hosted job
// times out at 40 minutes; the probe must end well inside it.
export const SETUP_BUDGET_S = 300
export const TOTAL_BUDGET_S = SETUP_BUDGET_S + GROUPS.reduce((s, g) => s + g.budgetS, 0)
export const JOB_TIMEOUT_S = 40 * 60
export const MAX_TOTAL_BUDGET_S = 30 * 60

// Runs one group within its budget. Past it, the group's helper processes are killed, its later legs refuse
// to start, and every row it owns is UNMEASURED "timeout after Ns" (N the seconds it actually ran): never
// dropped, never a verdict.
export async function runGroup(g: Group, ctx: Ctx): Promise<Record<string, Result>> {
  const own: Ctx = { ...ctx, live: new Set(), token: { aborted: false } }
  const t0 = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), g.budgetS * 1000)
  })
  const done = g.run(own).catch((e: Error) => all(g.ids, UN(`leg failed: ${clean(e.message)}`)))
  const first = await Promise.race([done, expired])
  clearTimeout(timer)
  if (first !== "timeout") return first
  own.token.aborted = true
  for (const p of own.live) p.kill()
  return all(g.ids, UN(`timeout after ${Math.round((Date.now() - t0) / 1000)}s`))
}

// ------------------------------------------------------------------ ledger io

const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim()
type LedgerRow = Record<(typeof HEADER)[number], string>
export function readLedger(file: string): LedgerRow[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)
  if (lines[0] !== HEADER.join("\t")) fail(`LEDGER ${file}: header is not ${HEADER.join(",")}`)
  return lines.slice(1).map((l) => {
    const cells = l.split("\t")
    return Object.fromEntries(HEADER.map((h, i) => [h, cells[i] ?? ""])) as LedgerRow
  })
}
export const rerun = (id: string) => `bun ${SELF} --verify ${LEDGER} --row ${id}`
export const ledgerLine = (id: string, r: Result, host: string, build: string) => {
  const spec = SPEC[id] ?? { question: "unknown row", condition: "-" }
  return [id, spec.question, spec.condition, r.measured, r.verdict, rerun(id), host, build].map(clean).join("\t")
}

// ------------------------------------------------------------------ main

function args() {
  const argv = process.argv.slice(2)
  const rows: string[] = []
  let mode: "measure" | "verify" | undefined
  let file = LEDGER
  let host: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--measure") mode = "measure"
    else if (a === "--verify") {
      mode = "verify"
      file = argv[++i] ?? fail("USAGE --verify needs a ledger path")
    } else if (a === "--out") file = argv[++i] ?? fail("USAGE --out needs a path")
    else if (a === "--host") host = argv[++i] ?? fail("USAGE --host needs a label")
    else if (a === "--row") rows.push(argv[++i] ?? fail("USAGE --row needs an id"))
    else fail(`USAGE unknown argument ${a}`)
  }
  if (!mode) fail("USAGE --measure [--out <tsv>] | --verify <tsv> [--row <id>] [--host <label>]")
  return { mode, file, host, rows }
}

async function setup(ctx: Ctx, ids: readonly string[]) {
  const needs = (re: RegExp) => ids.some((id) => re.test(id))
  if (needs(/notepad|affinity|capture/)) await startNotepad(ctx)
  if (needs(/classic-edit|wheel|barrier|chord/)) {
    await startTarget(ctx, "edit", "SPN-EDIT", 640, 80)
    await startTarget(ctx, "edit", "SPN-COVER", 640, 80)
  }
  if (needs(/-wpf$/)) await startTarget(ctx, "wpf", "SPN-WPF", 80, 460)
  if (needs(/-webview2$/)) await startTarget(ctx, "webview2", "SPN-WV2", 640, 460)
  if (needs(/uipi|elevated/)) await startTarget(ctx, "edit", "SPN-ELEV", 360, 260)
}

// Linux-runnable checks of the probe's own bookkeeping (no Windows call): a leg past its budget becomes
// exactly one UNMEASURED "timeout after Ns" row per id, and the total budget stays under the job timeout.
async function selfTest(): Promise<never> {
  const failures: string[] = []
  const ctx: Ctx = {
    tmp: tmpdir(),
    shared: tmpdir(),
    facts: {},
    targets: new Map(),
    spawned: [],
    notes: new Map(),
    live: new Set(),
    token: { aborted: false },
  }
  const slow: Group = {
    ids: ["t-slow-a", "t-slow-b"],
    budgetS: 1,
    async run() {
      await Bun.sleep(3000)
      return all(this.ids, { measured: "ran to the end", verdict: "CONFIRMS" })
    },
  }
  const t0 = Date.now()
  const got = await runGroup(slow, ctx)
  const tookS = (Date.now() - t0) / 1000
  for (const id of slow.ids) {
    const r = got[id]
    if (r?.verdict !== "UNMEASURED" || r.measured !== "UNMEASURED: timeout after 1s")
      failures.push(`${id}: want UNMEASURED "UNMEASURED: timeout after 1s", got ${JSON.stringify(r)}`)
  }
  if (Object.keys(got).length !== slow.ids.length)
    failures.push(`rows: want ${slow.ids.length}, got ${Object.keys(got).length}`)
  if (tookS > 2) failures.push(`runGroup returned after ${tookS.toFixed(1)} s, budget 1 s`)
  const sum = SETUP_BUDGET_S + GROUPS.reduce((s, g) => s + g.budgetS, 0)
  if (TOTAL_BUDGET_S !== sum) failures.push(`TOTAL_BUDGET_S ${TOTAL_BUDGET_S} != setup + group budgets ${sum}`)
  if (!(TOTAL_BUDGET_S <= MAX_TOTAL_BUDGET_S && MAX_TOTAL_BUDGET_S < JOB_TIMEOUT_S))
    failures.push(
      `TOTAL_BUDGET_S ${TOTAL_BUDGET_S} s must be <= ${MAX_TOTAL_BUDGET_S} s, under the ${JOB_TIMEOUT_S} s job timeout`,
    )
  for (const f of failures) console.log(`SELF-TEST FAIL ${f}`)
  console.log(
    failures.length
      ? `SELF-TEST FAIL ${failures.length}`
      : `SELF-TEST PASS total budget ${TOTAL_BUDGET_S} s of ${JOB_TIMEOUT_S} s`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (process.argv[2] === "--self-test") await selfTest()
  const opt = args()
  if (process.platform !== "win32")
    fail(
      `PRECONDITION windows-interactive-desktop: SP-N measures a Windows interactive desktop; this host is ${process.platform}`,
    )
  const ctx: Ctx = {
    tmp: join(tmpdir(), `omo-sp-n-${process.pid}`),
    shared: join(process.env.ProgramData ?? "C:\\ProgramData", "omo-sp-n"),
    facts: {},
    targets: new Map(),
    spawned: [],
    notes: new Map(),
    live: new Set(),
    token: { aborted: false },
  }
  mkdirSync(ctx.tmp, { recursive: true })
  mkdirSync(ctx.shared, { recursive: true })
  const pre = await leg(ctx, "precondition").catch((e: Error) =>
    fail(`PRECONDITION windows-interactive-desktop: ${e.message}`),
  )
  if (pre.ok !== true) fail(`PRECONDITION windows-interactive-desktop: ${str(pre.reason)}`)
  ctx.facts = await leg(ctx, "facts")
  if (ctx.facts.elevated !== true)
    fail(
      `PRECONDITION elevated-administrator: the probe needs an elevated administrator shell (inAdministrators=${str(ctx.facts.inAdministrators)} integrity=${str(ctx.facts.integrity)})`,
    )
  const host = opt.host ?? (ctx.facts.github === true ? HOSTED : H6)
  const build = `${str(ctx.facts.build)} ${str(ctx.facts.displayVersion)} ${str(ctx.facts.arch)}`
    .replace(/\s+/g, " ")
    .trim()
  const ledger = opt.mode === "verify" ? readLedger(opt.file) : []
  if (opt.mode === "verify" && ledger.length === 0) fail(`LEDGER ${opt.file}: no rows to verify`)
  const fromLedger = ledger.filter((r) => r.host === host).map((r) => r.id)
  const want = new Set(
    opt.rows.length
      ? opt.rows
      : opt.mode === "verify"
        ? fromLedger
        : Object.keys(SPEC).filter((id) => host === H6 || !SPEC[id]?.h6Only),
  )
  if (want.size === 0) fail(`LEDGER ${opt.file}: no row for host "${host}"`)
  const groups = GROUPS.filter((g) => g.ids.some((id) => want.has(id)))
  const results: Record<string, Result> = {}
  try {
    const setupDone = await Promise.race([
      setup(
        ctx,
        groups.flatMap((g) => g.ids),
      ).then(() => true),
      Bun.sleep(SETUP_BUDGET_S * 1000).then(() => false),
    ])
    if (!setupDone) console.log(`SP-N setup ran past ${SETUP_BUDGET_S} s; targets not started yet are UNMEASURED`)
    for (const g of groups) Object.assign(results, await runGroup(g, ctx))
  } finally {
    const notepad = ctx.targets.get("Notepad")
    if (notepad) await leg(ctx, "close", { top: notepad.top }).catch(() => undefined)
    for (const p of ctx.spawned) p.kill()
    rmSync(ctx.tmp, { recursive: true, force: true })
    rmSync(ctx.shared, { recursive: true, force: true })
  }
  const ids = Object.keys(SPEC).filter((id) => want.has(id))
  if (opt.mode === "measure") {
    const kept = readLedger(opt.file).filter((r) => r.host !== host)
    const lines = [
      HEADER.join("\t"),
      ...kept.map((r) => HEADER.map((h) => r[h]).join("\t")),
      ...ids.map((id) => ledgerLine(id, results[id] ?? UN("no leg produced this row"), host, build)),
    ]
    writeFileSync(opt.file, `${lines.join("\n")}\n`)
    for (const id of ids)
      console.log(`${(results[id]?.verdict ?? "UNMEASURED").padEnd(11)} ${id}  ${clean(results[id]?.measured ?? "")}`)
    console.log(`SP-N measured ${ids.length} rows on ${host} (${build}) -> ${relative(process.cwd(), opt.file)}`)
    // Explicit: a child the probe could not end must not keep the run alive (the hosted job hung here).
    process.exit(0)
  }
  let diff = 0
  for (const l of ledger.filter((r) => want.has(r.id))) {
    const m = results[l.id]
    if (l.host !== host) console.log(`SKIP ${l.id} host=${l.host}`)
    else if (!m || m.verdict !== l.verdict) {
      diff++
      console.log(`DIFF ${l.id} ledger=${l.verdict} now=${m?.verdict ?? "missing"} ${clean(m?.measured ?? "")}`)
    } else console.log(`SAME ${l.id} ${m.verdict} ${clean(m.measured)}`)
  }
  console.log(`SP-N verify on ${host} (${build}): ${Object.keys(results).length} measured, ${diff} differing`)
  process.exit(diff === 0 ? 0 : 1)
}

if (import.meta.main) await main()
