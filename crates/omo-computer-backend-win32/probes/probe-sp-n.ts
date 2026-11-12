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
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"

const HERE = import.meta.dir
const HELPER = join(HERE, "sp-n.ps1")
const TARGET = join(HERE, "sp-n-target.ps1")
export const LEDGER = "crates/omo-computer-backend-win32/probes/win32-delivery.tsv"
const SELF = "crates/omo-computer-backend-win32/probes/probe-sp-n.ts"
// notes: free text kept across re-measures (for example a design decision that adopted the row), "-" when empty;
// never read as a verdict.
export const HEADER = ["id", "question", "condition", "measured", "verdict", "rerun", "host", "build", "notes"] as const
export const H6 = "H6 Windows 11 VM"
// sha256 of Microsoft.Web.WebView2 1.0.2903.40 from nuget.org; sp-n-target.ps1 refuses any other package
export const WEBVIEW2_NUPKG_SHA256 = "ef128016dd1e51c59178c827ed5b8aa3322c57afa8675d930f8109505542ad74"
const HOSTED = "hosted windows-latest"
const WARM = 5
const RUNS = 31
const FRAME_MS = 1000 / 60

// INVALID: a row measured by a probe with a known defect; kept with the reading, superseded by the next run.
export type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED" | "INVALID"
type Result = { readonly measured: string; readonly verdict: Verdict }
type Json = { readonly [key: string]: unknown }
type Target = {
  readonly top: number
  readonly edit: number | undefined
  readonly state: string | undefined
  readonly title: string
}
// pid and exited are present on real child processes; cleanup waits for exited, never only for kill()
type Killable = { kill(): void; readonly pid?: number; readonly exited?: Promise<unknown> }
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
  // work that must run even when the group runs out of budget (reconnect a session, drop a SYSTEM task)
  cleanups: Cleanup[]
  // target processes spawned but not ready yet, killed when setup runs out of budget
  pending: Map<string, Killable>
}
type Cleanup = { readonly name: string; run(ctx: Ctx): Promise<string> }
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
  "n-wheel-control-settled": {
    question: "control: is a wheel to a settled foreground target delivered (proves the wheel oracle can see a wheel)",
    condition: "target foreground and settled (pump, two DwmFlush), SendInput wheel at its centre, no raise",
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

// The environment of every child: this process's, without PSModulePath (any casing). A Windows PowerShell 5.1
// child that inherits pwsh 7's PSModulePath cannot load its own modules (hosted run 43133245569: Get-Acl's
// Microsoft.PowerShell.Security "could not be loaded"); without the variable it uses its own defaults.
export function childEnv(env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && k.toLowerCase() !== "psmodulepath") out[k] = v
  return out
}

async function run(cmd: string[], live?: Set<Killable>): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: childEnv() })
  live?.add(p)
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    return { code, out: `${out}${err}`.trim() }
  } finally {
    live?.delete(p)
  }
}

// One leg's JSON line; a leg that failed reports legError, which is raised here, never read as a result.
export function legResult(line: string, name: string): Json {
  const j = obj(JSON.parse(line))
  if (typeof j.legError === "string") throw new Error(`leg ${name} failed: ${j.legError}`)
  return j
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
  return legResult(line, name)
}

// The JSON a helper wrote to path, waiting up to ms for it. A file never written, a file still unreadable at the
// deadline (with its last parse error) and a helper's legError all reject: none of them is read as "no result".
export async function waitFile(path: string, ms: number): Promise<Json> {
  const end = Date.now() + ms
  let lastError = ""
  while (Date.now() < end) {
    if (existsSync(path)) {
      try {
        return legResult(readFileSync(path, "utf8"), basename(path))
      } catch (e) {
        const message = (e as Error).message
        // a helper that reported its own failure is final; a parse error may be a write in progress
        if (message.startsWith("leg ")) throw e
        lastError = message
      }
    }
    await Bun.sleep(100)
  }
  throw new Error(
    lastError
      ? `${basename(path)}: unreadable after ${ms / 1000} s: ${lastError}`
      : `${basename(path)}: not written within ${ms / 1000} s`,
  )
}

// Every path is quoted: the run's directories may contain spaces.
export function psCommand(dir: string, name: string, arg: Json, out: string): string {
  const argFile = join(dir, `${name}.arg.json`)
  writeFileSync(argFile, JSON.stringify(arg))
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${HELPER}" -Leg ${name} -ArgFile "${argFile}" -Out "${out}"`
}

// A leg as a medium-integrity process (basic-user trust level of this account). It cannot write the
// administrators-only shared directory, so its argument and result live in this user's run directory.
async function medium(ctx: Ctx, name: string, arg: Json): Promise<Json> {
  const out = join(ctx.tmp, `${name}.medium.json`)
  rmSync(out, { force: true })
  await run(["runas.exe", "/trustlevel:0x20000", psCommand(ctx.tmp, name, arg, out)], ctx.live)
  return waitFile(out, 60_000)
}

// A command as SYSTEM through a one-shot scheduled task (Session 0). The task runs a .cmd wrapper, because
// schtasks refuses a /TR command longer than 261 characters.
async function asSystem(ctx: Ctx, task: string, command: string): Promise<{ code: number; out: string }> {
  if (ctx.token.aborted) throw new Error(`SYSTEM task ${task} not started: the group ran out of budget`)
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
    `"${wrapper}"`,
    "/F",
  ])
  return created.code === 0 ? run(["schtasks.exe", "/Run", "/TN", name]) : created
}
const dropTask = async (task: string) =>
  (await run(["schtasks.exe", "/Delete", "/TN", `omo-sp-n-${task}`, "/F"])).code === 0 ? "dropped" : "drop-failed"

// ------------------------------------------------------------------ targets

async function startTarget(ctx: Ctx, kind: "edit" | "wpf" | "webview2", title: string, x: number, y: number) {
  if (ctx.token.aborted) return
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
    // the WebView2 SDK is extracted fresh into this administrators-only, per-run directory
    ...(kind === "webview2" ? ["-Work", join(ctx.shared, `wv2-${title}`)] : []),
  ]
  const errFile = join(ctx.tmp, `${title}.stderr.txt`)
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: Bun.file(errFile), env: childEnv() })
  ctx.spawned.push(proc)
  ctx.pending.set(title, proc)
  const ready = await Promise.race([
    waitFile(state, 60_000).catch((e: Error) => e),
    proc.exited.then((code) => new Error(`exited ${code} before it was ready`)),
  ])
  ctx.pending.delete(title)
  if (ready instanceof Error) {
    const why = existsSync(errFile) ? clean(readFileSync(errFile, "utf8")).slice(-200) : ""
    ctx.notes.set(title, `the ${title} target did not start: ${ready.message}${why ? `; stderr: ${why}` : ""}`)
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
  if (ctx.token.aborted) return
  const before = await leg(ctx, "find", { cls: "Notepad" })
  // Tracked so it is ended with the run: an untracked live child kept the hosted --measure from exiting.
  ctx.spawned.push(Bun.spawn(["notepad.exe"], { stdout: "ignore", stderr: "ignore", env: childEnv() }))
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

// A timing row decides only outside a 10 % band around its limit; inside it one run cannot decide, so two
// back-to-back runs (--measure then --verify) do not flip between CONFIRMS and CONTRADICTS.
export const TIMING_BAND = 0.1
export function timingVerdict(p95: number, limit: number, measured: string): Result {
  if (!Number.isFinite(p95)) return UN(`no samples; ${measured}`)
  if (p95 <= limit * (1 - TIMING_BAND)) return { measured, verdict: "CONFIRMS" }
  if (p95 > limit * (1 + TIMING_BAND)) return { measured, verdict: "CONTRADICTS" }
  return UN(`p95 ${p95} ms within ${TIMING_BAND * 100} % of the ${Number(limit.toFixed(3))} ms limit; ${measured}`)
}

// The wheel rows count only when the settled-foreground control delivered every wheel: without that, a 0 could
// be an oracle that cannot see a wheel.
type Tally = { readonly delivered: number; readonly runs: number; readonly acquire?: string }
export function wheelResults(control: Tally, flush: Tally, delay: Tally): Record<string, Result> {
  const c = `control delivered ${control.delivered}/${control.runs}`
  const proven = control.runs > 0 && control.delivered === control.runs
  const why = `the settled-foreground ${c}, so the wheel oracle is not proven`
  return {
    "n-wheel-control-settled": {
      measured: `${c} foreground by ${control.acquire ?? "-"}`,
      verdict: pick(proven, "CONFIRMS", "CONTRADICTS"),
    },
    "n-wheel-after-raise-dwmflush": proven
      ? {
          measured: `delivered ${flush.delivered}/${flush.runs}; ${c}; foreground by ${flush.acquire ?? "-"}`,
          verdict: pick(flush.runs > 0 && flush.delivered === flush.runs, "CONFIRMS", "CONTRADICTS"),
        }
      : UN(`${why}; delivered ${flush.delivered}/${flush.runs}`),
    "n-wheel-after-raise-5ms": proven
      ? {
          measured: `lost ${delay.runs - delay.delivered}/${delay.runs}; ${c}; foreground by ${delay.acquire ?? "-"}`,
          verdict: pick(delay.runs > 0 && delay.delivered === 0, "CONFIRMS", "CONTRADICTS"),
        }
      : UN(`${why}; lost ${delay.runs - delay.delivered}/${delay.runs}`),
  }
}
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
  // extra time its cleanups may take after a timeout (counted in the run budget)
  readonly cleanupS?: number
  run(ctx: Ctx): Promise<Record<string, Result>>
}

const hostFacts: Group = {
  budgetS: 15,
  ids: ["n-host-admin", "n-host-second-monitor", "n-affinity-wgc-monitor-secondary"],
  async run(ctx) {
    const f = ctx.facts
    const monitors = arr(f.monitors)
    const admin =
      f.inAdministrators === true && f.elevated === true && num(f.sessionId) !== 0 && f.inputDesktop === "Default"
    return {
      "n-host-admin": {
        measured: `inAdministrators=${str(f.inAdministrators)} elevated=${str(f.elevated)} integrity=${str(f.integrity)} sessionId=${num(f.sessionId)} inputDesktop=${str(f.inputDesktop)} connectState=${str(f.connectState)}`,
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
  budgetS: 60,
  cleanupS: 15,
  ids: ["n-wgc-issupported-session0", "n-wgc-issupported-interactive"],
  async run(ctx) {
    const here = await leg(ctx, "issupported")
    const out = join(ctx.shared, "issupported.system.json")
    rmSync(out, { force: true })
    const drop: Cleanup = { name: "drop-s0", run: () => dropTask("s0") }
    ctx.cleanups.push(drop)
    const started = await asSystem(ctx, "s0", psCommand(ctx.shared, "issupported", {}, out))
    const s0 =
      started.code === 0
        ? await waitFile(out, 45_000).catch((e: Error) => e)
        : new Error(`schtasks: ${started.out.split(/\r?\n/)[0]}`)
    ctx.cleanups.splice(ctx.cleanups.indexOf(drop), 1)
    await dropTask("s0")
    const read = (j: Json) =>
      `sessionId=${num(j.sessionId)} isSupported=${str(j.isSupported)} hresult=${num(j.hresult)}`
    return {
      "n-wgc-issupported-session0":
        s0 instanceof Error
          ? UN(`the SYSTEM task produced no result: ${s0.message}`)
          : {
              measured: read(s0),
              verdict:
                num(s0.sessionId) !== 0 ? "UNMEASURED" : pick(s0.isSupported === false, "CONFIRMS", "CONTRADICTS"),
            },
      "n-wgc-issupported-interactive": {
        measured: read(here),
        verdict: pick(here.isSupported === true, "CONFIRMS", "CONTRADICTS"),
      },
    }
  },
}

const timers: Group = {
  budgetS: 15,
  ids: ["n-dwmflush-ms", "n-poll-sleep1-ms", "n-poll-hrtimer1-ms"],
  async run(ctx) {
    const d = obj((await leg(ctx, "dwmflush", { warm: WARM, n: RUNS })).stats)
    const s = await leg(ctx, "sleep", { warm: WARM, n: RUNS })
    const sleep1 = obj(s.sleep1)
    const hr = obj(s.hrtimer1)
    return {
      "n-dwmflush-ms":
        num(d.hresult) !== 0
          ? { measured: `${ms(d)} hresult=${num(d.hresult)}`, verdict: "NEW-EDGE" }
          : timingVerdict(num(d.p95), 35, `${ms(d)} hresult=${num(d.hresult)}`),
      "n-poll-sleep1-ms": timingVerdict(num(sleep1.p95), 2, ms(sleep1)),
      "n-poll-hrtimer1-ms":
        hr.error !== undefined
          ? { measured: `CreateWaitableTimerExW error ${num(hr.error)}`, verdict: "NEW-EDGE" }
          : timingVerdict(num(hr.p95), 2, ms(hr)),
    }
  },
}

const barriers: Group = {
  budgetS: 200,
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
      try {
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
          const fgMs = `${ms(obj(fg.stats))} hang-guard expiries ${RUNS - Math.min(count(fg.runs, "routed"), count(fg.runs, "consumed"))} not foreground ${count(fg.runs, "notForeground")}/${RUNS}`
          out[`n-barrier-fg-ms-${key}`] = fgDone
            ? timingVerdict(num(at(fg, "stats", "p95")), FRAME_MS, fgMs)
            : { measured: fgMs, verdict: "CONTRADICTS" }
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
        const poMs = `${ms(obj(po.stats))} hang-guard expiries ${RUNS - count(po.runs, "consumed")}`
        out[`n-barrier-posted-ms-${key}`] = poDone
          ? timingVerdict(num(at(po, "stats", "p95")), FRAME_MS, poMs)
          : { measured: poMs, verdict: "CONTRADICTS" }
      } catch (e) {
        // one family's failed leg makes only its own rows UNMEASURED, with the leg's error
        const missing = ids.filter((id) => !(id in out))
        Object.assign(out, all(missing, UN(`leg failed: ${clean((e as Error).message)}`)))
      }
    }
    return out
  },
}

const chords: Group = {
  budgetS: 45,
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
      try {
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
      } catch (e) {
        // one family's failed leg makes only its own rows UNMEASURED, with the leg's error
        const missing = [`n-fg-chord-ctrl-a-${key}-control`, `n-posted-chord-ctrl-a-${key}`].filter(
          (id) => !(id in out),
        )
        Object.assign(out, all(missing, UN(`leg failed: ${clean((e as Error).message)}`)))
      }
    }
    return out
  },
}

const wheel: Group = {
  budgetS: 80,
  ids: ["n-wheel-control-settled", "n-wheel-after-raise-dwmflush", "n-wheel-after-raise-5ms"],
  async run(ctx) {
    const t = ctx.targets.get("SPN-EDIT")
    const cover = ctx.targets.get("SPN-COVER")
    if (!t || !cover) return all(this.ids, UN(notStarted(ctx, t ? "SPN-COVER" : "SPN-EDIT")))
    const base = { top: t.top, cover: cover.top, state: t.state }
    const tally = (j: Json): Tally => ({ delivered: num(j.delivered), runs: num(j.runs), acquire: str(j.acquire) })
    const control = await leg(ctx, "wheel", { ...base, mode: "settled", n: 6 })
    const flush = await leg(ctx, "wheel", { ...base, mode: "dwmflush", n: 18 })
    const delay = await leg(ctx, "wheel", { ...base, mode: "delay", delayMs: 5, n: 6 })
    return wheelResults(tally(control), tally(flush), tally(delay))
  },
}

const affinity: Group = {
  budgetS: 60,
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

// The elevated UIA read: CONFIRMS only when the query completed and explicitly found no value.
export function uiaResult(r: Json): Result {
  const measured = `name=${tail(r.uiaName)} descendants=${num(r.uiaDescendants)} value=${tail(r.uiaValue)}`
  if (typeof r.uiaError === "string") return UN(`the UIA read failed: ${r.uiaError}; ${measured}`)
  if (r.uiaQueried !== true) return UN(`the UIA read did not complete; ${measured}`)
  return { measured, verdict: pick(r.uiaValue === null, "CONFIRMS", "CONTRADICTS") }
}

const elevated: Group = {
  budgetS: 65,
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
    await Bun.sleep(1000)
    const after = str((await waitFile(state, 5000))?.text)
    const got = (c: string) => after.split(c).length - before.split(c).length
    if (r.integrity !== "medium") return all(this.ids, UN(`helper integrity is ${str(r.integrity)}, not medium`))
    // nothing was typed unless the target held the foreground at the send (SendCharsTo)
    const fgOk = r.foregroundIsTarget === true && r.notForeground !== true
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
      "n-elevated-uia-read": uiaResult(r),
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

// Reconnects the session to the console through a SYSTEM task (tscon), then drops the task; the result
// ("active", or why not) is written into the rows.
async function restoreSession(ctx: Ctx, sid: number): Promise<string> {
  const started = await asSystem(ctx, "tscon", `tscon.exe ${sid} /dest:console`).catch((e: Error) => ({
    code: Number.NaN,
    out: e.message,
  }))
  let back = `not-restored(schtasks ${Number.isNaN(started.code) ? "not started" : `exit ${started.code}`}: ${clean(started.out).slice(0, 120)})`
  let lastRead = ""
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(500)
    const s = await leg(ctx, "disconnect-state", { sid }).catch((e: Error) => e)
    if (s instanceof Error) {
      lastRead = s.message
      continue
    }
    if (num(s.connectState) === 0 && s.inputDesktop === "Default") {
      back = "active"
      lastRead = ""
      break
    }
    lastRead = `connectState=${num(s.connectState)} inputDesktop=${str(s.inputDesktop)}`
  }
  return `${back}${lastRead ? `; last read: ${clean(lastRead).slice(0, 160)}` : ""},task-${await dropTask("tscon")}`
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
      { stdout: "ignore", stderr: "ignore", env: childEnv() },
    ),
  )
  await Bun.sleep(1500)
  // Registered before the session changes: if the group runs out of budget, runGroup still reconnects.
  const reconnect: Cleanup = { name: `reconnect-${state}`, run: (c) => restoreSession(c, sid) }
  ctx.cleanups.push(reconnect)
  const changed = await leg(ctx, state === "disconnected" ? "disconnect" : "lock")
  const read = await waitFile(out, 30_000).catch((e: Error) => e)
  const r = read instanceof Error ? undefined : read
  ctx.cleanups.splice(ctx.cleanups.indexOf(reconnect), 1)
  const back = await restoreSession(ctx, sid)
  const skip = !r
    ? `the capture helper produced no result: ${read instanceof Error ? read.message : "-"}`
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
  budgetS: 130,
  cleanupS: 30,
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

// Budget of one probe pass (--measure or --verify): starting the targets, then every group with the time its
// cleanups may take after a timeout. The self-test checks the hosted workflow's passes fit its job timeout.
export const SETUP_BUDGET_S = 120
// ending children (bounded wait for their exit) and removing the run's directories (bounded retries), after the ledger
export const CLEANUP_BUDGET_S = 30
export const TOTAL_BUDGET_S =
  SETUP_BUDGET_S + GROUPS.reduce((s, g) => s + g.budgetS + (g.cleanupS ?? 0), 0) + CLEANUP_BUDGET_S
// job steps outside the probe (checkout, bun, precondition, upload: about 30 s observed) and the margin kept free
export const JOB_OVERHEAD_S = 120
export const JOB_RESERVE_S = 300
// share of the job timeout that must stay unused after both passes, overhead and the reserve
export const JOB_MIN_MARGIN = 0.1

type Budgeted<T> =
  | { readonly timedOut: false; readonly value: T; readonly cleanup: readonly string[] }
  | { readonly timedOut: true; readonly elapsedS: number; readonly cleanup: readonly string[] }

async function bounded<T>(p: Promise<T>, s: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), s * 1000)
  })
  try {
    return await Promise.race([p, expired])
  } finally {
    clearTimeout(timer)
  }
}

// Runs fn under its own token, live set and cleanup list. Past budgetS: the token is aborted (later legs, SYSTEM
// tasks and target spawns refuse to start), the live helpers and the not-yet-ready targets are killed. In every
// case the cleanups still registered then run, each bounded by cleanupS, before this returns, so a reconnect or
// a task drop happens before the caller removes the shared directory or exits.
export async function withBudget<T>(
  budgetS: number,
  cleanupS: number,
  ctx: Ctx,
  fn: (own: Ctx) => Promise<T>,
): Promise<Budgeted<T>> {
  const own: Ctx = { ...ctx, live: new Set(), token: { aborted: false }, cleanups: [] }
  const t0 = Date.now()
  const first = await bounded(fn(own), budgetS)
  const elapsedS = Math.round((Date.now() - t0) / 1000)
  if (first === "timeout") {
    own.token.aborted = true
    for (const p of own.live) p.kill()
    for (const [title, p] of own.pending) {
      p.kill()
      own.pending.delete(title)
      own.notes.set(title, `the ${title} target did not start within the ${budgetS} s setup budget`)
    }
  }
  const after: Ctx = { ...own, live: new Set(), token: { aborted: false } }
  const cleanup: string[] = []
  for (const c of own.cleanups.splice(0)) {
    const r = await bounded(
      c.run(after).catch((e: Error) => `failed(${clean(e.message)})`),
      Math.max(1, cleanupS),
    )
    cleanup.push(`${c.name}=${r}`)
  }
  return first === "timeout" ? { timedOut: true, elapsedS, cleanup } : { timedOut: false, value: first, cleanup }
}

// Runs one group within its budget. A group past it writes every row it owns as UNMEASURED "timeout after Ns"
// (N the seconds it actually ran), followed by its cleanup results: never dropped, never a verdict.
export async function runGroup(g: Group, ctx: Ctx): Promise<Record<string, Result>> {
  const r = await withBudget(g.budgetS, g.cleanupS ?? 0, ctx, (own) =>
    g.run(own).catch((e: Error) => all(g.ids, UN(`leg failed: ${clean(e.message)}`))),
  )
  if (!r.timedOut) return r.value
  return all(g.ids, UN(`timeout after ${r.elapsedS}s${r.cleanup.length ? `; cleanup ${r.cleanup.join(" ")}` : ""}`))
}

// Starts the targets within SETUP_BUDGET_S; a target not ready by then is killed and its rows say why.
export async function runSetup(ctx: Ctx, budgetS: number, start: (own: Ctx) => Promise<void>): Promise<boolean> {
  return !(await withBudget(budgetS, 0, ctx, start)).timedOut
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
// The rows a --measure writes: every row of other hosts, and every row of this host it did not re-measure, keep
// their place; re-measured rows replace theirs in place; new ones are appended.
export function mergeLedger(before: readonly LedgerRow[], host: string, fresh: ReadonlyMap<string, string>): string[] {
  const done = new Set<string>()
  const lines = before.map((r) => {
    if (r.host !== host || !fresh.has(r.id)) return HEADER.map((h) => r[h]).join("\t")
    done.add(r.id)
    return fresh.get(r.id) ?? ""
  })
  for (const [id, line] of fresh) if (!done.has(id)) lines.push(line)
  return [HEADER.join("\t"), ...lines]
}
// A note survives a re-measure, except a probe-defect or SUSPECT note: the re-measure is what supersedes it.
export const carriedNote = (n: string | undefined) =>
  n && n !== "-" && !n.startsWith("probe defect") && !n.startsWith("SUSPECT") ? n : "-"
export const rerun = (id: string) => `bun ${SELF} --verify ${LEDGER} --row ${id}`
export const ledgerLine = (id: string, r: Result, host: string, build: string, notes = "-") => {
  const spec = SPEC[id] ?? { question: "unknown row", condition: "-" }
  return [id, spec.question, spec.condition, r.measured, r.verdict, rerun(id), host, build, notes].map(clean).join("\t")
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

// Creates the run's shared directory: a fresh name that must not exist yet (a pre-existing directory is refused,
// never reused), then, on Windows, only SYSTEM and Administrators may access it, owned by Administrators.
export async function freshDir(path: string, lockDown: (p: string) => Promise<string | undefined>): Promise<string> {
  try {
    mkdirSync(path)
  } catch (e) {
    throw new Error(`REFUSED ${path}: ${(e as Error).message.split(":")[0]} (a pre-existing directory is never reused)`)
  }
  const problem = await lockDown(path)
  if (problem) {
    rmSync(path, { recursive: true, force: true })
    throw new Error(`REFUSED ${path}: ${problem}`)
  }
  return path
}

// What is wrong with an ACL read of the shared directory, or undefined. A failed read reports its own error.
const SID = /^S-1-(?:\d+-)*\d+$/
export const ADMINISTRATORS_SID = "S-1-5-32-544"
export const SYSTEM_SID = "S-1-5-18"
export function aclProblem(j: Json): string | undefined {
  if (typeof j.legError === "string") return `ACL read failed: ${j.legError}`
  if (typeof j.ownerError === "string") return `owner read failed: ${j.ownerError}`
  const owner = str(j.owner)
  // compared by SID only: a name, an SDDL alias or icacls text is never trusted, even when it looks right
  if (!SID.test(owner)) return `owner read returned ${owner ? `"${owner}", not a SID` : "nothing"}`
  if (owner !== ADMINISTRATORS_SID) return `owner is ${owner}, not Administrators (${ADMINISTRATORS_SID})`
  const sidErrors = arr(j.sidErrors).map((e) => str(e.error))
  if (sidErrors.length) return `access entries not translated to SIDs: ${sidErrors.join("; ")}`
  const sids = (Array.isArray(j.sids) ? j.sids.map(str) : str(j.sids).split(",")).filter(Boolean)
  const notSid = sids.filter((x) => !SID.test(x))
  if (notSid.length) return `access entries are not SIDs: ${notSid.join(",")}`
  const got = [...new Set(sids)].sort().join(",")
  const want = [SYSTEM_SID, ADMINISTRATORS_SID].sort().join(",")
  return got === want ? undefined : `access list is ${got || "empty"}, not SYSTEM and Administrators only`
}

// The ACL is read back by a leg (no PowerShell code on a command line), which emits the ACL or its error.
async function lockDownWindows(ctx: Ctx, p: string): Promise<string | undefined> {
  const set = await run([
    "icacls.exe",
    p,
    "/inheritance:r",
    "/grant:r",
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F",
  ])
  if (set.code !== 0) return `icacls grant exited ${set.code}: ${clean(set.out).slice(-200)}`
  const own = await run(["icacls.exe", p, "/setowner", "*S-1-5-32-544"])
  if (own.code !== 0) return `icacls setowner exited ${own.code}: ${clean(own.out).slice(-200)}`
  return aclProblem(await leg(ctx, "acl", { path: p }).catch((e: Error) => ({ legError: e.message })))
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

// ------------------------------------------------------------------ run end: ledger first, then cleanup

// Ends every child and waits up to ms for each to EXIT. killTree (taskkill /T /F on Windows) also ends
// grandchildren, such as WebView2's msedgewebview2 processes that keep files open in the shared directory.
// Returns the pids still running at the deadline.
export async function endChildren(
  procs: readonly Killable[],
  ms: number,
  killTree?: (pid: number) => Promise<unknown>,
): Promise<number[]> {
  for (const p of procs) {
    if (killTree && p.pid !== undefined) await killTree(p.pid).catch(() => p.kill())
    else p.kill()
  }
  const left = await Promise.all(
    procs.map(async (p) =>
      (await bounded(p.exited ?? Promise.resolve(), ms / 1000)) === "timeout" ? (p.pid ?? -1) : undefined,
    ),
  )
  return left.filter((pid): pid is number => pid !== undefined)
}

// Removes a directory, retrying a busy one (EBUSY, EPERM, ENOTEMPTY) with a growing delay: tries attempts spread
// over about totalMs. A final failure is returned as a warning, never thrown.
export async function removeDir(
  path: string,
  rm: (p: string) => void = (p) => rmSync(p, { recursive: true, force: true }),
  tries = 10,
  totalMs = 5000,
): Promise<string | undefined> {
  const unit = totalMs / ((tries * (tries - 1)) / 2 || 1)
  let last = ""
  for (let i = 0; i < tries; i++) {
    try {
      rm(path)
      return undefined
    } catch (e) {
      last = (e as Error).message
      // already gone: nothing left to remove
      if ((e as { code?: string }).code === "ENOENT" || /^ENOENT\b/.test(last)) return undefined
      if (i < tries - 1) await Bun.sleep(Math.round(unit * (i + 1)))
    }
  }
  return `could not remove ${path} after ${tries} tries over about ${totalMs / 1000} s: ${clean(last)}`
}

// The end of a run. The measurement runs, then its output is written (the ledger, or the verify comparison),
// even when the measurement threw, and only then the cleanup runs. A cleanup failure is a warning line: it never
// discards the written output and never changes the exit code. Errors are reported in order: the
// measurement's first, the cleanup's second.
export async function runThenClean(
  measure: () => Promise<void>,
  write: (measureError: Error | undefined) => number,
  cleanup: () => Promise<string[]>,
  cleanupBudgetS = CLEANUP_BUDGET_S,
): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
  const lines: string[] = []
  let measureError: Error | undefined
  try {
    await measure()
  } catch (e) {
    measureError = e as Error
    lines.push(`SP-N ERROR (measurement): ${clean(measureError.message)}`)
  }
  let exitCode: number
  try {
    exitCode = write(measureError)
  } catch (e) {
    lines.push(`SP-N ERROR (writing the result): ${clean((e as Error).message)}`)
    exitCode = 1
  }
  if (measureError) exitCode = exitCode || 1
  const warnings = await bounded(
    cleanup().catch((e: Error) => [`cleanup threw: ${clean(e.message)}`]),
    cleanupBudgetS,
  )
  for (const w of warnings === "timeout" ? [`cleanup ran past ${cleanupBudgetS} s`] : warnings)
    lines.push(`SP-N WARNING (cleanup): ${w}`)
  return { exitCode, lines }
}

// ------------------------------------------------------------------ self-test
// Checks that need no Windows. logicChecks run first in every --measure and --verify, so the hosted workflow
// runs them with the probe; --self-test adds the ledger checks. Each failure names the review finding it guards.
type Check = { readonly finding: string; run(): Promise<string | undefined> }
const never = () => new Promise<never>(() => {})
const testCtx = (): Ctx => ({
  tmp: tmpdir(),
  shared: tmpdir(),
  facts: {},
  targets: new Map(),
  spawned: [],
  notes: new Map(),
  live: new Set(),
  token: { aborted: false },
  cleanups: [],
  pending: new Map(),
})
const source = (file: string) => readFileSync(join(HERE, file), "utf8")
const LEG_FILES = ["sp-n-legs-delivery.ps1", "sp-n-legs-capture.ps1", "sp-n-legs-session.ps1"]
const legsSource = () => LEG_FILES.map(source).join("\n")
const WORKFLOW = join(HERE, "..", "..", "..", ".github", "workflows", "computer-spike-windows.yml")

// Lines of PowerShell loops (for / foreach / while / do) whose body holds a return: in a loop, return leaves the
// whole leg function and skips its Emit.
export function returnsInLoops(source: string): string[] {
  // line comments are blanked (same length, so line numbers hold): a comment may say "return"
  const ps = source.replace(/(^|\s)#[^\n]*/g, (m) => m.replace(/[^\n]/g, " "))
  const hits: string[] = []
  const loop = /\b(?:for|foreach|while)\s*\(|\bdo\s*\{/gi
  for (let m = loop.exec(ps); m; m = loop.exec(ps)) {
    let i = m.index + m[0].length
    if (m[0].endsWith("(")) {
      for (let depth = 1; i < ps.length && depth > 0; i++) depth += ps[i] === "(" ? 1 : ps[i] === ")" ? -1 : 0
      while (i < ps.length && /\s/.test(ps[i] ?? "")) i++
      if (ps[i] !== "{") continue
      i++
    }
    const start = i
    for (let depth = 1; i < ps.length && depth > 0; i++) depth += ps[i] === "{" ? 1 : ps[i] === "}" ? -1 : 0
    if (/\breturn\b/i.test(ps.slice(start, i - 1))) hits.push(`line ${ps.slice(0, m.index).split("\n").length}`)
  }
  return hits
}

const LOGIC_CHECKS: readonly Check[] = [
  {
    finding: "HIGH wheel-return-in-loop",
    async run() {
      if (returnsInLoops("while ($x) { if ($y) { return } }").length !== 1)
        return "the loop scanner misses a known case"
      if (returnsInLoops("while ($x) { # never return here\n break }").length !== 0)
        return "the loop scanner counts a comment"
      const hits = LEG_FILES.flatMap((f) => returnsInLoops(source(f)).map((h) => `${f} ${h}`))
      return hits.length ? `return inside a loop body: ${hits.join(", ")}` : undefined
    },
  },
  {
    finding: "HIGH wheel-positive-control",
    async run() {
      const blind = wheelResults({ delivered: 0, runs: 6 }, { delivered: 0, runs: 18 }, { delivered: 6, runs: 6 })
      const seen = wheelResults({ delivered: 6, runs: 6 }, { delivered: 18, runs: 18 }, { delivered: 0, runs: 6 })
      if (blind["n-wheel-after-raise-dwmflush"]?.verdict !== "UNMEASURED")
        return "a blind control still gives a wheel verdict"
      if (blind["n-wheel-after-raise-5ms"]?.verdict !== "UNMEASURED")
        return "a blind control still gives a 5 ms verdict"
      if (seen["n-wheel-after-raise-dwmflush"]?.verdict !== "CONFIRMS")
        return "a proven control with 18/18 is not CONFIRMS"
      if (!seen["n-wheel-after-raise-dwmflush"]?.measured.includes("control delivered 6/6"))
        return "the control is not in the row"
      if (!wheel.ids.includes("n-wheel-control-settled")) return "the wheel group has no control row"
      if (!/mode -eq 'settled'/.test(source("sp-n-legs-delivery.ps1"))) return "Leg-wheel has no settled control mode"
      return undefined
    },
  },
  {
    finding: "MEDIUM shared-dir-quoting",
    async run() {
      const dir = join(tmpdir(), `omo sp n self test ${process.pid}`)
      mkdirSync(dir, { recursive: true })
      try {
        const out = join(dir, "o.json")
        const cmd = psCommand(dir, "x", {}, out)
        const want = [`-File "${HELPER}"`, `-ArgFile "${join(dir, "x.arg.json")}"`, `-Out "${out}"`]
        const missing = want.filter((w) => !cmd.includes(w))
        return missing.length ? `unquoted path in: ${cmd}` : undefined
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
  {
    finding: "MEDIUM shared-dir-fresh",
    async run() {
      const dir = join(tmpdir(), `omo-sp-n-self-test-${process.pid}`)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
      try {
        const reused = await freshDir(dir, async () => undefined).then(
          () => "a pre-existing directory was reused",
          (e: Error) => (/REFUSED/.test(e.message) ? undefined : e.message),
        )
        if (reused) return reused
        rmSync(dir, { recursive: true, force: true })
        const denied = await freshDir(dir, async () => "owner is someone else").then(
          () => "a directory failing its ACL check was accepted",
          () => (existsSync(dir) ? "a refused directory was left behind" : undefined),
        )
        if (denied) return denied
        await freshDir(dir, async () => undefined)
        return existsSync(dir) ? undefined : "a fresh directory was not created"
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
  {
    finding: "MEDIUM shared-dir-acl",
    async run() {
      const self = source("probe-sp-n.ts")
      if (/mkdirSync\(ctx\.shared/.test(self)) return "the shared directory is still created with mkdirSync"
      if (!/freshDir\(ctx\.shared, \(p\) => lockDownWindows\(ctx, p\)\)/.test(self))
        return "the shared directory is not created by freshDir"
      if (!/omo-sp-n-\$\{process\.pid\}-\$\{randomBytes/.test(self))
        return "the shared directory name is not unpredictable"
      return /S-1-5-18:\(OI\)\(CI\)F/.test(self) && /S-1-5-32-544:\(OI\)\(CI\)F/.test(self)
        ? undefined
        : "no SYSTEM/Administrators-only grant"
    },
  },
  {
    finding: "MEDIUM webview2-integrity",
    async run() {
      const s = source("sp-n-target.ps1")
      if (!s.includes("$pkgSha256 = '" + WEBVIEW2_NUPKG_SHA256 + "'"))
        return "the nupkg sha256 is not recorded in the repo"
      if (/SPN_WEBVIEW2_NUPKG_SHA256/.test(s)) return "the nupkg check can still be switched off by an env variable"
      if (/Test-Path \$pkgDir/.test(s)) return "an extracted cache is still reused"
      if (!/ReadAllBytes\(\$nupkg\)/.test(s)) return "the nupkg is not hashed and extracted from the same bytes"
      return /\$Work/.test(s) ? undefined : "no per-run extraction directory"
    },
  },
  {
    finding: "MEDIUM budget-workflow",
    async run() {
      if (!existsSync(WORKFLOW)) return `workflow not found at ${WORKFLOW}`
      const yml = readFileSync(WORKFLOW, "utf8")
      const passes = (yml.match(/probe-sp-n\.ts --(?:measure|verify)\b/g) ?? []).length
      const timeoutS = Number(/timeout-minutes:\s*(\d+)/.exec(yml)?.[1] ?? 0) * 60
      const sum = SETUP_BUDGET_S + GROUPS.reduce((s, g) => s + g.budgetS + (g.cleanupS ?? 0), 0) + CLEANUP_BUDGET_S
      if (TOTAL_BUDGET_S !== sum) return `TOTAL_BUDGET_S ${TOTAL_BUDGET_S} != setup + group budgets ${sum}`
      const spent = passes * TOTAL_BUDGET_S + JOB_OVERHEAD_S + JOB_RESERVE_S
      const allowed = Math.floor(timeoutS * (1 - JOB_MIN_MARGIN))
      if (passes < 1 || !timeoutS) return `workflow has ${passes} probe passes and timeout ${timeoutS} s`
      return spent <= allowed
        ? undefined
        : `${passes} passes x ${TOTAL_BUDGET_S} s + ${JOB_OVERHEAD_S} s overhead + ${JOB_RESERVE_S} s reserve = ${spent} s > ${allowed} s (${JOB_MIN_MARGIN * 100} % of the ${timeoutS} s job timeout kept free)`
    },
  },
  {
    finding: "MEDIUM timeout-cleanup",
    async run() {
      const plain = await runGroup({ ids: ["t-a", "t-b"], budgetS: 1, run: never }, testCtx())
      for (const id of ["t-a", "t-b"])
        if (plain[id]?.verdict !== "UNMEASURED" || plain[id]?.measured !== "UNMEASURED: timeout after 1s")
          return `${id}: want "UNMEASURED: timeout after 1s", got ${JSON.stringify(plain[id])}`
      let cleaned = false
      const withCleanup = await runGroup(
        {
          ids: ["t-c"],
          budgetS: 1,
          cleanupS: 2,
          async run(c) {
            c.cleanups.push({
              name: "reconnect",
              run: async () => {
                cleaned = true
                return "active"
              },
            })
            return never()
          },
        },
        testCtx(),
      )
      if (!cleaned) return "the cleanup did not run before runGroup returned"
      const m = withCleanup["t-c"]?.measured
      return m === "UNMEASURED: timeout after 1s; cleanup reconnect=active"
        ? undefined
        : `cleanup result not recorded: ${m}`
    },
  },
  {
    finding: "LOW measure-row-keeps-host",
    async run() {
      const row = (id: string, host: string): LedgerRow =>
        Object.fromEntries(HEADER.map((h) => [h, h === "id" ? id : h === "host" ? host : "x"])) as LedgerRow
      const lines = mergeLedger([row("A", "h"), row("B", "h"), row("C", "o")], "h", new Map([["A", "A-new"]]))
      if (lines.length !== 4 || lines[1] !== "A-new" || !lines[2]?.startsWith("B\t") || !lines[3]?.startsWith("C\t"))
        return `--row A dropped or moved rows: ${JSON.stringify(lines.slice(1).map((l) => l.split("\t")[0]))}`
      if (carriedNote("probe defect (return-in-loop); superseded by the next run") !== "-")
        return "a probe-defect note survives its re-measure"
      return carriedNote("design-adopted (x)") === "design-adopted (x)"
        ? undefined
        : "a design note is lost on re-measure"
    },
  },
  {
    finding: "LOW foreground-before-send",
    async run() {
      const legs = legsSource()
      if (/\[SpN\]::Send(?:Chars|Chord)\(/.test(legs)) return "a leg sends input without the foreground check"
      return /GetForegroundWindow\(\) != h/.test(source("sp-n-native-input.ps1"))
        ? undefined
        : "SendCharsTo does not check the foreground"
    },
  },
  {
    finding: "LOW last-error",
    async run() {
      return /GetLastWin32Error/.test(legsSource())
        ? "a leg reads the last error from PowerShell after a P/Invoke"
        : undefined
    },
  },
  {
    finding: "LOW setup-stops",
    async run() {
      let late = false
      let killed = false
      const ctx = testCtx()
      const ok = await runSetup(ctx, 1, async (own) => {
        own.pending.set("T", { kill: () => (killed = true) })
        await Bun.sleep(1500)
        if (!own.token.aborted) late = true
      })
      await Bun.sleep(700)
      if (ok) return "setup past its budget reported done"
      if (late) return "setup kept going after its budget"
      return killed ? undefined : "a target still starting was not killed"
    },
  },
  {
    finding: "LOW self-test-runs",
    async run() {
      const self = source("probe-sp-n.ts")
      const main = self.slice(self.search(/^async function main\(\) \{$/m))
      const checks = main.indexOf("await logicChecks()")
      const platform = main.indexOf('process.platform !== "win32"')
      return checks >= 0 && checks < platform
        ? undefined
        : "--measure and --verify do not run the self-test checks first"
    },
  },
  {
    finding: "OWNER by-SID (hosted run 43085201882)",
    async run() {
      const A = ADMINISTRATORS_SID
      const S = SYSTEM_SID
      const ok = { owner: A, sids: [S, A] }
      // every representation of the owner and the entries: only the exact SIDs pass, every other one is refused
      // with a reason, and a failed read keeps its own error text
      const cases: Array<[string, Json, RegExp | undefined]> = [
        ["owner SID", ok, undefined],
        ["entries in any order, repeated", { owner: A, sids: [A, S, A] }, undefined],
        ["entries as one comma string", { owner: A, sids: `${A},${S}` }, undefined],
        ["owner by name", { owner: "BUILTIN\\Administrators", sids: [S, A] }, /not a SID/],
        ["owner as SDDL alias", { owner: "BA", sids: [S, A] }, /not a SID/],
        [
          "owner only in the SDDL",
          { owner: "", sddl: "O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)", sids: [S, A] },
          /returned nothing/,
        ],
        [
          "owner read error",
          { ownerError: "GetOwner returned null", sids: [S, A] },
          /owner read failed: GetOwner returned null/,
        ],
        [
          "whole read error",
          { legError: "Access to the path is denied" },
          /ACL read failed: Access to the path is denied/,
        ],
        ["owner SYSTEM", { owner: S, sids: [S, A] }, /not Administrators/],
        ["owner another SID", { owner: "S-1-5-21-1-2-3-500", sids: [S, A] }, /not Administrators/],
        ["entry by name", { owner: A, sids: [S, "BUILTIN\\Users"] }, /not SIDs/],
        [
          "entry not translated",
          { owner: A, sids: [S, A], sidErrors: [{ error: "IdentityNotMappedException" }] },
          /IdentityNotMappedException/,
        ],
        ["extra entry", { owner: A, sids: [S, A, "S-1-5-32-545"] }, /not SYSTEM and Administrators only/],
        ["missing entry", { owner: A, sids: [A] }, /not SYSTEM and Administrators only/],
        ["no entries", { owner: A, sids: [] }, /access list is empty/],
      ]
      const bad = cases.flatMap(([name, j, want]) => {
        const got = aclProblem(j)
        return (want ? got !== undefined && want.test(got) : got === undefined) ? [] : [`${name}: ${got ?? "accepted"}`]
      })
      if (bad.length) return bad.join("; ")
      const leg = source("sp-n-legs-session.ps1")
      const acl = leg.slice(leg.indexOf("function Leg-acl("), leg.indexOf("function Leg-close("))
      const native = source("sp-n-native-input.ps1")
      const read = native.slice(
        native.indexOf("public static Hashtable AclSids("),
        native.indexOf("public static string InputDesktop("),
      )
      if (!/GetOwner\(typeof\(System\.Security\.Principal\.SecurityIdentifier\)\)/.test(read))
        return "the ACL read does not take the owner as a SecurityIdentifier"
      if (!/GetAccessRules\(true, true, typeof\(System\.Security\.Principal\.SecurityIdentifier\)\)/.test(read))
        return "the ACL read does not take the entries as SecurityIdentifiers"
      // names travel as an SDDL string, an NTAccount, the .Owner name property or icacls text (a section flag is fine)
      const names = /\.Sddl\b|SddlForm|NTAccount|\$\w+\.Owner\b|icacls/i
      if (!names.test("$acl.Owner") || names.test("AccessControlSections.Owner"))
        return "the name scan misreads a known case"
      if (names.test(acl + read)) return "the ACL read still emits or reads a name, SDDL or icacls text"
      const self = source("probe-sp-n.ts")
      const lock = self.slice(self.indexOf("async function lockDownWindows("), self.indexOf("async function setup("))
      return /"-Command"/.test(lock) ? "the ACL read is PowerShell code on a command line" : undefined
    },
  },
  {
    finding: "SWALLOW uia-error",
    async run() {
      const cases: Array<[Json, Verdict]> = [
        [{ uiaError: "UIA failed" }, "UNMEASURED"],
        [{}, "UNMEASURED"],
        [{ uiaQueried: true, uiaValue: null }, "CONFIRMS"],
        [{ uiaQueried: true, uiaValue: "qqq" }, "CONTRADICTS"],
      ]
      const bad = cases.filter(([r, v]) => uiaResult(r).verdict !== v)
      if (bad.length) return `UIA verdicts wrong for ${JSON.stringify(bad)}`
      if (!uiaResult({ uiaError: "UIA failed" }).measured.includes("UIA failed"))
        return "the UIA error text is not in the row"
      return /uiaQueried'\] = \$true/.test(source("sp-n-legs-delivery.ps1"))
        ? undefined
        : "Leg-uipi does not mark a completed query"
    },
  },
  {
    finding: "SWALLOW leg-error",
    async run() {
      const thrown = await Promise.resolve()
        .then(() => legResult('{"legError":"state read failed: x","leg":"fg-barrier"}', "fg-barrier"))
        .then(
          () => "a leg's legError was read as a result",
          (e: Error) => (e.message.includes("state read failed: x") ? undefined : `wrong error: ${e.message}`),
        )
      if (thrown) return thrown
      return /catch \{ Emit @\{ legError = /.test(source("sp-n.ps1"))
        ? undefined
        : "sp-n.ps1 does not report a failing leg as legError"
    },
  },
  {
    finding: "SWALLOW wait-file",
    async run() {
      const dir = join(tmpdir(), `omo-sp-n-wait-${process.pid}`)
      mkdirSync(dir, { recursive: true })
      try {
        writeFileSync(join(dir, "bad.json"), "{not json")
        writeFileSync(join(dir, "failed.json"), JSON.stringify({ legError: "Get-Acl failed" }))
        const outcome = async (f: string) =>
          waitFile(join(dir, f), 300).then(
            (v: unknown) => `resolved ${JSON.stringify(v)}`,
            (e: Error) => `rejected ${e.message}`,
          )
        const bad = await outcome("bad.json")
        if (!/rejected .*(JSON|Unexpected|parse)/i.test(bad))
          return `an unreadable file is not reported with its parse error: ${bad}`
        const missing = await outcome("missing.json")
        if (!/rejected .*not written/.test(missing)) return `a missing file is not reported: ${missing}`
        const failed = await outcome("failed.json")
        return /rejected .*Get-Acl failed/.test(failed) ? undefined : `a legError result was accepted: ${failed}`
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
  {
    finding: "SWALLOW read-state",
    async run() {
      const all = [...LEG_FILES, "sp-n.ps1", "sp-n-target.ps1"].map((f) => [f, source(f)] as const)
      const empty = all.filter(([, t]) => /catch\s*\{\s*\}/.test(t)).map(([f]) => f)
      if (empty.length) return `empty catch blocks in ${empty.join(", ")}`
      const main = source("sp-n.ps1")
      if (!/ok = \$false; error = /.test(main)) return "ReadState does not return an error object"
      if (/return -1/.test(main)) return "CountChar still turns a failed read into -1"
      return /\[int\]\$s\.wheel/.test(source("sp-n-legs-delivery.ps1"))
        ? "Leg-wheel still reads [int]$s.wheel (null becomes 0)"
        : undefined
    },
  },
  {
    finding: "SWALLOW native-sentinels",
    async run() {
      const input = source("sp-n-native-input.ps1")
      const connect = input.slice(
        input.indexOf("public static int ConnectState("),
        input.indexOf("public static string InputDesktop("),
      )
      if (/return -1/.test(connect)) return "ConnectState returns -1 for a failed WTSQuerySessionInformationW"
      if (/err = -1/.test(input)) return "SendCharsTo still signals 'not foreground' as last error -1"
      const self = source("probe-sp-n.ts")
      const restore = self.slice(
        self.indexOf("async function restoreSession("),
        self.indexOf("// The disconnected and locked legs"),
      )
      return /\.catch\(\(\) => undefined\)/.test(restore)
        ? "restoreSession drops the disconnect-state error"
        : undefined
    },
  },
  {
    finding: "CLEANUP keeps-ledger (hosted run 43124914270)",
    async run() {
      const dir = join(tmpdir(), `omo-sp-n-end-${process.pid}`)
      mkdirSync(dir, { recursive: true })
      try {
        const out = join(dir, "ledger.tsv")
        const fsError = (code: string) =>
          Object.assign(new Error(`${code}: rm 'C:\\ProgramData\\omo-sp-n-x'`), { code })
        // every way the cleanup can fail: it throws (EBUSY, EPERM, ENOENT), it reports a child still alive or a
        // directory it could not remove, it never returns
        const modes: Array<[string, () => Promise<string[]>, RegExp]> = [
          ["EBUSY", () => Promise.reject(fsError("EBUSY")), /EBUSY/],
          ["EPERM", () => Promise.reject(fsError("EPERM")), /EPERM/],
          ["ENOENT", () => Promise.reject(fsError("ENOENT")), /ENOENT/],
          ["child alive", async () => ["children still running after 10 s: 4242"], /4242/],
          ["dir kept", async () => ["could not remove x after 10 tries over about 5 s: EBUSY"], /could not remove/],
          ["hangs", () => never(), /ran past 1 s/],
        ]
        // and every body result: written with 0, written with a verify difference (1), measurement threw
        const bodies: Array<[string, () => Promise<void>, number]> = [
          ["ok", async () => undefined, 0],
          ["verify differs", async () => undefined, 1],
          ["threw", () => Promise.reject(new Error("group exploded")), 1],
        ]
        const bad: string[] = []
        for (const [mode, cleanup, mark] of modes)
          for (const [body, measure, code] of bodies) {
            rmSync(out, { force: true })
            const r = await bounded(
              runThenClean(
                measure,
                (e) => {
                  writeFileSync(out, `ledger ${e ? "partial" : "full"}\n`)
                  return body === "verify differs" ? 1 : 0
                },
                cleanup,
                1,
              ),
              5,
            ).catch((e: Error) => e)
            const tag = `${mode}/${body}`
            if (r === "timeout") bad.push(`${tag}: did not return within 5 s`)
            else if (r instanceof Error) bad.push(`${tag}: threw ${r.message}`)
            else {
              if (!existsSync(out)) bad.push(`${tag}: ledger not written`)
              if (r.exitCode !== code) bad.push(`${tag}: exit ${r.exitCode}, want the body's ${code}`)
              const warn = r.lines.findIndex((l) => l.startsWith("SP-N WARNING (cleanup)") && mark.test(l))
              if (warn < 0) bad.push(`${tag}: cleanup failure not reported as a warning`)
              if (body === "threw" && !(r.lines[0]?.includes("group exploded") && warn > 0))
                bad.push(`${tag}: body error not reported first: ${JSON.stringify(r.lines)}`)
            }
          }
        if (bad.length) return bad.slice(0, 6).join("; ") + (bad.length > 6 ? ` (+${bad.length - 6} more)` : "")
        const self = source("probe-sp-n.ts")
        const main = self.slice(self.search(/^async function main\(\) \{$/m))
        if (/rmSync\(ctx\.(shared|tmp)/.test(main))
          return "main still removes the run directories with a throwing rmSync"
        return /await runThenClean\(/.test(main) ? undefined : "main does not end the run through runThenClean"
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  },
  {
    finding: "CLEANUP rm-retry",
    async run() {
      const bad: string[] = []
      for (const code of ["EBUSY", "EPERM", "ENOTEMPTY"]) {
        let calls = 0
        const t0 = Date.now()
        const w = await removeDir(
          "x",
          () => {
            calls++
            throw Object.assign(new Error(`${code}: rm 'x'`), { code })
          },
          10,
          200,
        ).catch((e: Error) => e)
        if (w instanceof Error) bad.push(`${code}: thrown (${w.message})`)
        else if (calls !== 10 || !w?.includes(code) || !w.includes("10 tries"))
          bad.push(`${code}: ${calls} tries, warning ${w}`)
        else if (Date.now() - t0 < 150) bad.push(`${code}: no backoff`)
      }
      let calls = 0
      const gone = await removeDir(
        "x",
        () => {
          calls++
          throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" })
        },
        10,
        200,
      )
      if (gone !== undefined || calls !== 1)
        bad.push(`ENOENT: ${calls} tries, ${gone} (already gone counts as removed)`)
      let n = 0
      const third = await removeDir(
        "x",
        () => {
          if (++n < 3) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" })
        },
        10,
        100,
      )
      if (third !== undefined || n !== 3) bad.push(`freed on the third try: ${n} tries, ${third}`)
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "CLEANUP children-exit",
    async run() {
      const killed: number[] = []
      let release = () => {}
      const exits = new Promise<void>((r) => {
        release = r
      })
      const quick = { pid: 11, kill: () => release(), exited: exits }
      const stuck = { pid: 22, kill: () => undefined, exited: never() }
      let plainKilled = false
      let treeFailKilled = false
      const plain = { kill: () => (plainKilled = true) }
      const treeFails = { pid: 33, kill: () => (treeFailKilled = true), exited: Promise.resolve() }
      const left = await endChildren([quick, stuck, plain, treeFails], 300, async (pid) => {
        killed.push(pid)
        if (pid === 11) release()
        if (pid === 33) throw new Error("taskkill failed")
      })
      if (killed.join(",") !== "11,22,33") return `not every child's tree was ended: ${killed.join(",")}`
      if (!plainKilled) return "a child without a pid was not killed"
      if (!treeFailKilled) return "a child whose tree kill failed was not killed directly"
      if (left.join(",") !== "22") return `children not waited for exit, or a stuck one not reported: ${left.join(",")}`
      const self = source("probe-sp-n.ts")
      const main = self.slice(self.search(/^async function main\(\) \{$/m))
      return /endChildren\(/.test(main) && /taskkill\.exe/.test(main)
        ? undefined
        : "main does not wait for the children's trees to exit"
    },
  },
  {
    finding: "PSMODULEPATH child-env (hosted run 43133245569)",
    async run() {
      const env = childEnv({
        PSModulePath: "C:\\pwsh7\\Modules",
        psmodulepath: "x",
        PSMODULEPATH: "y",
        Path: "C:\\bin",
        HOME: "h",
        EMPTY: undefined,
      })
      const left = Object.keys(env).filter((k) => k.toLowerCase() === "psmodulepath")
      if (left.length) return `PSModulePath reaches the child: ${left.join(",")}`
      if (env.Path !== "C:\\bin" || env.HOME !== "h") return "childEnv drops variables other than PSModulePath"
      const self = source("probe-sp-n.ts")
      const spawns = self.match(/Bun\.spawn\([\s\S]*?\{ stdout:[^}]*\}/g) ?? []
      const bare = spawns.filter((x) => !/env: childEnv\(\)/.test(x))
      if (spawns.length < 4) return `the spawn scan found only ${spawns.length} spawns`
      return bare.length ? `${bare.length} of ${spawns.length} spawns do not pass env: childEnv()` : undefined
    },
  },
  {
    finding: "PSMODULEPATH no-module-cmdlets",
    async run() {
      // cmdlets of modules that a Windows PowerShell 5.1 child loads through PSModulePath (Security, LocalAccounts,
      // ScheduledTasks, CimCmdlets, NetSecurity, Archive, ...); the probe reads these facts in its compiled C# instead
      const moduleCmdlet =
        /\b(?:Get|Set)-(?:Acl|AuthenticodeSignature|ExecutionPolicy|CmsMessage|PfxCertificate|LocalUser|LocalGroup|LocalGroupMember|ScheduledTask|CimInstance|NetFirewallRule)\b|\b(?:ConvertTo|ConvertFrom)-SecureString\b|\bRegister-ScheduledTask\b|\bExpand-Archive\b|\bCompress-Archive\b|\bImport-Module\b/i
      if (
        !moduleCmdlet.test("$x = Get-Acl -LiteralPath $p") ||
        moduleCmdlet.test("# Get-Acl in a comment".replace(/(^|\s)#.*$/, ""))
      )
        return "the cmdlet scan misses a known case"
      const files = ["sp-n.ps1", "sp-n-target.ps1", ...LEG_FILES]
      const hits = files.flatMap((f) =>
        source(f)
          .split("\n")
          .map((l, i) => [l.replace(/(^|\s)#.*$/, ""), i + 1] as const)
          .filter(([l]) => moduleCmdlet.test(l))
          .map(([l, n]) => `${f}:${n} ${l.trim().slice(0, 60)}`),
      )
      if (hits.length) return `module cmdlets in probe legs: ${hits.join("; ")}`
      return /AclSids/.test(source("sp-n-legs-session.ps1")) &&
        /DirectorySecurity/.test(source("sp-n-native-input.ps1"))
        ? undefined
        : "the ACL read is not the compiled DirectorySecurity read"
    },
  },
  {
    finding: "LOW timing-flap",
    async run() {
      const cases: Array<[number, number, Verdict]> = [
        [16.157, 35, "CONFIRMS"],
        [1.534, 2, "CONFIRMS"],
        [2.05, 2, "UNMEASURED"],
        [16, 2, "CONTRADICTS"],
        [Number.NaN, 2, "UNMEASURED"],
      ]
      const bad = cases.filter(([p, l, v]) => timingVerdict(p, l, "m").verdict !== v)
      return bad.length ? `timing verdicts wrong for ${JSON.stringify(bad)}` : undefined
    },
  },
]

const INVALID_NOTE = "probe defect (return-in-loop); INVALID until a hosted run with the positive control succeeds"
const SUSPECT_IDS = [
  "n-barrier-fg-proves-wpf",
  "n-barrier-fg-ms-wpf",
  "n-barrier-posted-proves-wpf",
  "n-barrier-posted-ms-wpf",
  "n-fg-chord-ctrl-a-classic-edit-control",
]
const LEDGER_CHECKS: readonly Check[] = [
  {
    finding: "SUSPECT rows",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      const bad = SUSPECT_IDS.filter((id) => {
        const r = rows.find((x) => x.id === id && x.host === HOSTED)
        return !r || r.verdict !== "CONFIRMS" || !r.notes.startsWith("SUSPECT")
      })
      if (bad.length) return `not marked SUSPECT (verdict kept): ${bad.join(",")}`
      return carriedNote("SUSPECT: x") === "-" ? undefined : "a SUSPECT note survives the re-measure that replaces it"
    },
  },
  {
    finding: "HIGH wheel-rows-invalid",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      for (const id of ["n-wheel-after-raise-dwmflush", "n-wheel-after-raise-5ms"]) {
        const r = rows.find((x) => x.id === id && x.host === HOSTED)
        if (!r || r.verdict !== "INVALID" || r.notes !== INVALID_NOTE)
          return `${id} on ${HOSTED}: want INVALID with "${INVALID_NOTE}", got ${r ? `${r.verdict} "${r.notes}"` : "no row"}`
      }
      const unsound = rows.filter(
        (r) =>
          r.id.startsWith("n-wheel-after-raise") &&
          /CONFIRMS|CONTRADICTS/.test(r.verdict) &&
          !r.measured.includes("control delivered"),
      )
      return unsound.length
        ? `wheel verdict without a positive control: ${unsound.map((r) => r.id).join(",")}`
        : undefined
    },
  },
  {
    finding: "LOW hosted-rows-committed",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      const missing = Object.keys(SPEC).filter(
        (id) => !SPEC[id]?.h6Only && !rows.some((r) => r.id === id && r.host === HOSTED),
      )
      const bad = rows.filter(
        (r) => !SPEC[r.id] || !["CONFIRMS", "CONTRADICTS", "NEW-EDGE", "UNMEASURED", "INVALID"].includes(r.verdict),
      )
      if (bad.length) return `rows with an unknown id or verdict: ${bad.map((r) => r.id).join(",")}`
      return missing.length ? `no ${HOSTED} row for ${missing.join(",")}` : undefined
    },
  },
]

async function runChecks(checks: readonly Check[]): Promise<string[]> {
  const failures: string[] = []
  for (const c of checks) {
    const why = await c.run().catch((e: Error) => `threw ${e.message}`)
    if (why) failures.push(`[${c.finding}] ${why}`)
  }
  return failures
}
const logicChecks = () => runChecks(LOGIC_CHECKS)

async function selfTest(): Promise<never> {
  // --only <text>: run just the checks whose finding contains text, alone
  const only = process.argv[process.argv.indexOf("--only") + 1]
  const pick = (cs: readonly Check[]) =>
    process.argv.includes("--only") && only ? cs.filter((c) => c.finding.includes(only)) : cs
  if (process.argv.includes("--only") && pick([...LOGIC_CHECKS, ...LEDGER_CHECKS]).length === 0)
    fail(`SELF-TEST no check matches --only ${only}`)
  const ran = [...pick(LOGIC_CHECKS), ...pick(LEDGER_CHECKS)].length
  const failures = [...(await runChecks(pick(LOGIC_CHECKS))), ...(await runChecks(pick(LEDGER_CHECKS)))]
  for (const f of failures) console.log(`SELF-TEST FAIL ${f}`)
  console.log(
    failures.length
      ? `SELF-TEST FAIL ${failures.length} checks`
      : `SELF-TEST PASS ${ran} checks, pass budget ${TOTAL_BUDGET_S} s`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (process.argv[2] === "--self-test") await selfTest()
  const opt = args()
  const broken = await logicChecks()
  if (broken.length) fail(`PRECONDITION self-test: ${broken.join("; ")}`)
  if (process.platform !== "win32")
    fail(
      `PRECONDITION windows-interactive-desktop: SP-N measures a Windows interactive desktop; this host is ${process.platform}`,
    )
  const ctx: Ctx = {
    tmp: join(tmpdir(), `omo-sp-n-${process.pid}`),
    // a fresh, unpredictable name: freshDir refuses one that already exists
    shared: join(
      process.env.ProgramData ?? "C:\\ProgramData",
      `omo-sp-n-${process.pid}-${randomBytes(6).toString("hex")}`,
    ),
    facts: {},
    targets: new Map(),
    spawned: [],
    notes: new Map(),
    live: new Set(),
    token: { aborted: false },
    cleanups: [],
    pending: new Map(),
  }
  mkdirSync(ctx.tmp, { recursive: true })
  await freshDir(ctx.shared, (p) => lockDownWindows(ctx, p)).catch((e: Error) =>
    fail(`PRECONDITION shared-dir: ${e.message}`),
  )
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
  const ids = Object.keys(SPEC).filter((id) => want.has(id))
  const end = await runThenClean(
    async () => {
      const setupDone = await runSetup(ctx, SETUP_BUDGET_S, (own) =>
        setup(
          own,
          groups.flatMap((g) => g.ids),
        ),
      )
      if (!setupDone) console.log(`SP-N setup ran past ${SETUP_BUDGET_S} s; targets not started yet are UNMEASURED`)
      for (const g of groups) Object.assign(results, await runGroup(g, ctx))
    },
    (measureError) => {
      const missing = UN(
        `no leg produced this row${measureError ? `: the measurement failed: ${clean(measureError.message)}` : ""}`,
      )
      if (opt.mode === "measure") {
        const before = readLedger(opt.file)
        const notes = new Map(before.filter((r) => r.host === host).map((r) => [r.id, r.notes]))
        const fresh = new Map(
          ids.map((id) => [id, ledgerLine(id, results[id] ?? missing, host, build, carriedNote(notes.get(id)))]),
        )
        writeFileSync(opt.file, `${mergeLedger(before, host, fresh).join("\n")}\n`)
        for (const id of ids)
          console.log(
            `${(results[id] ?? missing).verdict.padEnd(11)} ${id}  ${clean((results[id] ?? missing).measured)}`,
          )
        console.log(`SP-N measured ${ids.length} rows on ${host} (${build}) -> ${relative(process.cwd(), opt.file)}`)
        return 0
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
      return diff === 0 ? 0 : 1
    },
    async () => {
      const warnings: string[] = []
      const notepad = ctx.targets.get("Notepad")
      if (notepad)
        await leg(ctx, "close", { top: notepad.top }).catch((e: Error) =>
          warnings.push(`closing Notepad: ${clean(e.message)}`),
        )
      // whole trees, then a bounded wait for every child to exit: files in the shared dir are closed before rm
      const left = await endChildren([...ctx.spawned, ...ctx.pending.values()], 10_000, (pid) =>
        run(["taskkill.exe", "/PID", String(pid), "/T", "/F"]),
      )
      if (left.length) warnings.push(`children still running after 10 s: ${left.join(",")}`)
      for (const d of [ctx.tmp, ctx.shared]) {
        const w = await removeDir(d)
        if (w) warnings.push(w)
      }
      return warnings
    },
  )
  for (const l of end.lines) console.log(l)
  // Explicit: a child the probe could not end must not keep the run alive (the hosted job hung here once).
  process.exit(end.exitCode)
}

if (import.meta.main) await main()
