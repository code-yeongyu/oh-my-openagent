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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"

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
// Every bound a verdict applies, each with its source line in the pinned design. A timing row with no bound here
// reads NEW-EDGE with its numbers ("first recorded"), never CONTRADICTS: Windows timings are targets until measured.
export const BOUNDS = {
  pollMs: { value: 1, cite: "design/d-windows.md:130 (each hop polls at 1 ms)" },
  hangGuardMs: { value: 5000, cite: "design/d-windows.md:130 (each hop bounded by a 5 s hang guard)" },
  wheelAfterRaise: {
    value: 1,
    cite: "design/d-windows.md:128 (DwmFlush before pointer: doc numbers 6/6 lost -> 18/18, re-measured)",
  },
  coverWindow: { value: 0, cite: "design/d-windows.md:393 (cover-window oracle reads > 0 -> hide_ack)" },
  // a validity gate on the oracle itself, not a finding: the no-affinity control must show the overlay
  coverWindowControl: {
    value: 0.9,
    cite: "design/d-windows.md:393 (the cover-window oracle must see an unflagged overlay)",
  },
} as const
type Bound = { readonly value: number; readonly cite: string }

// Every count-row property a verdict judges, keyed to its pinned-design line. A property without a citation is not
// a design claim: it is recorded as data and reads NEW-EDGE. Give it a citation here to make it a verdict.
export const PROPERTIES: Readonly<Record<string, string | undefined>> = {
  // '## Input', Barrier: what the barrier proves is routed + consumed, not the effect at return
  barrierReceipt: "design/d-windows.md:130 (## Input, Barrier: routed hop + consumed hop)",
  wheelSettled: undefined, // no design line states that a settled foreground target receives the wheel
  effectAtReturn: undefined, // the design lane: the barrier does not claim the effect is visible at return
  postedLandsClassic: "design/d-windows.md:97 (background_window: PostMessageW, consumed hop, read-back)",
  dropMatrixWebView2: "design/d-windows.md:146 (Chromium / CEF / WebView2 background refused)",
  dropMatrixWpf: "design/d-windows.md:147 (WPF pointer and text refused in the background)",
}
export function propertyVerdict(property: string, held: boolean, numbers: string): Result {
  const cite = PROPERTIES[property]
  if (cite === undefined) return { measured: `${numbers}; no design claim (${property})`, verdict: "NEW-EDGE" }
  return { measured: `${numbers}; per ${cite}`, verdict: pick(held, "CONFIRMS", "CONTRADICTS") }
}

// INVALID: a row measured by a probe with a known defect; kept with the reading, superseded by the next run.
export type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED" | "INVALID"
// skip: this pass did not re-measure the row, and why (--verify reports it and does not compare it)
type Result = { readonly measured: string; readonly verdict: Verdict; readonly skip?: string }
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
  // run legs that cannot be undone on every host (the session lock) only when asked
  allowIrreversible: boolean
  // set when a session leg could not prove the session restored; later session legs refuse to run
  session: { unusable?: string }
}
type Cleanup = { readonly name: string; run(ctx: Ctx): Promise<string> }
// h6Only: measured on H6 only. multiMonitor: measured on H6 and on any host that reports two or more monitors.
type Spec = {
  readonly question: string
  readonly condition: string
  readonly h6Only?: true
  readonly multiMonitor?: true
}

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
    question: "does the measuring host's Windows desktop have a second monitor (host prerequisite H6)",
    condition: "monitors attached to the interactive session",
    multiMonitor: true,
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
          question: `what does the routed-and-consumed barrier cost for ${label} (design: no time bound, only the 5 s hang guard per hop)`,
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
    multiMonitor: true,
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

// Every exit goes through runThroughCleanup: fail() throws a ProbeExit, an unexpected error or rejection is caught
// there (or by onFatal), and the directories this run created are removed on every one of those paths.
export class ProbeExit extends Error {
  constructor(
    readonly code: number,
    line: string,
  ) {
    super(line)
  }
}
function fail(line: string): never {
  throw new ProbeExit(2, line)
}
// the directories this run created (never one that existed before it), removed on every exit
export const EXIT_DIRS = new Set<string>()
export function cleanDirs(dirs: Set<string>, out: (l: string) => void) {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch (e) {
      out(`WARN cleanup ${d}: ${(e as Error).message}`)
    }
  }
  dirs.clear()
}
export async function runThroughCleanup(
  body: () => Promise<number>,
  dirs: Set<string> = EXIT_DIRS,
  out: (l: string) => void = (l) => console.log(l),
): Promise<number> {
  let code: number
  try {
    code = await body()
  } catch (e) {
    out(e instanceof ProbeExit ? e.message : `FATAL ${e instanceof Error ? e.message : String(e)}`)
    code = e instanceof ProbeExit ? e.code : 2
  }
  cleanDirs(dirs, out)
  return code
}
// uncaught exceptions and unhandled rejections outside the awaited chain
export function onFatal(
  e: unknown,
  dirs: Set<string> = EXIT_DIRS,
  out = (l: string) => console.log(l),
  exit = (c: number): void => process.exit(c),
) {
  out(`FATAL ${e instanceof Error ? e.message : String(e)}`)
  cleanDirs(dirs, out)
  exit(2)
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

// A helper started with -Out writes <out>.started ({ pid }) first; at the deadline it names why nothing came.
export type HelperWatch = { readonly started: string; readonly alive: (pid: number) => Promise<boolean> }
async function helperFate(w: HelperWatch): Promise<string> {
  if (!existsSync(w.started)) return "the helper never started (no start marker)"
  const pid = num(obj(JSON.parse(readFileSync(w.started, "utf8"))).pid)
  return (await w.alive(pid))
    ? `the helper (pid ${pid}) is still running`
    : `the helper (pid ${pid}) exited without writing a result (silent exit)`
}
// Whether a process is still running (tasklist: a medium-integrity helper is visible to the elevated probe).
const pidAlive = async (pid: number) =>
  (await run(["tasklist.exe", "/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"])).out.includes(`"${pid}"`)

// The JSON a helper wrote to path, waiting up to ms for it. A file never written, a file still unreadable at the
// deadline (with its last parse error) and a helper's legError all reject: none of them is read as "no result".
export async function waitFile(path: string, ms: number, helper?: HelperWatch): Promise<Json> {
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
      : `${basename(path)}: not written within ${ms / 1000} s${helper ? `; ${await helperFate(helper)}` : ""}`,
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
  rmSync(`${out}.started`, { force: true })
  await run(["runas.exe", "/trustlevel:0x20000", psCommand(ctx.tmp, name, arg, out)], ctx.live)
  return waitFile(out, 60_000, { started: `${out}.started`, alive: pidAlive })
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
// runs in which SendInput accepted at least one event (sent is the number of events, not a flag)
export const sentRuns = (runs: unknown) => arr(runs).filter((r) => num(r.sent) > 0).length
const pick = (cond: boolean, yes: Verdict, no: Verdict): Verdict => (cond ? yes : no)
const UN = (reason: string): Result => ({ measured: `UNMEASURED: ${reason}`, verdict: "UNMEASURED" })

// A timing row decides only outside a 10 % band around its limit; inside it one run cannot decide, so two
// back-to-back runs (--measure then --verify) do not flip between CONFIRMS and CONTRADICTS.
export const TIMING_BAND = 0.1
export function timingVerdict(p95: number, bound: Bound | undefined, measured: string): Result {
  if (!Number.isFinite(p95)) return UN(`no samples; ${measured}`)
  if (!bound) return { measured: `first recorded: p95 ${p95}; ${measured}`, verdict: "NEW-EDGE" }
  const m = `${measured}; bound ${bound.value} ms per ${bound.cite}`
  if (p95 <= bound.value * (1 - TIMING_BAND)) return { measured: m, verdict: "CONFIRMS" }
  if (p95 > bound.value * (1 + TIMING_BAND)) return { measured: m, verdict: "CONTRADICTS" }
  return UN(`p95 ${p95} ms within ${TIMING_BAND * 100} % of the ${bound.value} ms bound; ${m}`)
}

// The wheel rows count only when the settled-foreground control delivered every wheel: without that, a 0 could
// be an oracle that cannot see a wheel.
type Tally = { readonly delivered: number; readonly runs: number; readonly acquire?: string; readonly notFg?: number }
export function wheelResults(control: Tally, flush: Tally, delay: Tally): Record<string, Result> {
  const c = controlText(control.delivered, control.runs)
  const proven = control.runs > 0 && control.delivered === control.runs
  const why = `the settled-foreground ${c}, so the wheel oracle is not proven`
  return {
    "n-wheel-control-settled": propertyVerdict(
      "wheelSettled",
      proven,
      `${c} foreground by ${control.acquire ?? "-"} not foreground at the wheel ${control.notFg ?? "-"}/${control.runs}`,
    ),
    "n-wheel-after-raise-dwmflush": proven
      ? {
          measured: `delivered ${flush.delivered}/${flush.runs}; ${c}; foreground by ${flush.acquire ?? "-"} not foreground at the wheel ${flush.notFg ?? "-"}/${flush.runs}`,
          verdict: pick(
            flush.runs > 0 && flush.delivered / flush.runs >= BOUNDS.wheelAfterRaise.value,
            "CONFIRMS",
            "CONTRADICTS",
          ),
        }
      : UN(`${why}; delivered ${flush.delivered}/${flush.runs}`),
    "n-wheel-after-raise-5ms": proven
      ? {
          measured: `lost ${delay.runs - delay.delivered}/${delay.runs}; ${c}; foreground by ${delay.acquire ?? "-"} not foreground at the wheel ${delay.notFg ?? "-"}/${delay.runs}`,
          verdict: pick(
            delay.runs > 0 && (delay.runs - delay.delivered) / delay.runs >= BOUNDS.wheelAfterRaise.value,
            "CONFIRMS",
            "CONTRADICTS",
          ),
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

// The rows a --measure of this host writes: H6 rows only on H6, second-monitor rows wherever two monitors are seen.
export const rowsForHost = (host: string, facts: Json): string[] =>
  Object.keys(SPEC).filter((id) =>
    SPEC[id]?.multiMonitor ? host === H6 || arr(facts.monitors).length >= 2 : host === H6 || !SPEC[id]?.h6Only,
  )
const monitorText = (m: Json) => `${num(m.w)}x${num(m.h)}@${num(m.x)},${num(m.y)} dpi=${str(m.dpi) || "unread"}`
const presentMonitors = (n: number) => (n === 1 ? "one present monitor" : `${n} present monitors`)

const hostFacts: Group = {
  budgetS: 15,
  ids: ["n-host-admin", "n-host-second-monitor"],
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
        measured: `monitors=${monitors.length} ${monitors.map(monitorText).join(" ")}`,
        verdict: pick(monitors.length >= 2, "CONFIRMS", "CONTRADICTS"),
      },
    }
  },
}

// The affinity overlay on the second monitor, judged like n-affinity-wgc-monitor: the no-affinity control must
// show the overlay, then the flagged overlay must read no magenta. Fewer than two monitors: skipped, with the count.
export function secondaryResults(
  monitors: readonly Json[],
  control: Json | undefined,
  ex: Json | undefined,
): Record<string, Result> {
  const id = "n-affinity-wgc-monitor-secondary"
  const i = monitors.findIndex((m) => m.primary !== true)
  const second = monitors[i]
  if (monitors.length < 2 || !second) return { [id]: UN(`skipped: ${presentMonitors(monitors.length)}`) }
  const where = `monitor ${i + 1} of ${monitors.length} ${monitorText(second)}`
  if (!control || !ex) return { [id]: UN(`skipped: the second-monitor capture did not run; ${where}`) }
  const m = (j: Json) => num(at(j, "wgcMonitor", "magenta"))
  const text =
    `${where}; magenta=${m(ex)} control=${m(control)} setAffinity=${str(ex.setAffinityOk)} affinityRead=0x${num(ex.affinityRead).toString(16)} ${str(at(ex, "wgcMonitor", "info", "error"))}`.trim()
  if (!(m(control) >= BOUNDS.coverWindowControl.value))
    return { [id]: UN(`the no-affinity control did not show the overlay; ${text}`) }
  if (!(m(ex) >= 0)) return { [id]: UN(`errored: no frame of the second monitor; ${text}`) }
  return { [id]: { measured: text, verdict: pick(m(ex) <= BOUNDS.coverWindow.value, "CONFIRMS", "CONTRADICTS") } }
}

const secondMonitor: Group = {
  budgetS: 30,
  ids: ["n-affinity-wgc-monitor-secondary"],
  async run(ctx) {
    const monitors = arr(ctx.facts.monitors)
    const second = monitors.find((m) => m.primary !== true)
    if (monitors.length < 2 || !second) return secondaryResults(monitors, undefined, undefined)
    const rect = { x: num(second.x), y: num(second.y), w: num(second.w), h: num(second.h) }
    const control = await leg(ctx, "affinity-monitor", { ...rect, exclude: false })
    const ex = await leg(ctx, "affinity-monitor", { ...rect, exclude: true })
    return secondaryResults(monitors, control, ex)
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
          ? UN(`errored: the SYSTEM task produced no result: ${s0.message}`)
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
          : timingVerdict(num(d.p95), undefined, `${ms(d)} hresult=${num(d.hresult)}`),
      "n-poll-sleep1-ms": timingVerdict(num(sleep1.p95), BOUNDS.pollMs, ms(sleep1)),
      "n-poll-hrtimer1-ms":
        hr.error !== undefined
          ? { measured: `CreateWaitableTimerExW error ${num(hr.error)}`, verdict: "NEW-EDGE" }
          : timingVerdict(num(hr.p95), BOUNDS.pollMs, ms(hr)),
    }
  },
}

// The foreground barrier's runs as verdict records. A run in which the barrier was never exercised (not foreground
// at the send, or SendInput accepted no event) is left out of the routed / consumed / hang-guard counts and shown as
// "skipped k/n"; with no exercised run left, both rows are SKIPPED (UNMEASURED with the reason).
// A validity gate of the probe, not a design bound: a verdict needs more than half of the runs exercised.
export const MIN_EXERCISED = Math.floor(RUNS / 2) + 1
export function fgBarrierObs(fg: Json): { readonly proves: Obs; readonly ms: Obs; readonly oracleSeen: boolean } {
  if (fg.acquired !== true) {
    const s: Obs = { kind: "SKIPPED", reason: "the probe could not take the foreground for the target" }
    return { proves: s, ms: s, oracleSeen: false }
  }
  const runs = arr(fg.runs)
  const why = (r: Json) =>
    r.notForeground === true ? "not foreground at send" : num(r.sent) > 0 ? undefined : "SendInput accepted no event"
  const reasons = new Map<string, number>()
  for (const r of runs) {
    const w = why(r)
    if (w) reasons.set(w, (reasons.get(w) ?? 0) + 1)
  }
  const ex = runs.filter((r) => !why(r))
  const k = runs.length - ex.length
  const skipped = `skipped ${k}/${runs.length}${k ? ` (${[...reasons].map(([w, c]) => `${w} ${c}`).join(", ")})` : ""}`
  const oracleSeen = count(ex, "within2s") > 0
  if (!ex.length) {
    const s: Obs = { kind: "SKIPPED", reason: `the barrier was never exercised: ${skipped}` }
    return { proves: s, ms: s, oracleSeen }
  }
  if (ex.length < MIN_EXERCISED) {
    const s: Obs = {
      kind: "SKIPPED",
      reason: `too few exercised runs: ${ex.length}/${runs.length}, a verdict needs ${MIN_EXERCISED}; ${skipped}`,
    }
    return { proves: s, ms: s, oracleSeen }
  }
  const n = ex.length
  const [routed, consumed] = [count(ex, "routed"), count(ex, "consumed")]
  const held = routed === n && consumed === n
  const counts = { routed: [routed, n], consumed: [consumed, n], skipped: [k, runs.length] }
  const text = `sent ${sentRuns(runs)}/${runs.length} routed ${routed}/${n} consumed ${consumed}/${n} effect at barrier return ${count(ex, "atReturn")}/${n} within 2 s ${count(ex, "within2s")}/${n} paint probe ${str(fg.probeClass)} foreground by ${str(fg.acquire)}; ${skipped}; effect at return is data, not a design claim`
  const fgMs = `${ms(obj(fg.stats))} hang-guard expiries ${n - Math.min(routed, consumed)}; ${skipped}`
  return {
    proves: { kind: "MEASURED", data: { outcome: held ? "held" : "broken", text, counts } },
    ms: held
      ? toObs(timingVerdict(num(at(fg, "stats", "p95")), undefined, fgMs))
      : {
          kind: "MEASURED",
          data: { outcome: "broken", text: `${fgMs}; a hop hit the hang guard (${BOUNDS.hangGuardMs.cite})`, counts },
        },
    oracleSeen,
  }
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
        const f = fgBarrierObs(fg)
        const oracleSeen = f.oracleSeen
        out[`n-barrier-fg-proves-${key}`] = rowVerdict(`n-barrier-fg-proves-${key}`, f.proves)
        out[`n-barrier-fg-ms-${key}`] = rowVerdict(`n-barrier-fg-ms-${key}`, f.ms)
        const po = await leg(ctx, "posted-barrier", { ...oracle(t), ch: "y", warm: WARM, n: RUNS, away })
        const poDone = count(po.runs, "consumed") === RUNS
        const measured = `posted ${count(po.runs, "posted")}/${RUNS} consumed ${count(po.runs, "consumed")}/${RUNS} effect at return ${count(po.runs, "atReturn")}/${RUNS} within 2 s ${count(po.runs, "within2s")}/${RUNS} dst ${str(po.dstClass)} targetForeground=${str(po.foregroundIsTarget)}`
        // Notepad must land; the drop matrix refuses the other two families, so nothing landing CONFIRMS it.
        const landed =
          key === "notepad" ? poDone && count(po.runs, "atReturn") === RUNS : count(po.runs, "within2s") === 0
        out[`n-barrier-posted-proves-${key}`] = oracleSeen
          ? propertyVerdict(
              key === "notepad" ? "postedLandsClassic" : key === "wpf" ? "dropMatrixWpf" : "dropMatrixWebView2",
              landed,
              measured,
            )
          : UN(`the effect oracle never saw a foreground char; ${measured}`)
        const poMs = `${ms(obj(po.stats))} hang-guard expiries ${RUNS - count(po.runs, "consumed")}`
        out[`n-barrier-posted-ms-${key}`] = poDone
          ? timingVerdict(num(at(po, "stats", "p95")), undefined, poMs)
          : { measured: `${poMs}; a hop hit the hang guard (${BOUNDS.hangGuardMs.cite})`, verdict: "CONTRADICTS" }
      } catch (e) {
        // one family's failed leg makes only its own rows UNMEASURED, with the leg's error
        const missing = ids.filter((id) => !(id in out))
        Object.assign(out, all(missing, UN(`errored: leg failed: ${clean((e as Error).message)}`)))
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
        Object.assign(out, all(missing, UN(`errored: leg failed: ${clean((e as Error).message)}`)))
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
    const tally = (j: Json): Tally => ({
      delivered: num(j.delivered),
      runs: num(j.runs),
      acquire: str(j.acquire),
      notFg: num(j.notForegroundAtWheel),
    })
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
    const seen = m(control, "wgcMonitor") >= BOUNDS.coverWindowControl.value
    const pre = seen ? "" : "UNMEASURED: the no-affinity control did not show the overlay; "
    const v = (x: number, oracleOk = seen): Verdict =>
      !oracleOk || !(x >= 0) ? "UNMEASURED" : pick(x <= BOUNDS.coverWindow.value, "CONFIRMS", "CONTRADICTS")
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
        verdict: v(m(ex, "gdiBitBlt"), m(control, "gdiBitBlt") >= BOUNDS.coverWindowControl.value),
      },
    }
  },
}

// The elevated UIA read: CONFIRMS only when the query completed and explicitly found no value.
export function uiaResult(r: Json): Result {
  const measured = `name=${tail(r.uiaName)} descendants=${num(r.uiaDescendants)} value=${tail(r.uiaValue)}`
  if (typeof r.uiaError === "string") return UN(`errored: the UIA read failed: ${r.uiaError}; ${measured}`)
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
// active: a frame CONFIRMS. Display off (displayStateDuring read back 0): a frame is a NEW-EDGE, adopted by the
// design (re-pin item 12: capture proceeds and reports session.displayAsleep:true); a null or black frame CONFIRMS.
// Disconnected and locked: a null or black frame CONFIRMS, a frame CONTRADICTS.
export function captureVerdict(state: CaptureState, cls: string, r: Json): Verdict {
  if (state === "active") return pick(cls === "frame", "CONFIRMS", "CONTRADICTS")
  const dark = cls === "null_frame" || cls === "black_frame"
  if (state === "display-off")
    return dark ? "CONFIRMS" : num(r.displayStateDuring) === 0 && cls === "frame" ? "NEW-EDGE" : "UNMEASURED"
  return pick(dark, "CONFIRMS", "CONTRADICTS")
}

function captureResults(state: CaptureState, r: Json | undefined, skip?: string): Record<string, Result> {
  if (skip || !r) return all(captureIds(state), UN(skip ?? "no result"))
  const lockText =
    r.during !== undefined
      ? ` lock=${str(at(r, "before", "lock")) || "-"}->${str(at(r, "during", "lock"))}->${str(at(r, "duringEnd", "lock"))}`
      : ""
  const session = `connectState=${str(r.connectState)}->${str(r.connectStateAfter)} inputDesktop=${str(r.inputDesktop)}${lockText}${r.displayStateDuring !== undefined ? ` displayState=${num(r.displayStateBefore)}->${num(r.displayStateDuring)}->${num(r.displayStateAfterWake)}` : ""}`
  return Object.fromEntries(
    CAPTURE_APIS.map(([k, field]) => {
      const c = obj(r[field])
      const cls = str(c.class)
      const measured = `class=${cls} nearBlack=${num(c.nearBlack)} ${str(at(c, "info", "error"))} ${session}`.replace(
        /\s+/g,
        " ",
      )
      return [`n-capture-${k}-${state}`, { measured, verdict: captureVerdict(state, cls, r) }]
    }),
  )
}

// Why a disconnected or locked capture is not evidence, or undefined when it is. A locked verdict needs a POSITIVE
// lock read: WTS_SESSIONSTATE_LOCK at capture time (before and after the captures) and UNLOCK before the lock and
// after the restore. A failed OpenInputDesktop alone proves nothing. A disconnected verdict needs WTSDisconnected
// at capture time, read by a helper in the run's own session. Every read error is named, never read as a state.
export function sessionProblem(
  state: "disconnected" | "locked",
  r: Json,
  sid: number,
  after: Json | undefined,
): string | undefined {
  if (num(r.helperSid) !== sid) return `the capture read session ${str(r.helperSid)}, not the run's session ${sid}`
  // a list of strings: arr() would turn each entry into {} and lose it
  const timeline = Array.isArray(r.timeline) ? r.timeline.map(str) : []
  const seen = timeline.length ? `; states seen: ${timeline.join(" | ")}` : ""
  const [before, during, end] = [obj(r.before), obj(r.during), obj(r.duringEnd)]
  if (state === "locked") {
    const lock = (j: Json) => str(j.lock) || "(no read)"
    if (lock(before) !== "unlock")
      return `the session did not read WTS_SESSIONSTATE_UNLOCK before the lock (lock=${lock(before)})${seen}`
    if (lock(during) !== "lock" || lock(end) !== "lock")
      return `the session did not read WTS_SESSIONSTATE_LOCK at capture time (lock=${lock(during)}->${lock(end)}, inputDesktop=${str(during.desktop) || "(OpenInputDesktop failed)"})${seen}`
    if (!after || str(after.lock) !== "unlock")
      return `cannot restore session on this host: it still reads lock=${after ? str(after.lock) : "(no read)"} after the restore`
    return undefined
  }
  if (num(during.connectState) !== 4 || num(end.connectState) !== 4)
    return `the session did not read WTSDisconnected at capture time (connectState=${str(during.connectState)}->${str(end.connectState)})${seen}`
  if (!after || num(after.connectState) !== 0 || after.inputDesktop !== "Default")
    return `cannot restore session on this host: after the restore connectState=${after ? str(after.connectState) : "(no read)"} inputDesktop=${after ? str(after.inputDesktop) || "(OpenInputDesktop failed)" : "(no read)"}`
  return undefined
}

export const CANNOT_RESTORE =
  "cannot restore session on this host: a locked session cannot be unlocked without credentials; this pass does not lock (run with --allow-irreversible, last, on a host that can unlock)"

// Timing rows ("ms" in the id) across two passes. Unbounded rows stay NEW-EDGE: "first recorded: p95 a / b", plus
// "; unstable on this host" when the passes differ by more than the band. Bounded rows: the WORSE pass decides
// (CONFIRMS < inside-the-band UNMEASURED < CONTRADICTS) with both values. Not a timing pair: undefined.
export const isTimingRow = (id: string) => /(^|-)ms(-|$)/.test(id)
export const p95Of = (measured: string) => Number(/p95[= ]([\d.]+)/.exec(measured)?.[1])
const timingRank = (r: Result) =>
  r.verdict === "CONFIRMS"
    ? 0
    : r.verdict === "CONTRADICTS"
      ? 2
      : r.verdict === "UNMEASURED" && /within \d+ % of the/.test(r.measured)
        ? 1
        : undefined
export function worstOfPasses(
  id: string,
  a: Result,
  b: Result,
): { readonly result: Result; readonly unstable?: string } | undefined {
  if (!isTimingRow(id)) return undefined
  const [pa, pb] = [p95Of(a.measured), p95Of(b.measured)]
  const differ = Math.abs(pa - pb) > TIMING_BAND * Math.max(pa, pb)
  const both = `p95 ${pa} / ${pb}`
  if (a.verdict === "NEW-EDGE" && b.verdict === "NEW-EDGE") {
    const rest = b.measured.replace(/^first recorded: [^;]*; /, "")
    return {
      result: {
        measured: `first recorded: ${both}${differ ? "; unstable on this host" : ""}; ${rest}`,
        verdict: "NEW-EDGE",
      },
      unstable: differ ? `unstable on this host: ${both}` : undefined,
    }
  }
  const [ra, rb] = [timingRank(a), timingRank(b)]
  if (ra === undefined || rb === undefined) return undefined
  if (ra === rb) return { result: b }
  const worse = ra > rb ? a : b
  return {
    result: { measured: `unstable on this host: ${both}; worse pass: ${worse.measured}`, verdict: worse.verdict },
    unstable: `unstable on this host: ${both}`,
  }
}

// Count rows ("-proves-") across two passes: the WORSE pass decides (CONFIRMS < NEW-EDGE < CONTRADICTS; on a tie,
// the pass with fewer hits), and every count that differs is recorded "k/n vs k2/n".
export const isCountRow = (id: string) => /-proves-|^n-wheel-/.test(id)
// The one merge order: CONTRADICTS > UNMEASURED (a pass that failed to measure) > NEW-EDGE > CONFIRMS.
export const MERGE_RANK: Readonly<Record<Verdict, number>> = {
  CONFIRMS: 0,
  "NEW-EDGE": 1,
  UNMEASURED: 2,
  INVALID: 2,
  CONTRADICTS: 3,
}
const countRank = (v: Verdict) => MERGE_RANK[v]
const hits = (m: string) => [...m.matchAll(/(\d+)\/(\d+)/g)].reduce((t, x) => t + Number(x[1]), 0)
export function worstOfCountPasses(
  id: string,
  a: Result,
  b: Result,
): { readonly result: Result; readonly differ: boolean } | undefined {
  if (!isCountRow(id)) return undefined
  const [ra, rb] = [countRank(a.verdict), countRank(b.verdict)]
  const [worse, other] =
    ra !== rb ? (ra > rb ? [a, b] : [b, a]) : hits(a.measured) <= hits(b.measured) ? [a, b] : [b, a]
  const others = [...other.measured.matchAll(/(\d+)\/(\d+)/g)].map((x) => x[0])
  let i = 0
  let differ = false
  const measured = worse.measured.replace(/(\d+)\/(\d+)/g, (m) => {
    const o = others[i++]
    if (o === undefined || o === m) return m
    differ = true
    return `${m} vs ${o}`
  })
  return { result: { measured, verdict: worse.verdict }, differ }
}

// Rows gated on a positive control are compared together with it: if the control failed in either pass (the
// ledger's or this one), the gated rows' combined verdict is UNMEASURED and verify reports SAME, naming both counts.
export const CONTROL_GATES: Readonly<Record<string, readonly string[]>> = {
  "n-wheel-control-settled": ["n-wheel-after-raise-dwmflush", "n-wheel-after-raise-5ms"],
}
// ONE control-text format: the writer (wheelResults) prints controlText, the count merge adds " vs b/n", and
// parseControl reads exactly that, so a committed ledger row round-trips through its own rerun.
export const controlText = (d: number, n: number) => `control delivered ${d}/${n}`
export function parseControl(m: string | undefined): Array<readonly [number, number]> | undefined {
  const x = /control delivered (\d+)\/(\d+)(?: vs (\d+)\/(\d+))?/.exec(m ?? "")
  if (!x) return undefined
  return x[3]
    ? [
        [Number(x[1]), Number(x[2])],
        [Number(x[3]), Number(x[4])],
      ]
    : [[Number(x[1]), Number(x[2])]]
}
const controlOk = (m: string | undefined) => !!parseControl(m)?.every(([d, n]) => n > 0 && d === n)
export function gatedVerify(ledger: readonly LedgerRow[], results: Record<string, Result>, host: string) {
  const out = new Map<string, { readonly kind: "SAME"; readonly text: string }>()
  for (const [ctl, gated] of Object.entries(CONTROL_GATES)) {
    const row = ledger.find((r) => r.id === ctl && r.host === host)
    const now = results[ctl]
    if (!row || !now || now.skip || (controlOk(row.measured) && controlOk(now.measured))) continue
    const k = (m: string) =>
      parseControl(m)
        ?.map(([d, n]) => `${d}/${n}`)
        .join(" vs ") ?? "?"
    const why = `control failed in a pass: ${k(row.measured)} vs ${k(now.measured)}`
    for (const id of gated)
      out.set(id, {
        kind: "SAME",
        text: `SAME ${id} UNMEASURED combined with its control (${why}); now: ${clean(results[id]?.measured ?? "missing")}`,
      })
  }
  return out
}

// The two-pass job: pass 1 is the measure pass's ledger, pass 2 this verify pass. Every row is merged worst-of
// (gated rows with their control, count rows by count, timing rows by p95, any other row by verdict), and the job
// fails only where the MERGED verdict differs from the COMMITTED ledger's, never on pass-to-pass jitter.
// Two passes of one row: the worse by MERGE_RANK decides and BOTH passes' texts are kept, so a failed pass never
// hides. Passes with the same verdict merge by count ("a vs b") or p95 ("first recorded: p95 a / b").
export function mergeTwo(id: string, a: Result, b: Result): Result {
  if (a.verdict === b.verdict && a.measured === b.measured) return b
  if (a.verdict === b.verdict && a.verdict !== "UNMEASURED") {
    const m = worstOfCountPasses(id, a, b)?.result ?? worstOfPasses(id, a, b)?.result
    if (m) return m
  }
  const [worse, other] = MERGE_RANK[a.verdict] >= MERGE_RANK[b.verdict] ? [a, b] : [b, a]
  return { measured: `${worse.measured} || other pass ${other.verdict}: ${other.measured}`, verdict: worse.verdict }
}
export function mergePasses(
  pass1: readonly LedgerRow[],
  pass2: Record<string, Result>,
  host: string,
): Record<string, Result> {
  const out: Record<string, Result> = {}
  const gated = gatedVerify(pass1, pass2, host)
  for (const [id, b] of Object.entries(pass2)) {
    const r = pass1.find((x) => x.id === id && x.host === host)
    if (!r || b.skip) {
      out[id] = b
      continue
    }
    const a: Result = { measured: r.measured, verdict: r.verdict as Verdict }
    const g = gated.get(id)
    if (g) {
      out[id] = UN(g.text.replace(/^SAME \S+ UNMEASURED combined with its control \(([^)]*)\); now: /, "$1; pass 2: "))
      continue
    }
    out[id] = mergeTwo(id, a, b)
  }
  // the merged rows (the uploaded artifact) go through the one verdict function too, so they round-trip
  return Object.fromEntries(Object.entries(out).map(([id, r]) => [id, finalRow(id, r)]))
}
export function verifyJob(
  pass1: readonly LedgerRow[],
  pass2: Record<string, Result>,
  committed: readonly LedgerRow[],
  host: string,
  want: (id: string) => boolean,
) {
  const merged = mergePasses(pass1, pass2, host)
  // the wheel-control ruling: a gated row UNMEASURED because ITS control failed in a pass is not a difference
  const gated = gatedVerify(pass1, pass2, host)
  const lines: string[] = []
  let diff = 0
  for (const [id, m] of Object.entries(merged).filter(([k]) => want(k))) {
    const c = committed.find((x) => x.id === id && x.host === host)
    const g = gated.get(id)
    if (m.skip) lines.push(`SKIP ${id}: not re-measured by this pass: ${m.skip}`)
    else if (g && m.verdict === "UNMEASURED" && c)
      lines.push(
        `SAME ${id} committed=${c.verdict} merged=UNMEASURED, not compared: ${/control failed in a pass: [^)]*/.exec(g.text)?.[0] ?? "control failed in a pass"}; ${clean(m.measured)}`,
      )
    else if (!c || c.verdict !== m.verdict) {
      diff++
      lines.push(`DIFF ${id} committed=${c?.verdict ?? "missing"} merged=${m.verdict} ${clean(m.measured)}`)
    } else lines.push(`SAME ${id} ${m.verdict} ${clean(m.measured)}`)
  }
  return { merged, lines, diff }
}

// One --verify comparison: rows of other hosts and rows this pass did not re-measure are skipped with the reason;
// timing rows compare worst-of-passes, so jitter across a bound reads UNSTABLE, never DIFF.
export function verifyLine(
  row: LedgerRow,
  result: Result | undefined,
  host: string,
): { readonly kind: "SAME" | "DIFF" | "SKIP" | "UNSTABLE"; readonly text: string } {
  if (row.host !== host) return { kind: "SKIP", text: `SKIP ${row.id} host=${row.host}` }
  if (result?.skip) return { kind: "SKIP", text: `SKIP ${row.id}: not re-measured by this pass: ${result.skip}` }
  const ledgerResult: Result = { measured: row.measured, verdict: row.verdict as Verdict }
  const c = result ? worstOfCountPasses(row.id, ledgerResult, result) : undefined
  // count rows: a re-confirm never DIFFs, a worse pass always does, and both passes' counts are shown either way
  if (c && result)
    return countRank(result.verdict) > countRank(ledgerResult.verdict)
      ? {
          kind: "DIFF",
          text: `DIFF ${row.id} ledger=${row.verdict} now=${result.verdict} worst of passes: ${clean(c.result.measured)}`,
        }
      : { kind: "SAME", text: `SAME ${row.id} ${row.verdict} worst of passes: ${clean(c.result.measured)}` }
  const w = result ? worstOfPasses(row.id, ledgerResult, result) : undefined
  if (w?.unstable && w.result.verdict !== row.verdict)
    return {
      kind: "UNSTABLE",
      text: `UNSTABLE ${row.id} ledger=${row.verdict} now=${result?.verdict} worst=${w.result.verdict} (${w.unstable}): jitter, not a difference`,
    }
  if (w?.unstable) return { kind: "SAME", text: `SAME ${row.id} ${row.verdict} worst of passes (${w.unstable})` }
  if (!result || result.verdict !== row.verdict)
    return {
      kind: "DIFF",
      text: `DIFF ${row.id} ledger=${row.verdict} now=${result?.verdict ?? "missing"} ${clean(result?.measured ?? "")}`,
    }
  return { kind: "SAME", text: `SAME ${row.id} ${result.verdict} ${clean(result.measured)}` }
}

// Reconnects the session to the console through a SYSTEM task (tscon), then drops the task; the result
// ("active", or why not) is written into the rows.
async function restoreSession(
  ctx: Ctx,
  sid: number,
): Promise<{ readonly text: string; readonly restored: boolean; readonly after: Json | undefined }> {
  const started = await asSystem(ctx, "tscon", `tscon.exe ${sid} /dest:console`).catch((e: Error) => ({
    code: Number.NaN,
    out: e.message,
  }))
  let back = `not-restored(schtasks ${Number.isNaN(started.code) ? "not started" : `exit ${started.code}`}: ${clean(started.out).slice(0, 120)})`
  let lastRead = ""
  let after: Json | undefined
  // restored only when PROVEN: connected and active, OpenInputDesktop succeeds again (Default), and unlocked
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(500)
    const s = await leg(ctx, "disconnect-state", { sid }).catch((e: Error) => e)
    if (s instanceof Error) {
      lastRead = s.message
      continue
    }
    after = s
    if (num(s.connectState) === 0 && s.inputDesktop === "Default" && s.lock === "unlock") {
      back = "active"
      lastRead = ""
      break
    }
    lastRead = `connectState=${str(s.connectState)} inputDesktop=${str(s.inputDesktop) || "(OpenInputDesktop failed)"} lock=${str(s.lock)}`
  }
  return {
    text: `${back}${lastRead ? `; last read: ${clean(lastRead).slice(0, 160)}` : ""},task-${await dropTask("tscon")}`,
    restored: back === "active",
    after,
  }
}

// The disconnected and locked legs: a capture helper waits in this session
// while it changes state; a SYSTEM task (tscon) then reconnects it to the console.
async function sessionLeg(ctx: Ctx, t: Target, state: "disconnected" | "locked") {
  if (state === "locked" && !ctx.allowIrreversible)
    return Object.fromEntries(captureIds(state).map((id) => [id, { ...UN(CANNOT_RESTORE), skip: CANNOT_RESTORE }]))
  if (ctx.session.unusable) return all(captureIds(state), UN(ctx.session.unusable))
  const sid = num(ctx.facts.sessionId)
  const out = join(ctx.shared, `capture-${state}.json`)
  rmSync(out, { force: true })
  const argFile = join(ctx.shared, `capture-${state}.arg.json`)
  writeFileSync(argFile, JSON.stringify({ top: t.top, waitFor: state, waitMs: 12_000 }))
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
  const reconnect: Cleanup = { name: `reconnect-${state}`, run: async (c) => (await restoreSession(c, sid)).text }
  ctx.cleanups.push(reconnect)
  const changed = await leg(ctx, state === "disconnected" ? "disconnect" : "lock")
  const read = await waitFile(out, 30_000).catch((e: Error) => e)
  const r = read instanceof Error ? undefined : read
  ctx.cleanups.splice(ctx.cleanups.indexOf(reconnect), 1)
  const back = await restoreSession(ctx, sid)
  if (!back.restored) ctx.session.unusable = `session not restored after the ${state} leg: ${back.text}`
  const skip = !r
    ? `the capture helper produced no result: ${read instanceof Error ? read.message : "-"}; ${JSON.stringify(changed)}`
    : sessionProblem(state, r, sid, back.after)
  const res = captureResults(state, r, skip)
  return Object.fromEntries(
    Object.entries(res).map(([id, x]) => [id, { ...x, measured: `${x.measured} reconnect=${back.text}` }]),
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
      // Last, and only with --allow-irreversible: a lock that cannot be undone leaves the desktop unusable.
      ...(await sessionLeg(ctx, t, "locked")),
    }
  },
}

// ---------------------------------------------------------------- the one verdict function
// Every row is decided here from a typed record. Only MEASURED yields CONFIRMS, CONTRADICTS or NEW-EDGE; SKIPPED and
// ERRORED always yield UNMEASURED with their reason. CONFIRMS / CONTRADICTS need the row's design citation (printed in
// the row); a row whose design states no claim reads NEW-EDGE. A row id with neither is refused when the table is built.
export type Outcome = "held" | "broken" | "edge" | "inconclusive"
export type Obs =
  | { readonly kind: "MEASURED"; readonly data: unknown; readonly reason?: string }
  | { readonly kind: "SKIPPED" | "ERRORED"; readonly data?: unknown; readonly reason: string }
export type Cite = { readonly design: string } | { readonly noClaim: string }
const D = (line: number, what: string): Cite => ({ design: `design/d-windows.md:${line} (${what})` })
const fromProperty = (p: string): Cite => {
  const c = PROPERTIES[p]
  return c ? { design: c } : { noClaim: `no design line for ${p}` }
}
const CITE_RULES: ReadonlyArray<readonly [RegExp, Cite]> = [
  [/^n-host-/, { noClaim: "a fact about the measuring host, not a design claim" }],
  [/^n-wgc-issupported-/, D(79, "WGC IsSupported() once per session open")],
  [/^n-dwmflush-ms$/, { noClaim: "the design states no DwmFlush time bound" }],
  [/^n-poll-/, D(130, "each hop polls at 1 ms")],
  [/^n-barrier-fg-/, D(130, "## Input, Barrier: routed hop + consumed hop, 5 s hang guard")],
  [/^n-barrier-posted-[a-z]+-notepad$/, fromProperty("postedLandsClassic")],
  [/^n-barrier-posted-[a-z]+-webview2$/, fromProperty("dropMatrixWebView2")],
  [/^n-barrier-posted-[a-z]+-wpf$/, fromProperty("dropMatrixWpf")],
  [/^n-(fg|posted)-chord-/, D(132, "chords: VkKeyScanW on SendInput, one WM_CHAR per char posted")],
  [/^n-wheel-control-/, { noClaim: "no design line states that a settled foreground target receives the wheel" }],
  [/^n-wheel-after-raise-/, D(128, "DwmFlush before pointer: doc numbers 6/6 lost -> 18/18, re-measured")],
  [/^n-affinity-/, D(393, "cover-window oracle reads > 0 -> hide_ack")],
  [/^n-uipi-/, D(151, "windows above the engine's integrity RID: UIPI drops input silently")],
  [/^n-elevated-/, D(151, "windows above the engine's integrity RID: PermissionDenied{band}")],
  [
    /^n-capture-.*-(display-off|disconnected|locked)$/,
    D(
      245,
      "session state: lock / unlock / disconnect from WM_WTSSESSION_CHANGE, frames judged by the near-black oracle of design/d-windows.md:80",
    ),
  ],
  [/^n-capture-/, D(80, "PrintWindow floor and the near-black oracle")],
]
export function buildCites(ids: readonly string[], rules = CITE_RULES): Readonly<Record<string, Cite>> {
  const out: Record<string, Cite> = {}
  const missing: string[] = []
  for (const id of ids) {
    const hit = rules.find(([re]) => re.test(id))
    if (hit) out[id] = hit[1]
    else missing.push(id)
  }
  if (missing.length)
    throw new Error(`ROW_CITES: rows with no design citation and no stated absence: ${missing.join(",")}`)
  return out
}
export const ROW_CITES = buildCites(Object.keys(SPEC))
const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0
function invalidData(d: unknown): string | undefined {
  if (!d || typeof d !== "object") return "no data"
  const x = d as Record<string, unknown>
  if (!["held", "broken", "edge", "inconclusive"].includes(x.outcome as string)) return `outcome ${String(x.outcome)}`
  if (typeof x.text !== "string" || !x.text) return "no text"
  if (x.counts === undefined) return undefined
  if (!x.counts || typeof x.counts !== "object" || Array.isArray(x.counts)) return "counts not an object"
  for (const [k, v] of Object.entries(x.counts)) {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(isInt) || v[0] > v[1] || v[1] === 0)
      return `count ${k}=${String(v)}`
  }
  return undefined
}
export function rowVerdict(id: string, obs: Obs, cites: Readonly<Record<string, Cite>> = ROW_CITES): Result {
  const cite = cites[id]
  if (!cite) throw new Error(`row ${id} has no design citation`)
  const why = (r: unknown) => (typeof r === "string" && r ? r : "no reason given")
  if (obs?.kind === "SKIPPED" || obs?.kind === "ERRORED")
    return UN(`${obs.kind === "SKIPPED" ? "skipped" : "errored"}: ${why(obs.reason)}`)
  if (obs?.kind !== "MEASURED") return UN(`errored: invalid record kind ${String((obs as { kind?: unknown })?.kind)}`)
  const bad = invalidData(obs.data)
  if (bad) return UN(`errored: invalid measurement: ${bad}`)
  const d = obs.data as { readonly outcome: Outcome; readonly text: string }
  if (d.outcome === "inconclusive") return UN(d.text)
  if (d.outcome === "edge") return { measured: d.text, verdict: "NEW-EDGE" }
  if ("noClaim" in cite) return { measured: `${d.text}; no design claim: ${cite.noClaim}`, verdict: "NEW-EDGE" }
  const line = cite.design.split(" ")[0] ?? cite.design
  return {
    measured: d.text.includes(line) ? d.text : `${d.text}; per ${cite.design}`,
    verdict: d.outcome === "held" ? "CONFIRMS" : "CONTRADICTS",
  }
}
// A group's result as a record: the groups judge held/broken/edge; the verdict and its citation come only from here.
export function toObs(r: Result): Obs {
  if (r.verdict !== "UNMEASURED")
    return {
      kind: "MEASURED",
      data: {
        outcome: r.verdict === "CONFIRMS" ? "held" : r.verdict === "CONTRADICTS" ? "broken" : "edge",
        text: r.measured,
      },
    }
  const reason = r.measured.replace(/^UNMEASURED: /, "")
  if (/^p95 [\d.]+ ms within \d+ % of the /.test(reason))
    return { kind: "MEASURED", data: { outcome: "inconclusive", text: reason } }
  const m = /^(skipped|errored): ([\s\S]*)$/.exec(reason)
  if (m) return { kind: m[1] === "errored" ? "ERRORED" : "SKIPPED", reason: m[2] ?? "" }
  // ERRORED only where the probe says so ("errored: "); a reason is never classified by guessing at its words
  return { kind: "SKIPPED", reason }
}
// INVALID is a ledger-only state (a withdrawn reading); measurement never produces it
export const finalRow = (id: string, r: Result, cites: Readonly<Record<string, Cite>> = ROW_CITES): Result =>
  r.verdict === "INVALID" ? r : { ...rowVerdict(id, toObs(r), cites), ...(r.skip ? { skip: r.skip } : {}) }

const GROUPS: readonly Group[] = [
  hostFacts,
  isSupported,
  timers,
  barriers,
  chords,
  wheel,
  affinity,
  secondMonitor,
  elevated,
  capture,
]

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
export async function runGroup(g: Group, ctx: Ctx, cites = ROW_CITES): Promise<Record<string, Result>> {
  const r = await withBudget(g.budgetS, g.cleanupS ?? 0, ctx, (own) =>
    g.run(own).catch((e: Error) => all(g.ids, UN(`errored: leg failed: ${clean(e.message)}`))),
  )
  const rows = r.timedOut
    ? all(
        g.ids,
        UN(`errored: timeout after ${r.elapsedS}s${r.cleanup.length ? `; cleanup ${r.cleanup.join(" ")}` : ""}`),
      )
    : r.value
  // every row of every group goes through the one verdict function
  return Object.fromEntries(Object.entries(rows).map(([id, x]) => [id, finalRow(id, x, cites)]))
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
  n && n !== "-" && !/^(probe defect|SUSPECT|lock state unproven|NEW-EDGE \(not a design claim\))/.test(n) ? n : "-"
// The native assembly the helpers used ("precompiled sha256=..." or the run-time Add-Type), one note segment,
// replaced on every pass; recorded on the rows whose helper runs restricted (the elevated group).
export function nativeNote(note: string, native: unknown): string {
  if (typeof native !== "string" || !native) return note
  const kept = note.split("; ").filter((s) => s !== "-" && !s.startsWith("native assembly: "))
  return [...kept, `native assembly: ${native}`].join("; ")
}
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
  let allowIrreversible = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--measure") mode = "measure"
    else if (a === "--allow-irreversible") allowIrreversible = true
    else if (a === "--verify") {
      mode = "verify"
      file = argv[++i] ?? fail("USAGE --verify needs a ledger path")
    } else if (a === "--out") file = argv[++i] ?? fail("USAGE --out needs a path")
    else if (a === "--host") host = argv[++i] ?? fail("USAGE --host needs a label")
    else if (a === "--row") rows.push(argv[++i] ?? fail("USAGE --row needs an id"))
    else fail(`USAGE unknown argument ${a}`)
  }
  if (!mode) fail("USAGE --measure [--out <tsv>] | --verify <tsv> [--row <id>] [--host <label>] [--allow-irreversible]")
  return { mode, file, host, rows, allowIrreversible }
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
  allowIrreversible: false,
  session: {},
})
// The text of a probe file. The line-ending check swaps it for a re-encoded copy to prove every source check reads
// LF, CRLF and mixed checkouts alike (Windows checks the .ps1 files out with CRLF).
let sourceAs: ((text: string) => string) | undefined
const source = (file: string) => {
  const text = readFileSync(join(HERE, file), "utf8")
  return sourceAs ? sourceAs(text) : text
}

// PowerShell text reduced to its code, one entry per line, for the source scans. Line endings of any kind
// (CRLF, LF, lone CR) are normalised; <# ... #> blocks, here-strings (@' '@, @" "@) and # comments outside
// quotes, whole-line or trailing, become blank. Line numbers are kept.
export function psCode(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let block = false
  let here: string | undefined
  for (const line of lines) {
    if (here) {
      if (line.startsWith(here)) here = undefined
      out.push("")
      continue
    }
    let code = ""
    let quote: string | undefined
    for (let i = 0; i < line.length; i++) {
      const c = line[i] ?? ""
      if (block) {
        if (c === "#" && line[i + 1] === ">") {
          block = false
          i++
        }
        continue
      }
      if (quote) {
        code += c
        if (c === "`") {
          code += line[i + 1] ?? ""
          i++
        } else if (c === quote) quote = undefined
        continue
      }
      if (c === "<" && line[i + 1] === "#") {
        block = true
        i++
        continue
      }
      if (c === "@" && (line[i + 1] === "'" || line[i + 1] === '"') && line.slice(i + 2).trim() === "") {
        here = `${line[i + 1]}@`
        break
      }
      if (c === "#") break
      if (c === "'" || c === '"') quote = c
      code += c
    }
    out.push(code)
  }
  return out
}
const LEG_FILES = ["sp-n-legs-delivery.ps1", "sp-n-legs-capture.ps1", "sp-n-legs-session.ps1"]
const legsSource = () => LEG_FILES.map(source).join("\n")
const WORKFLOW = join(HERE, "..", "..", "..", ".github", "workflows", "computer-spike-windows.yml")

// Lines of PowerShell loops (for / foreach / while / do) whose body holds a return: in a loop, return leaves the
// whole leg function and skips its Emit.
export function returnsInLoops(source: string): string[] {
  // comments, comment blocks and here-strings are blanked by psCode (line numbers hold): a comment may say "return"
  const ps = psCode(source).join("\n")
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

const TEST_CITES: Readonly<Record<string, Cite>> = Object.fromEntries(
  ["t-a", "t-b", "t-c"].map((id) => [id, { noClaim: "test row" }]),
)
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
      if (
        !/freshDir\(ctx\.shared, \(p\) => io\.lockDown\(ctx, p\)\)/.test(self) ||
        !/lockDown: lockDownWindows,/.test(self)
      )
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
      const plain = await runGroup({ ids: ["t-a", "t-b"], budgetS: 1, run: never }, testCtx(), TEST_CITES)
      for (const id of ["t-a", "t-b"])
        if (plain[id]?.verdict !== "UNMEASURED" || plain[id]?.measured !== "UNMEASURED: errored: timeout after 1s")
          return `${id}: want "UNMEASURED: errored: timeout after 1s", got ${JSON.stringify(plain[id])}`
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
        TEST_CITES,
      )
      if (!cleaned) return "the cleanup did not run before runGroup returned"
      const m = withCleanup["t-c"]?.measured
      return m === "UNMEASURED: errored: timeout after 1s; cleanup reconnect=active"
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
      const main = self.slice(self.search(/^async function main\(\): Promise<number> \{$/m))
      const checks = main.indexOf("await logicChecks()")
      const prep = self.slice(self.search(/^export async function prepare\(/m))
      // the checks run in main before prepare(), whose first step is the platform check
      return checks >= 0 &&
        checks < main.indexOf("await prepare(") &&
        /^\S[^\n]*\{\n {2}if \(io\.platform !== "win32"\)/.test(prep)
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
    finding: "SETUP error-to-nothing (hosted run 43220783638)",
    async run() {
      const bad: string[] = []
      // the helper: every setup step (fragments, start marker, argument file, native type) runs in the handled path
      const code = psCode(source("sp-n.ps1"))
      const top = code.filter((l) => /^(Compile\b|\$a = |foreach \(\$f in .*\{ \. )/.test(l))
      if (top.length) bad.push(`setup runs outside the handled path: ${top.join(" | ")}`)
      const handled =
        /\ntry \{\n(?:[ \t][^\n]*\n|\n)*?[ \t]+Compile\b[^\n]*\n(?:[ \t][^\n]*\n|\n)*?\} catch \{ Emit @\{ legError = "setup failed: /
      if (!handled.test(code.join("\n"))) bad.push('a failing setup does not report legError "setup failed: ..."')
      const emit = code.slice(code.findIndex((l) => l.startsWith("function Emit"))).join("\n")
      if (!/^function Emit[\s\S]*?'SpN' -as \[type\][\s\S]*?\n\}/.test(emit))
        bad.push("Emit needs the native type for sessionId, so a setup error cannot be reported")
      if (!code.some((l) => /^\s+if \(\$Out\) \{ \[IO\.File\]::WriteAllText\("\$Out\.started"/.test(l)))
        bad.push("the helper writes no start marker beside -Out")
      if (
        !/waitFile\(out, 60_000, \{ started: `\$\{out\}\.started`, alive: pidAlive \}\)/.test(source("probe-sp-n.ts"))
      )
        bad.push("the medium leg does not watch the helper's start marker")
      // the probe: a helper that never started, exited silently, or still runs is named, never a plain timeout
      const dir = join(tmpdir(), `omo-sp-n-setup-${process.pid}`)
      mkdirSync(dir, { recursive: true })
      try {
        const out = join(dir, "uipi.medium.json")
        const watch = (alive: boolean) => ({ started: `${out}.started`, alive: async () => alive })
        const why = (alive: boolean) =>
          waitFile(out, 300, watch(alive)).then(
            (v: unknown) => `resolved ${JSON.stringify(v)}`,
            (e: Error) => e.message,
          )
        const absent = await why(false)
        if (!/not written within 0\.3 s; the helper never started/.test(absent))
          bad.push(`a helper that never started reads: ${absent}`)
        writeFileSync(`${out}.started`, JSON.stringify({ pid: 4242 }))
        const silent = await why(false)
        if (!/the helper \(pid 4242\) exited without writing a result \(silent exit\)/.test(silent))
          bad.push(`a silent exit reads: ${silent}`)
        const running = await why(true)
        if (!/the helper \(pid 4242\) is still running/.test(running)) bad.push(`a running helper reads: ${running}`)
        // a setup error the helper reported: the row is UNMEASURED with its text, never a timeout
        const text = "setup failed: A required privilege is not held by the client (line 128)"
        writeFileSync(out, JSON.stringify({ legError: text, leg: "uipi" }))
        const g: Group = {
          budgetS: 5,
          ids: ["n-uipi-postmessage"],
          async run() {
            await waitFile(out, 300, watch(false))
            return {}
          },
        }
        const r = (await runGroup(g, testCtx()))["n-uipi-postmessage"]
        if (r?.verdict !== "UNMEASURED" || !r.measured.includes(text) || /timeout|not written/.test(r.measured))
          bad.push(`a reported setup error reads: ${JSON.stringify(r)}`)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "SETUP precompiled native assembly (hosted run 43220783638)",
    async run() {
      const bad: string[] = []
      const helper = psCode(source("sp-n.ps1")).join("\n")
      const compile = helper.slice(helper.indexOf("function Compile {"), helper.indexOf("function Emit("))
      // load the precompiled assembly from the very bytes whose sha256 matched its recorded value
      if (!/\$NativeDll = Join-Path \$PSScriptRoot 'sp-n-native\.dll'/.test(helper))
        bad.push("the helper does not look for sp-n-native.dll beside itself")
      const order = [
        /Test-Path -LiteralPath \$NativeDll/,
        /\[IO\.File\]::ReadAllBytes\(\$NativeDll\)/,
        /SHA256/,
        /throw "native assembly sha256 mismatch/,
        /\[Reflection\.Assembly\]::Load\(\$bytes\)/,
        /\} else \{/,
        /Add-Type -TypeDefinition \$SpNNative/,
      ].map((re) => compile.search(re))
      if (order.some((i) => i < 0) || order.some((v, i) => i > 0 && v < (order[i - 1] ?? 0)))
        bad.push(`Compile does not check, load, then fall back to Add-Type in that order (${order.join(",")})`)
      if (/LoadFile|LoadFrom|Add-Type -Path/.test(compile)) bad.push("Compile loads by path, not the hashed bytes")
      if ((helper.match(/Add-Type -TypeDefinition/g) ?? []).length !== 2)
        bad.push("Add-Type -TypeDefinition appears outside Compile's fallback and the build leg")
      if (!/if \(\$Leg -eq 'build-native'\) \{ BuildNative; exit 0 \}\n\s+Compile/.test(helper))
        bad.push("no build-native leg ahead of Compile in the handled path")
      if (!/-OutputAssembly \$NativeDll -OutputType Library/.test(helper)) bad.push("BuildNative writes no library")
      if (!/\$r\['native'\] = \$script:NativeFrom/.test(helper))
        bad.push("Emit does not report which native type it used")
      const yml = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, "utf8") : ""
      const build = yml.indexOf("sp-n.ps1 -Leg build-native")
      if (build < 0 || build > yml.indexOf("-Leg precondition"))
        bad.push("the workflow does not precompile before the legs run")
      if (!/^sp-n-native\.dll\*?$/m.test(existsSync(join(HERE, ".gitignore")) ? source(".gitignore") : ""))
        bad.push("the built assembly is not ignored by git")
      // packaging only: nothing in the helpers changes a token, an integrity level or a privilege
      const files = [...LEG_FILES, "sp-n.ps1", "sp-n-target.ps1", "sp-n-native-win32.ps1", "sp-n-native-input.ps1"]
      const tok = files.filter((f) =>
        /AdjustTokenPrivileges|SetTokenInformation|OpenProcessToken|DuplicateToken|CreateProcessAsUser|CreateRestrictedToken/.test(
          source(f),
        ),
      )
      if (tok.length) bad.push(`token or privilege calls in ${tok.join(",")}`)
      // the ledger notes of the rows whose helper runs restricted carry the assembly used, one segment, replaced
      const note = (n: string, native: unknown) => nativeNote(n, native)
      const cases: Array<[string, unknown, string]> = [
        ["-", "precompiled sha256=ab12", "native assembly: precompiled sha256=ab12"],
        [
          "x; native assembly: precompiled sha256=00",
          "precompiled sha256=ab12",
          "x; native assembly: precompiled sha256=ab12",
        ],
        ["design-adopted (y)", undefined, "design-adopted (y)"],
      ]
      for (const [n, v, want] of cases)
        if (note(n, v) !== want) bad.push(`nativeNote(${n}, ${String(v)}) = ${note(n, v)}, want ${want}`)
      if (
        !/nativeNote\(carriedNote\(notes\.get\(id\)\), elevated\.ids\.includes\(id\) \? ctx\.facts\.native : undefined\)/.test(
          source("probe-sp-n.ts"),
        )
      )
        bad.push("the measure pass does not record the native assembly in the elevated rows' notes")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "MONITORS second-monitor rows on any host with two (hosted run 43220783638)",
    async run() {
      const bad: string[] = []
      const two: Json = {
        monitors: [
          { primary: true, w: 3840, h: 2160, x: 0, y: 0, dpi: "96" },
          { primary: false, w: 1024, h: 768, x: 3840, y: 0, dpi: "96" },
        ],
      }
      const one: Json = { monitors: [{ primary: true, w: 1024, h: 768, x: 0, y: 0, dpi: "96" }] }
      const ids = ["n-host-second-monitor", "n-affinity-wgc-monitor-secondary"]
      const has = (host: string, facts: Json) => ids.filter((id) => rowsForHost(host, facts).includes(id))
      if (has(HOSTED, two).length !== 2)
        bad.push(`two monitors on ${HOSTED}: rows ${has(HOSTED, two).join(",") || "none"}`)
      if (has(HOSTED, one).length) bad.push(`one monitor on ${HOSTED}: rows ${has(HOSTED, one).join(",")}`)
      if (has(H6, one).length !== 2) bad.push("H6 with one monitor lost its second-monitor rows")
      if (rowsForHost(HOSTED, two).includes("n-host-admin")) bad.push("n-host-admin selected off H6")
      // the host fact: the count, every monitor's resolution and DPI
      const ctx = testCtx()
      ctx.facts = { ...two, inAdministrators: true, elevated: true, sessionId: 1, inputDesktop: "Default" }
      const host = await hostFacts.run(ctx)
      const m = host["n-host-second-monitor"]?.measured ?? ""
      if (!/monitors=2 /.test(m) || !/3840x2160@0,0 dpi=96/.test(m) || !/1024x768@3840,0 dpi=96/.test(m))
        bad.push(`second-monitor fact lacks count, resolutions or DPI: ${m}`)
      if (hostFacts.ids.includes("n-affinity-wgc-monitor-secondary"))
        bad.push("the secondary capture row is still a host fact, not a capture leg")
      // the capture leg on the second monitor, judged like the primary-monitor affinity row
      const leg = (magenta: number): Json => ({
        wgcMonitor: { magenta, info: {} },
        setAffinityOk: true,
        affinityRead: 17,
      })
      const r1 = secondaryResults(arr(one.monitors), undefined, undefined)["n-affinity-wgc-monitor-secondary"]
      if (r1?.verdict !== "UNMEASURED" || !/^UNMEASURED: skipped: one present monitor/.test(r1.measured))
        bad.push(`one monitor: ${JSON.stringify(r1)}`)
      const cases: Array<[Json, Json, Verdict]> = [
        [leg(1), leg(0), "CONFIRMS"],
        [leg(1), leg(0.5), "CONTRADICTS"],
        [leg(0), leg(0), "UNMEASURED"],
      ]
      for (const [c, x, want] of cases) {
        const r = secondaryResults(arr(two.monitors), c, x)["n-affinity-wgc-monitor-secondary"]
        if (r?.verdict !== want || !/monitor 2 of 2 1024x768@3840,0/.test(r.measured))
          bad.push(`control ${JSON.stringify(c)} excluded ${JSON.stringify(x)}: ${JSON.stringify(r)}, want ${want}`)
      }
      if (!GROUPS.some((g) => g.ids.includes("n-affinity-wgc-monitor-secondary")))
        bad.push("no group measures n-affinity-wgc-monitor-secondary")
      const capture = psCode(source("sp-n-legs-capture.ps1")).join("\n")
      if (
        !/function Leg-affinity-monitor\(\$a\) \{[\s\S]*?\[SpN\]::Overlay\([\s\S]*?\[SpN\]::Wgc\(\[IntPtr\]::Zero, \$hmon/.test(
          capture,
        )
      )
        bad.push("sp-n-legs-capture.ps1 has no WGC monitor leg for a given monitor rectangle")
      if (!/dpi = \[SpN\]::MonitorDpi\(/.test(source("sp-n.ps1"))) bad.push("HostFacts reads no monitor DPI")
      return bad.length ? bad.join("; ") : undefined
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
        const main = self.slice(self.search(/^export async function prepare\(/m))
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
      const main = self.slice(self.search(/^export async function prepare\(/m))
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
      if (!moduleCmdlet.test("$x = Get-Acl -LiteralPath $p")) return "the cmdlet scan misses a known case"
      const files = ["sp-n.ps1", "sp-n-target.ps1", ...LEG_FILES]
      const hits = files.flatMap((f) =>
        psCode(source(f))
          .map((l, i) => [l, i + 1] as const)
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
    finding: "ENDINGS ps-code (hosted run 43134728411)",
    async run() {
      const flagged = (text: string) =>
        psCode(text)
          .map((l, i) => [l, i + 1] as const)
          .filter(([l]) => /\bGet-Acl\b/i.test(l))
          .map(([, n]) => n)
      // calls that must be flagged in every form, comments that must not be
      const sample = [
        "$a = Get-Acl -LiteralPath $p", // 1 call
        "# Get-Acl in a line comment", // 2
        "    # Get-Acl indented comment", // 3
        "$b = 1 # Get-Acl trailing comment", // 4
        "$c = 2; # Get-Acl after a statement", // 5
        "<# Get-Acl in a one-line block #>", // 6
        "<#", // 7
        "  Get-Acl inside a block", // 8
        "#>", // 9
        "<# block #> $d = Get-Acl $p", // 10 call after a block
        "$e = '# not a comment'; Get-Acl $p", // 11 call after a quoted #
        "$f = @'", // 12
        "Get-Acl inside a here-string", // 13
        "'@", // 14
        "Get-Acl $p # and a trailing comment", // 15 call
      ]
      const want = "1,10,11,15"
      const endings: Array<[string, (ls: string[]) => string]> = [
        ["LF", (ls) => ls.join("\n")],
        ["CRLF", (ls) => ls.join("\r\n")],
        ["mixed", (ls) => ls.map((l, i) => l + (i % 3 === 0 ? "\r\n" : i % 3 === 1 ? "\n" : "\r")).join("")],
        ["CRLF with final newline", (ls) => `${ls.join("\r\n")}\r\n`],
      ]
      const bad = endings
        .map(([name, join]) => [name, flagged(join(sample)).join(",")] as const)
        .filter(([, got]) => got !== want)
        .map(([name, got]) => `${name}: flagged lines ${got}, want ${want}`)
      const loop = ["while ($x) {", "  # return here is a comment", "  break", "}"]
      if (returnsInLoops(loop.join("\r\n")).length) bad.push("returnsInLoops counts a CRLF comment")
      if (returnsInLoops(["while ($x) {", "  return", "}"].join("\r\n")).length !== 1)
        bad.push("returnsInLoops misses a CRLF return")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "ENDINGS self-test-identical",
    async run() {
      // every other source check must give the same result on the files as checked out with LF and with CRLF
      const others = LOGIC_CHECKS.filter(
        (c) => !c.finding.startsWith("ENDINGS") && c.finding.startsWith("PSMODULE"),
      ).concat(
        LOGIC_CHECKS.filter((c) =>
          /return-in-loop|positive-control|foreground|last-error|webview2|OWNER|SWALLOW/.test(c.finding),
        ),
      )
      const runAll = async (as: ((t: string) => string) | undefined) => {
        sourceAs = as
        try {
          return (await runChecks(others)).join("\n")
        } finally {
          sourceAs = undefined
        }
      }
      const lf = await runAll((t) => t.replace(/\r\n?/g, "\n"))
      const crlf = await runAll((t) => t.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"))
      if (lf !== crlf)
        return `source checks differ between LF and CRLF copies: LF [${lf || "pass"}] CRLF [${crlf || "pass"}]`
      return others.length >= 8 ? undefined : `only ${others.length} source checks compared`
    },
  },
  {
    finding: "SESSION lock-positive (hosted run 43136347200)",
    async run() {
      const sid = 2
      const base = (during: string, desktop: string): Json => ({
        helperSid: sid,
        conditionMet: during === "lock",
        before: { lock: "unlock", desktop: "Default", connectState: 0 },
        during: { lock: during, desktop, connectState: 0 },
        duringEnd: { lock: during, desktop, connectState: 0 },
      })
      const restored: Json = { lock: "unlock", connectState: 0, inputDesktop: "Default" }
      const flags = ["lock", "unlock", "unknown", "error: WTSQuerySessionInformationW(WTSSessionInfoEx) failed: denied"]
      const desktops = ["Default", "Winlogon", ""]
      const bad: string[] = []
      for (const f of flags)
        for (const d of desktops) {
          const p = sessionProblem("locked", base(f, d), sid, restored)
          if (f === "lock" ? p !== undefined : p === undefined || !p.includes(f.split(":")[0] ?? f))
            bad.push(`lock=${f} desktop=${JSON.stringify(d)}: ${p ?? "accepted"}`)
        }
      if (
        !sessionProblem("locked", { ...base("lock", ""), before: { lock: "lock" } }, sid, restored)?.includes(
          "UNLOCK before",
        )
      )
        bad.push("a session already locked before the leg is accepted")
      if (
        !sessionProblem("locked", base("lock", ""), sid, { lock: "lock" })?.includes(
          "cannot restore session on this host",
        )
      )
        bad.push("a session still locked after the restore is accepted")
      if (!sessionProblem("locked", base("lock", "Default"), 3, restored)?.includes("not the run's session"))
        bad.push("a read of another session is accepted")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "SESSION disconnect-read",
    async run() {
      const sid = 2
      const r = (c: unknown, helperSid: number): Json => ({
        helperSid,
        conditionMet: c === 4,
        timeline: ["0ms connect=0 lock=unlock desktop=Default", "1800ms connect=4 lock=unlock desktop="],
        during: { connectState: c },
        duringEnd: { connectState: c },
      })
      const restored: Json = { connectState: 0, inputDesktop: "Default", lock: "unlock" }
      const bad: string[] = []
      for (const c of [4, 0, "error: WTSQuerySessionInformationW(session 2) failed"])
        for (const h of [sid, 3])
          for (const after of [restored, { connectState: 4, inputDesktop: "" }, undefined]) {
            const p = sessionProblem("disconnected", r(c, h), sid, after)
            const ok = c === 4 && h === sid && after === restored
            if (ok ? p !== undefined : p === undefined)
              bad.push(`connect=${c} sid=${h} after=${JSON.stringify(after)}: ${p ?? "accepted"}`)
          }
      const early = sessionProblem("disconnected", r(0, sid), sid, restored) ?? ""
      if (!early.includes("1800ms connect=4"))
        bad.push(`a missed WTSDisconnected does not report the states it saw: ${early}`)
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "SESSION irreversible-skip",
    async run() {
      const ctx = testCtx()
      const t: Target = { top: 1, edit: 2, state: undefined, title: "Notepad" }
      const rows = await sessionLeg(ctx, t, "locked").catch((e: Error) => e)
      if (rows instanceof Error) return `the lock leg ran without --allow-irreversible: ${rows.message}`
      const bad = captureIds("locked").filter(
        (id) => rows[id]?.verdict !== "UNMEASURED" || rows[id]?.skip !== CANNOT_RESTORE,
      )
      if (bad.length || ctx.spawned.length)
        return `locked rows not skipped with the reason, or a process started: ${bad.join(",")}`
      const row = (id: string, host: string, verdict: Verdict): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [h, h === "id" ? id : h === "host" ? host : h === "verdict" ? verdict : "x"]),
        ) as LedgerRow
      const v = verifyLine(
        row("n-capture-wgc-monitor-locked", "h", "CONTRADICTS"),
        rows["n-capture-wgc-monitor-locked"],
        "h",
      )
      if (v.kind !== "SKIP" || !v.text.includes("cannot restore session"))
        return `verify compares a row this pass cannot re-measure: ${v.text}`
      if (verifyLine(row("a", "h", "CONFIRMS"), { measured: "m", verdict: "CONTRADICTS" }, "h").kind !== "DIFF")
        return "verify misses a real difference"
      if (verifyLine(row("a", "o", "CONFIRMS"), undefined, "h").kind !== "SKIP")
        return "verify compares another host's row"
      const self = source("probe-sp-n.ts")
      const cap = self.slice(self.indexOf("const capture: Group = {"), self.indexOf("const GROUPS: readonly Group[]"))
      return cap.lastIndexOf("sessionLeg(") === cap.indexOf('sessionLeg(ctx, t, "locked")')
        ? undefined
        : "the lock leg is not the last session leg"
    },
  },
  {
    finding: "CAPTURE display-off-new-edge",
    async run() {
      const r = (cls: string, during: number): Json => ({
        printWindow: { class: cls },
        wgcWindow: { class: cls },
        wgcMonitor: { class: cls },
        displayStateBefore: 1,
        displayStateDuring: during,
        displayStateAfterWake: 1,
      })
      const bad: string[] = []
      const want: Array<[CaptureState, string, number, Verdict]> = [
        ["display-off", "frame", 0, "NEW-EDGE"],
        ["display-off", "null_frame", 0, "CONFIRMS"],
        ["display-off", "black_frame", 0, "CONFIRMS"],
        ["display-off", "frame", 1, "UNMEASURED"],
        ["active", "frame", 1, "CONFIRMS"],
        ["disconnected", "frame", 1, "CONTRADICTS"],
        ["locked", "black_frame", 1, "CONFIRMS"],
      ]
      for (const [st, cls, d, v] of want) {
        const got = captureResults(st, r(cls, d))
        const wrong = Object.entries(got).filter(([, x]) => x.verdict !== v)
        if (wrong.length) bad.push(`${st}/${cls}/display=${d}: ${wrong.map(([, x]) => x.verdict).join(",")}, want ${v}`)
      }
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "NOTEPAD text-read (hosted run 43136347200)",
    async run() {
      const native = source("sp-n-native-input.ps1")
      const decl = source("sp-n-native-win32.ps1")
      const main = psCode(source("sp-n.ps1")).join("\n")
      if (/GetTextOf/.test(native + main)) return "the old GetTextOf read is still used"
      const textOf = native.slice(
        native.indexOf("public static Hashtable TextOf("),
        native.indexOf("public static Hashtable SessionLock("),
      )
      if (!/h == IntPtr\.Zero/.test(textOf) || !/IsWindow\(h\)/.test(textOf) || !/catch \(Exception e\)/.test(textOf))
        return "TextOf does not turn a null, dead or failing handle into an error result"
      if (
        !/CharSet = CharSet\.Unicode\)\] public static extern IntPtr SendMessageTimeoutW\(IntPtr h, uint msg, IntPtr w, StringBuilder l/.test(
          decl,
        )
      )
        return "the StringBuilder SendMessageTimeoutW is not marshalled as Unicode"
      const effect = main.slice(main.indexOf("function EffectText("), main.indexOf("function WheelCount("))
      if (
        !/TextOf/.test(effect) ||
        !/ValuePattern/.test(effect) ||
        !/TextPattern/.test(effect) ||
        !/throw "edit text unreadable/.test(effect)
      )
        return "EffectText does not try WM_GETTEXT, then UI Automation, and fail with both reasons"
      const self = source("probe-sp-n.ts")
      return /for \(const child of \["RichEditD2DPT", "Edit"\]\)/.test(self)
        ? undefined
        : "Notepad is not looked up as RichEditD2DPT, then Edit"
    },
  },
  {
    finding: "BARRIER sent-count",
    async run() {
      const n = sentRuns([{ sent: 2 }, { sent: 0 }, { sent: true }, { sent: 1 }, {}])
      if (n !== 2) return `sentRuns counts ${n}, want 2 (runs whose SendInput accepted events)`
      return /count\(fg\.runs, "sent"\)/.test(source("probe-sp-n.ts"))
        ? "a barrier row still counts sent as a flag"
        : undefined
    },
  },
  {
    finding: "TIMING design-bounds (hosted run 43138273860)",
    async run() {
      const id = "n-barrier-fg-ms-wpf"
      const row = (r: Result, rid = id): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? rid : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      const free = (p: number) => timingVerdict(p, undefined, `p50=1ms p95=${p}ms n=31`)
      const poll = (p: number) => timingVerdict(p, BOUNDS.pollMs, `p50=1ms p95=${p}ms n=31`)
      const bad: string[] = []
      const one = free(14.531)
      if (one.verdict !== "NEW-EDGE" || !one.measured.startsWith("first recorded: p95 14.531;"))
        bad.push(`unbounded, one pass: ${one.verdict} ${one.measured}`)
      const agree = worstOfPasses(id, free(14.5), free(14.9))
      if (
        agree?.result.verdict !== "NEW-EDGE" ||
        agree.unstable ||
        !agree.result.measured.startsWith("first recorded: p95 14.5 / 14.9;")
      )
        bad.push(`unbounded, agreeing passes: ${JSON.stringify(agree)}`)
      const differ = worstOfPasses(id, free(14.531), free(23.079))
      if (
        differ?.result.verdict !== "NEW-EDGE" ||
        !differ.result.measured.startsWith("first recorded: p95 14.531 / 23.079; unstable on this host")
      )
        bad.push(`unbounded, differing passes: ${JSON.stringify(differ)}`)
      if (verifyLine(row(free(14.531)), free(23.079), "h").kind === "DIFF")
        bad.push("unbounded: verify DIFFs on jitter")
      const [lo, hi] = [poll(0.5), poll(16)]
      if (lo.verdict !== "CONFIRMS" || !lo.measured.includes("design/d-windows.md:130"))
        bad.push(`bounded under: ${lo.verdict} ${lo.measured}`)
      if (hi.verdict !== "CONTRADICTS" || !hi.measured.includes("design/d-windows.md:130"))
        bad.push(`bounded over: ${hi.verdict} ${hi.measured}`)
      const w = worstOfPasses("n-poll-hrtimer1-ms", lo, hi)
      if (w?.result.verdict !== "CONTRADICTS" || !w.result.measured.includes("p95 0.5 / 16"))
        bad.push(`bounded straddle: ${JSON.stringify(w)}`)
      if (verifyLine(row(lo, "n-poll-hrtimer1-ms"), hi, "h").kind === "DIFF")
        bad.push("bounded straddle: verify DIFFs on jitter")
      if (
        verifyLine(
          row({ measured: "m", verdict: "CONFIRMS" }, "n-uipi-sendinput"),
          { measured: "m", verdict: "CONTRADICTS" },
          "h",
        ).kind !== "DIFF"
      )
        bad.push("a non-timing change does not DIFF")
      // static: every bound carries a design citation, and no verdict applies a number of its own
      const uncited = Object.entries(BOUNDS)
        .filter(([, b]) => !/^design\/d-[a-z-]+\.md:\d+ \(/.test(b.cite))
        .map(([k]) => k)
      if (uncited.length) bad.push(`bounds without a design citation: ${uncited.join(",")}`)
      const self = source("probe-sp-n.ts")
      const calls = [...self.matchAll(/timingVerdict\(num\([^)]*\)[^,]*, ([^,]+), /g)].map((m) => m[1]?.trim() ?? "")
      const rogue = calls.filter((a) => a !== "undefined" && !/^BOUNDS\.\w+$/.test(a))
      if (calls.length < 5 || rogue.length)
        bad.push(`timing calls with a bound of their own: ${rogue.join(",") || `only ${calls.length} calls found`}`)
      if (/FRAME_MS|>= 0\.9\b|< 0\.01\b/.test(self.slice(0, self.indexOf("const LOGIC_CHECKS"))))
        bad.push("an uncited number still decides a verdict")
      if (!/0\.98[^\n]*d-windows\.md:80|d-windows\.md:80[^\n]*\n[^\n]*0\.98/.test(source("sp-n-native-capture.ps1")))
        bad.push("the near-black 98 % bound has no design citation")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "COUNT worst-of and property lookup (hosted run 43142136804)",
    async run() {
      const bad: string[] = []
      const id = "n-barrier-fg-proves-webview2"
      const pass = (eff: number, routed = 31) =>
        propertyVerdict(
          "barrierReceipt",
          routed === 31,
          `routed ${routed}/31 consumed 31/31 effect at barrier return ${eff}/31 within 2 s 31/31`,
        )
      if (pass(30).verdict !== "CONFIRMS" || !pass(30).measured.includes("d-windows.md:"))
        bad.push("the receipt is not judged on routed + consumed with its line")
      if (pass(31, 30).verdict !== "CONTRADICTS") bad.push("a missed routed hop does not CONTRADICT")
      if (propertyVerdict("effectAtReturn", false, "effect 30/31").verdict !== "NEW-EDGE")
        bad.push("an uncited property is not NEW-EDGE")
      const w = worstOfCountPasses(id, pass(31), pass(30))
      if (!w?.result.measured.includes("30/31 vs 31/31") || !w.differ)
        bad.push(`worst-of hides the miss: ${w?.result.measured}`)
      const row = (r: Result): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      const v1 = verifyLine(row(pass(31)), pass(30), "h")
      if (v1.kind === "DIFF" || !v1.text.includes("30/31 vs 31/31"))
        bad.push(`an effect miss DIFFs or is hidden: ${v1.text}`)
      if (verifyLine(row(pass(31, 30)), pass(31), "h").kind !== "SAME") bad.push("a re-confirm DIFFs")
      if (verifyLine(row(pass(31)), pass(31, 30), "h").kind !== "DIFF") bad.push("a receipt miss does not DIFF")
      const self = source("probe-sp-n.ts")
      const grp = self.slice(self.indexOf("const barriers: Group = {"), self.indexOf("const chords: Group = {"))
      const assigns = [
        ...grp.matchAll(/out\[`n-barrier-(?:fg|posted)-proves-\$\{key\}`\] =\s*([^\n]+)\n\s*([^\n]*)/g),
      ].map((m) => `${m[1]} ${m[2]}`)
      if (assigns.length !== 2 || assigns.some((a) => !/propertyVerdict\(|rowVerdict\(/.test(a)))
        bad.push(`count-row verdicts not from the lookup: ${JSON.stringify(assigns)}`)
      if (/pick\(landed|pick\(fgDone/.test(grp)) bad.push("a count row still decides with its own pick")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "WHEEL control-gated verify (hosted run 43144561350)",
    async run() {
      const t = (d: number, n = 6): Tally => ({ delivered: d, runs: n, acquire: "plain", notFg: 0 })
      const row = (r: Result, id: string): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      const gatedIds = CONTROL_GATES["n-wheel-control-settled"] ?? []
      const bad: string[] = []
      for (const [c1, c2] of [
        [0, 6],
        [6, 0],
        [0, 0],
        [6, 6],
      ] as const) {
        const p1 = wheelResults(t(c1), t(c1 ? 15 : 0, 18), t(c1 ? 3 : 0))
        const p2 = wheelResults(t(c2), t(c2 ? 15 : 0, 18), t(c2 ? 3 : 0))
        const ledger = Object.entries(p1).map(([id, r]) => row(r, id))
        const g = gatedVerify(ledger, p2, "h")
        const failed = c1 !== 6 || c2 !== 6
        for (const id of gatedIds) {
          const l = ledger.find((r) => r.id === id)
          const v = g.get(id) ?? (l ? verifyLine(l, p2[id], "h") : undefined)
          if (
            v?.kind !== "SAME" ||
            failed !==
              (v.text.includes(`control failed in a pass: ${c1}/6 vs ${c2}/6`) && v.text.includes("UNMEASURED"))
          )
            bad.push(`${c1}/${c2} ${id}: ${v?.text}`)
        }
        const ctl = verifyLine(
          row(p1["n-wheel-control-settled"] as Result, "n-wheel-control-settled"),
          p2["n-wheel-control-settled"],
          "h",
        )
        if (
          p1["n-wheel-control-settled"]?.verdict !== "NEW-EDGE" ||
          ctl.kind !== "SAME" ||
          (c1 !== c2 && !ctl.text.includes("0/6 vs 6/6"))
        )
          bad.push(`${c1}/${c2} control: ${p1["n-wheel-control-settled"]?.verdict} ${ctl.text}`)
      }
      // a passing control never hides a real change in a gated row
      const a = wheelResults(t(6), t(18, 18), t(6))
      const b = wheelResults(t(6), t(15, 18), t(3))
      const l = row(a["n-wheel-after-raise-dwmflush"] as Result, "n-wheel-after-raise-dwmflush")
      if ((gatedVerify([l], b, "h").get(l.id) ?? verifyLine(l, b[l.id], "h")).kind !== "DIFF")
        bad.push("a gated change under a passing control does not DIFF")
      if (!/"n-wheel-control-settled": propertyVerdict\(\s*"wheelSettled"/.test(source("probe-sp-n.ts")))
        bad.push("the control verdict is not from the citation lookup")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "COUNT worst-of on every bounded count row (hosted run 43146515418)",
    async run() {
      const t = (d: number, n = 6): Tally => ({ delivered: d, runs: n, acquire: "plain", notFg: 0 })
      const row = (r: Result, id: string): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      // every design-bounded count row, one pass inside its bound and one outside it
      const recv = (k: number) => `sent 31/31 routed ${k}/31 consumed 31/31`
      const pairs: Array<[string, Result, Result]> = [
        [
          "n-wheel-after-raise-dwmflush",
          wheelResults(t(6), t(18, 18), t(6))["n-wheel-after-raise-dwmflush"] as Result,
          wheelResults(t(6), t(9, 18), t(6))["n-wheel-after-raise-dwmflush"] as Result,
        ],
        [
          "n-wheel-after-raise-5ms",
          wheelResults(t(6), t(18, 18), t(0))["n-wheel-after-raise-5ms"] as Result,
          wheelResults(t(6), t(18, 18), t(3))["n-wheel-after-raise-5ms"] as Result,
        ],
        ...FAMILIES.flatMap(([key]): Array<[string, Result, Result]> => [
          [
            `n-barrier-fg-proves-${key}`,
            propertyVerdict("barrierReceipt", true, recv(31)),
            propertyVerdict("barrierReceipt", false, recv(30)),
          ],
          [
            `n-barrier-posted-proves-${key}`,
            propertyVerdict("postedLandsClassic", true, "posted 31/31 consumed 31/31"),
            propertyVerdict("postedLandsClassic", false, "posted 31/31 consumed 30/31"),
          ],
        ]),
      ]
      const bad: string[] = []
      for (const [id, pass, miss] of pairs) {
        if (pass.verdict !== "CONFIRMS" || miss.verdict !== "CONTRADICTS") {
          bad.push(`${id}: fixture ${pass.verdict}/${miss.verdict}`)
          continue
        }
        for (const [a, b] of [
          [miss, pass],
          [pass, miss],
        ]) {
          const w = a && b ? worstOfCountPasses(id, a, b) : undefined
          if (w?.result.verdict !== "CONTRADICTS" || !/ vs /.test(w.result.measured))
            bad.push(`${id}: worst-of ${JSON.stringify(w)}`)
        }
        const keep = verifyLine(row(miss, id), pass, "h")
        if (keep.kind !== "SAME" || !/ vs /.test(keep.text))
          bad.push(`${id}: a passing pass flips a CONTRADICTS: ${keep.text}`)
        if (verifyLine(row(pass, id), miss, "h").kind !== "DIFF") bad.push(`${id}: a failing pass is hidden`)
      }
      // static: every committed row judged on counts is aggregated worst-of, and verify reaches the plain
      // comparison only after the gate, the count and the timing paths
      const counted = readLedger(join(HERE, "win32-delivery.tsv")).filter(
        (r) =>
          /^(CONFIRMS|CONTRADICTS)$/.test(r.verdict) &&
          /\d+\/\d+/.test(r.measured) &&
          !isCountRow(r.id) &&
          !isTimingRow(r.id),
      )
      if (counted.length) bad.push(`count rows outside worst-of: ${[...new Set(counted.map((r) => r.id))].join(",")}`)
      const self = source("probe-sp-n.ts")
      const mp = self.slice(self.indexOf("export function mergePasses("), self.indexOf("export function verifyJob("))
      const mt = self.slice(self.indexOf("export function mergeTwo("), self.indexOf("export function mergePasses("))
      if (!(mp.indexOf("gatedVerify(") > 0 && mp.indexOf("mergeTwo(") > mp.indexOf("gatedVerify(")))
        bad.push("mergePasses merges before the control gate")
      if (!(
        mt.indexOf("worstOfCountPasses(") > 0 &&
        mt.indexOf("worstOfPasses(") > mt.indexOf("worstOfCountPasses(") &&
        mt.indexOf("MERGE_RANK[") > mt.indexOf("worstOfPasses(")
      ))
        bad.push("mergeTwo compares before the worst-of paths")
      if (
        (self.match(/verifyJob\(ledger, results, committed/g) ?? []).length !== 1 ||
        /\.verdict !== l\.verdict/.test(self)
      )
        bad.push("a verify path bypasses the merged worst-of job")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "JOB two-pass verify against the committed ledger (hosted run 43156630522)",
    async run() {
      const id = "n-wheel-after-raise-5ms"
      const t = (d: number, n = 6): Tally => ({ delivered: d, runs: n, acquire: "plain", notFg: 0 })
      const pass = (lost: number) => wheelResults(t(6), t(18, 18), t(6 - lost))[id] as Result
      const row = (r: Result): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      const committed = [row({ measured: "lost 3/6 vs 6/6", verdict: "CONTRADICTS" })]
      const bad: string[] = []
      const cases: Array<[string, number, number, LedgerRow[], number]> = [
        ["pass 2 worse", 6, 3, committed, 0],
        ["pass 2 better", 3, 6, committed, 0],
        ["equal", 3, 3, committed, 0],
        ["real change", 6, 6, committed, 1],
      ]
      for (const [name, l1, l2, com, want] of cases) {
        const job = verifyJob([row(pass(l1))], { [id]: pass(l2) }, com, "h", () => true)
        const m = job.merged[id]
        const worst = Math.max(l1, l2) < 6 || Math.min(l1, l2) < 6 ? "CONTRADICTS" : "CONFIRMS"
        if (job.diff !== want || m?.verdict !== worst || (l1 !== l2 && !/ vs | \|\| other pass /.test(m.measured)))
          bad.push(`${name}: diff=${job.diff} want ${want}, merged ${m?.verdict} ${m?.measured}`)
      }
      const self = source("probe-sp-n.ts")
      if (
        !/const committed = readLedger\(LEDGER\)/.test(self) ||
        !/writeFileSync\(opt\.file, `\$\{mergeLedger\(ledger, host, fresh\)/.test(self)
      )
        bad.push("verify does not judge against the committed ledger or does not write the merged ledger")
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "BARRIER skipped runs excluded from every guard (review 79871df09c)",
    async run() {
      const bad: string[] = []
      const ok: Json = { sent: 1, routed: true, consumed: true, atReturn: true, within2s: true }
      const skips: Array<[string, Json]> = [
        [
          "not foreground at send",
          { sent: 0, notForeground: true, routed: false, consumed: false, atReturn: false, within2s: false },
        ],
        ["SendInput accepted no event", { sent: 0, routed: false, consumed: false, atReturn: false, within2s: false }],
        ["SendInput accepted no event", { routed: false, consumed: false }],
      ]
      const fg = (runs: Json[]): Json => ({
        acquired: true,
        acquire: "plain",
        probeClass: "Edit",
        stats: { p50: 4, p95: 5, min: 3, max: 6, n: runs.length },
        runs,
      })
      const rows = (o: ReturnType<typeof fgBarrierObs>) =>
        [rowVerdict("n-barrier-fg-proves-wpf", o.proves), rowVerdict("n-barrier-fg-ms-wpf", o.ms)] as const
      for (const [why, sk] of skips)
        for (const k of [1, 5, RUNS]) {
          const o = fgBarrierObs(fg([...Array<Json>(k).fill(sk), ...Array<Json>(RUNS - k).fill(ok)]))
          const [p, m] = rows(o)
          const tag = `${why} x${k}`
          if (k === RUNS) {
            if (
              p.verdict !== "UNMEASURED" ||
              m.verdict !== "UNMEASURED" ||
              !p.measured.includes(`skipped ${RUNS}/${RUNS}`)
            )
              bad.push(`${tag}: ${p.verdict}/${m.verdict} ${p.measured}`)
            continue
          }
          const n = RUNS - k
          if (
            p.verdict !== "CONFIRMS" ||
            !p.measured.includes(`routed ${n}/${n} consumed ${n}/${n}`) ||
            !p.measured.includes(`skipped ${k}/${RUNS} (${why} ${k})`)
          )
            bad.push(`${tag} proves: ${p.verdict} ${p.measured}`)
          if (m.verdict !== "NEW-EDGE" || !m.measured.includes("hang-guard expiries 0;"))
            bad.push(`${tag} ms: ${m.verdict} ${m.measured}`)
          if (!o.oracleSeen) bad.push(`${tag}: the oracle counted the skipped runs`)
        }
      if (rows(fgBarrierObs({ acquired: false })).some((r) => r.verdict !== "UNMEASURED"))
        bad.push("no foreground: not UNMEASURED")
      // a real miss among the exercised runs still contradicts the design
      const miss = rows(fgBarrierObs(fg([{ ...ok, routed: false }, ...Array<Json>(RUNS - 1).fill(ok)])))
      if (
        miss[0].verdict !== "CONTRADICTS" ||
        miss[1].verdict !== "CONTRADICTS" ||
        !miss[1].measured.includes("hang-guard expiries 1;")
      )
        bad.push(`an exercised miss: ${miss.map((r) => r.verdict).join("/")}`)
      const self = source("probe-sp-n.ts")
      const grp = self.slice(self.indexOf("\nconst barriers: Group = {"), self.indexOf("\nconst chords: Group = {"))
      if (/count\(fg\.runs/.test(grp) || !/fgBarrierObs\(fg\)/.test(grp))
        bad.push("the barrier group counts runs outside fgBarrierObs")
      return bad.length ? bad.slice(0, 5).join("; ") : undefined
    },
  },
  {
    finding: "VERDICT one function, fuzzed over every record shape (review 79871df09c)",
    async run() {
      const bad: string[] = []
      const cites: Record<string, Cite> = {
        d: { design: "design/d-windows.md:130 (t)" },
        n: { noClaim: "none stated" },
      }
      const datas: Array<[string, unknown, Outcome | undefined]> = [
        ["held", { outcome: "held", text: "t", counts: { a: [3, 3] } }, "held"],
        ["broken", { outcome: "broken", text: "t", counts: { a: [2, 3] } }, "broken"],
        ["edge", { outcome: "edge", text: "t" }, "edge"],
        ["inconclusive", { outcome: "inconclusive", text: "p95 near" }, "inconclusive"],
        ["missing", undefined, undefined],
        ["null", null, undefined],
        ["wrong type", "held", undefined],
        ["outcome NaN", { outcome: Number.NaN, text: "t" }, undefined],
        ["outcome negative", { outcome: -1, text: "t" }, undefined],
        ["outcome wrong type", { outcome: true, text: "t" }, undefined],
        ["outcome missing", { text: "t" }, undefined],
        ["text missing", { outcome: "held" }, undefined],
        ["text wrong type", { outcome: "held", text: 5 }, undefined],
        ["count NaN", { outcome: "held", text: "t", counts: { a: [Number.NaN, 3] } }, undefined],
        ["count negative", { outcome: "held", text: "t", counts: { a: [-1, 3] } }, undefined],
        ["count over", { outcome: "held", text: "t", counts: { a: [4, 3] } }, undefined],
        ["count no denominator", { outcome: "held", text: "t", counts: { a: [0, 0] } }, undefined],
        ["count wrong type", { outcome: "held", text: "t", counts: { a: "3/3" } }, undefined],
        ["counts wrong type", { outcome: "held", text: "t", counts: 5 }, undefined],
      ]
      for (const kind of ["MEASURED", "SKIPPED", "ERRORED", "BOGUS", undefined])
        for (const [dn, data, outcome] of datas)
          for (const c of ["d", "n", "absent"] as const)
            for (const reason of ["why", undefined, 7]) {
              const obs = { kind, data, reason } as unknown as Obs
              const tag = `${String(kind)}/${dn}/${c}/${String(reason)}`
              let r: Result | Error
              try {
                r = rowVerdict("row", obs, c === "absent" ? {} : { row: cites[c] as Cite })
              } catch (e) {
                r = e as Error
              }
              if (c === "absent") {
                if (!(r instanceof Error)) bad.push(`${tag}: an uncited row was decided`)
                continue
              }
              if (r instanceof Error) {
                bad.push(`${tag}: threw ${r.message}`)
                continue
              }
              const want: Verdict =
                kind !== "MEASURED" || !outcome || outcome === "inconclusive"
                  ? "UNMEASURED"
                  : outcome === "edge" || c === "n"
                    ? "NEW-EDGE"
                    : outcome === "held"
                      ? "CONFIRMS"
                      : "CONTRADICTS"
              if (r.verdict !== want) bad.push(`${tag}: ${r.verdict}, want ${want}`)
              if (
                (r.verdict === "CONFIRMS" || r.verdict === "CONTRADICTS") &&
                !r.measured.includes("design/d-windows.md:130")
              )
                bad.push(`${tag}: a verdict without its citation`)
              if ((kind === "SKIPPED" || kind === "ERRORED") && reason === "why" && !r.measured.includes("why"))
                bad.push(`${tag}: reason dropped`)
            }
      let refused = false
      try {
        buildCites(["n-no-such-row"])
      } catch {
        refused = true
      }
      if (!refused) bad.push("the row table accepted a row with no citation")
      const self = source("probe-sp-n.ts")
      const at0 = self.indexOf("export async function runGroup(")
      if (!/finalRow\(id, x, cites\)/.test(self.slice(at0, self.indexOf("\n}\n", at0))))
        bad.push("runGroup does not pass every row through finalRow")
      if (!/ledgerLine\(id, finalRow\(id, results\[id\] \?\? missing\)/.test(self))
        bad.push("the measure writer bypasses finalRow")
      return bad.length ? `${bad.length} cases: ${bad.slice(0, 5).join("; ")}` : undefined
    },
  },
  {
    finding: "MERGE explicit order, both passes kept (review 79871df09c)",
    async run() {
      const bad: string[] = []
      const ORDER: readonly Verdict[] = ["CONFIRMS", "NEW-EDGE", "UNMEASURED", "CONTRADICTS"]
      const vs = ORDER
      const text = (id: string, v: Verdict, tag: string) =>
        v === "UNMEASURED"
          ? `UNMEASURED: errored: leg failed ${tag}`
          : id.endsWith("-ms")
            ? `p50=1ms p95=${tag === "pass-one" ? 1.5 : 1.6}ms n=31 ${tag}`
            : `routed 31/31 consumed ${tag === "pass-one" ? 31 : 30}/31 ${tag}`
      for (const id of ["n-uipi-sendinput", "n-barrier-fg-proves-wpf", "n-poll-sleep1-ms"])
        for (const v1 of vs)
          for (const v2 of vs) {
            const a: Result = { measured: text(id, v1, "pass-one"), verdict: v1 }
            const b: Result = { measured: text(id, v2, "pass-two"), verdict: v2 }
            const m = mergeTwo(id, a, b)
            // the order pinned as a literal, independent of MERGE_RANK
            const want = ORDER.indexOf(v1) >= ORDER.indexOf(v2) ? v1 : v2
            if (m.verdict !== want) bad.push(`${id} ${v1}+${v2}: ${m.verdict}, want ${want}`)
            if (v1 !== v2 && !(m.measured.includes("pass-one") && m.measured.includes("pass-two")))
              bad.push(`${id} ${v1}+${v2} hides a pass: ${m.measured}`)
            const row = Object.fromEntries(
              HEADER.map((h) => [
                h,
                h === "id" ? id : h === "host" ? "h" : h === "verdict" ? v1 : h === "measured" ? a.measured : "x",
              ]),
            ) as LedgerRow
            const job = verifyJob([row], { [id]: b }, [row], "h", () => true)
            if ((job.diff === 1) !== (want !== v1)) bad.push(`${id} ${v1}+${v2}: job diff ${job.diff}`)
          }
      return bad.length ? `${bad.length} cases: ${bad.slice(0, 5).join("; ")}` : undefined
    },
  },
  {
    finding: "LEDGER round-trip through its rerun (review 79871df09c)",
    async run() {
      const bad: string[] = []
      const committed = readLedger(join(HERE, "win32-delivery.tsv"))
      for (const host of [...new Set(committed.map((r) => r.host))]) {
        const mine = committed.filter((r) => r.host === host)
        // a re-measure reading exactly what the ledger holds, through the same verdict function
        const again = Object.fromEntries(
          mine.map((r) => [r.id, finalRow(r.id, { measured: r.measured, verdict: r.verdict as Verdict })]),
        )
        for (const r of mine)
          if (again[r.id]?.measured !== r.measured || again[r.id]?.verdict !== r.verdict)
            bad.push(
              `${r.id}@${host} not in writer format: ${again[r.id]?.verdict} ${again[r.id]?.measured.slice(0, 80)}`,
            )
        const job = verifyJob(committed, again, committed, host, () => true)
        const off = job.lines.filter((l) => !l.startsWith("SAME "))
        if (job.diff || off.length) bad.push(`${host}: ${off.slice(0, 3).join(" | ")}`)
      }
      for (const [d, n] of [
        [0, 6],
        [6, 6],
        [3, 18],
      ] as const) {
        const p = parseControl(controlText(d, n))
        if (p?.[0]?.[0] !== d || p[0][1] !== n) bad.push(`controlText ${d}/${n} does not parse back`)
      }
      if (JSON.stringify(parseControl("control delivered 0/6 vs 6/6 foreground by plain")) !== "[[0,6],[6,6]]")
        bad.push("the two-pass control text does not parse")
      const uncited = committed.filter((r) => {
        if (!/^(CONFIRMS|CONTRADICTS)$/.test(r.verdict)) return false
        const c = ROW_CITES[r.id]
        return !c || !("design" in c) || !r.measured.includes(c.design.split(" ")[0] ?? c.design)
      })
      if (uncited.length)
        bad.push(`verdicts without their citation: ${uncited.map((r) => `${r.id}@${r.host}`).join(",")}`)
      return bad.length ? bad.slice(0, 6).join("; ") : undefined
    },
  },
  {
    finding: "CLEANUP every early exit removes the run's directories (review 79871df09c)",
    async run() {
      const bad: string[] = []
      const scratch = join(tmpdir(), `spn-exit-${process.pid}-${randomBytes(4).toString("hex")}`)
      mkdirSync(scratch, { recursive: true })
      try {
        const facts: Json = { elevated: true, github: true, build: "b", displayVersion: "v", arch: "a" }
        const okLeg = async (_c: Ctx, n: string): Promise<Json> => (n === "precondition" ? { ok: true } : facts)
        const other = join(scratch, "other.tsv")
        writeFileSync(
          other,
          `${HEADER.join("\t")}\n${ledgerLine("n-poll-sleep1-ms", { measured: "m", verdict: "CONFIRMS" }, "other", "b", "-")}\n`,
        )
        const stages: Array<[string, Partial<Io>, Partial<ReturnType<typeof args>>, number]> = [
          ["not Windows", { platform: "linux" }, {}, 2],
          ["shared dir refused", { lockDown: async () => "ACL denied" }, {}, 2],
          [
            "precondition rejects",
            { leg: async (_c, n) => (n === "precondition" ? Promise.reject(new Error("no desktop")) : facts) },
            {},
            2,
          ],
          [
            "precondition not ok",
            { leg: async (_c, n) => (n === "precondition" ? { ok: false, reason: "locked" } : facts) },
            {},
            2,
          ],
          [
            "facts rejects (uncaught)",
            { leg: async (_c, n) => (n === "facts" ? Promise.reject(new Error("helper died")) : { ok: true }) },
            {},
            2,
          ],
          [
            "not elevated",
            { leg: async (_c, n) => (n === "precondition" ? { ok: true } : { ...facts, elevated: false }) },
            {},
            2,
          ],
          ["verify with no ledger rows", {}, { mode: "verify", file: join(scratch, "none.tsv") }, 2],
          ["no row for the host", {}, { mode: "verify", file: other }, 2],
          ["after a full prepare", {}, {}, 0],
        ]
        for (const [i, [name, over, o, want]] of stages.entries()) {
          const [pd, tb] = [join(scratch, `pd-${i}`), join(scratch, `tb-${i}`)]
          mkdirSync(pd)
          mkdirSync(tb)
          const dirs = new Set<string>()
          const io: Io = {
            platform: "win32",
            programData: pd,
            tmpBase: tb,
            dirs,
            lockDown: async () => undefined,
            leg: okLeg,
            ...over,
          }
          const opt = {
            mode: "measure",
            file: join(scratch, "m.tsv"),
            host: undefined,
            rows: [],
            allowIrreversible: false,
            ...o,
          } as ReturnType<typeof args>
          const code = await runThroughCleanup(
            async () => {
              await prepare(opt, io)
              return 0
            },
            dirs,
            () => {},
          )
          const left = [...readdirSync(pd), ...readdirSync(tb)]
          if (code !== want || left.length)
            bad.push(`${name}: exit ${code} (want ${want}), left ${left.join(",") || "nothing"}`)
        }
        const d = join(scratch, "fatal")
        mkdirSync(d)
        let code = -1
        onFatal(
          new Error("unhandled rejection"),
          new Set([d]),
          () => {},
          (c) => {
            code = c
          },
        )
        if (code !== 2 || existsSync(d)) bad.push(`onFatal: exit ${code}, dir left ${existsSync(d)}`)
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
      // the only process exits: the top-level wrapper and onFatal's default
      const self = source("probe-sp-n.ts")
      const exits = self.match(/process\.exit\(/g)?.length ?? 0
      if (exits !== 2 || !/process\.exit\(await runThroughCleanup\(main\)\)/.test(self))
        bad.push(`${exits} process.exit calls, not 2 through the wrapper`)
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "NITS c9341c4b97: merged rows, exercised minimum, labels",
    async run() {
      const bad: string[] = []
      // merged rows are fixed points of the verdict function, and a committed merged artifact round-trips
      const t = (d: number, n = 6): Tally => ({ delivered: d, runs: n, acquire: "plain", notFg: 0 })
      const row = (id: string, r: Result): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? r.verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      for (const [c1, c2] of [
        [3, 6],
        [6, 3],
        [0, 0],
        [6, 6],
      ] as const)
        for (const [l1, l2] of [
          [3, 6],
          [6, 6],
        ] as const) {
          const p1 = Object.fromEntries(
            Object.entries(wheelResults(t(c1), t(15, 18), t(6 - l1))).map(([id, r]) => [id, finalRow(id, r)]),
          )
          const p2 = Object.fromEntries(
            Object.entries(wheelResults(t(c2), t(9, 18), t(6 - l2))).map(([id, r]) => [id, finalRow(id, r)]),
          )
          const merged = mergePasses(
            Object.entries(p1).map(([id, r]) => row(id, r)),
            p2,
            "h",
          )
          for (const [id, m] of Object.entries(merged)) {
            const f = finalRow(id, m)
            if (f.measured !== m.measured || f.verdict !== m.verdict)
              bad.push(`control ${c1}/${c2} ${id}: merged row is not a fixed point: ${m.measured.slice(0, 70)}`)
          }
          const committed = Object.entries(merged).map(([id, r]) => row(id, r))
          const again = verifyJob(committed, merged, committed, "h", () => true)
          if (again.diff || again.lines.some((l) => !l.startsWith("SAME ")))
            bad.push(`control ${c1}/${c2}: a committed merged artifact does not round-trip`)
        }
      // a verdict needs more than half of the runs exercised
      const ok: Json = { sent: 1, routed: true, consumed: true, atReturn: true, within2s: true }
      const skip: Json = { sent: 0, notForeground: true }
      for (let k = 0; k <= RUNS; k++) {
        const o = fgBarrierObs({
          acquired: true,
          acquire: "plain",
          probeClass: "Edit",
          stats: { p50: 4, p95: 5, min: 3, max: 6, n: RUNS - k },
          runs: [...Array<Json>(k).fill(skip), ...Array<Json>(RUNS - k).fill(ok)],
        })
        const p = rowVerdict("n-barrier-fg-proves-wpf", o.proves)
        const want = RUNS - k >= MIN_EXERCISED ? "CONFIRMS" : "UNMEASURED"
        if (p.verdict !== want) bad.push(`${RUNS - k}/${RUNS} exercised: ${p.verdict}, want ${want}`)
      }
      // labels: SKIPPED unless the probe says "errored: "; the UIPI not-foreground text is a skip
      if (toObs(UN("returned 0/1 lastError=0 not foreground at send")).kind !== "SKIPPED")
        bad.push("a skip mentioning lastError is labelled ERRORED")
      if (toObs(UN("errored: leg failed: x")).kind !== "ERRORED") bad.push("an explicit error is not ERRORED")
      const self = source("probe-sp-n.ts")
      const to = self.slice(self.indexOf("export function toObs("), self.indexOf("export const finalRow"))
      if (/\/i\.test\(reason\)|error\|timeout/.test(to))
        bad.push("toObs still guesses the kind from the reason's words")
      const cite = (id: string) => JSON.stringify(ROW_CITES[id])
      if (
        !/PermissionDenied/.test(cite("n-elevated-uia-read")) ||
        /UIPI drops input/.test(cite("n-elevated-printwindow"))
      )
        bad.push("the elevated rows cite input dropping")
      for (const id of [
        "n-capture-wgc-monitor-display-off",
        "n-capture-printwindow-disconnected",
        "n-capture-wgc-window-locked",
      ])
        if (!/d-windows\.md:245/.test(cite(id))) bad.push(`${id} does not cite the session-state line`)
      return bad.length ? bad.slice(0, 6).join("; ") : undefined
    },
  },
  {
    finding: "JOB control-failed gated rows read SAME (the wheel-control ruling, restored)",
    async run() {
      const bad: string[] = []
      const t = (d: number, n = 6): Tally => ({ delivered: d, runs: n, acquire: "plain", notFg: 0 })
      const pass = (control: number) =>
        Object.fromEntries(
          Object.entries(wheelResults(t(control), t(9, 18), t(3))).map(([id, r]) => [id, finalRow(id, r)]),
        )
      const row = (id: string, r: Result, verdict = r.verdict): LedgerRow =>
        Object.fromEntries(
          HEADER.map((h) => [
            h,
            h === "id" ? id : h === "host" ? "h" : h === "verdict" ? verdict : h === "measured" ? r.measured : "x",
          ]),
        ) as LedgerRow
      const gated = CONTROL_GATES["n-wheel-control-settled"] ?? []
      for (const [c1, c2] of [
        [0, 6],
        [6, 0],
        [0, 0],
        [6, 6],
      ] as const)
        for (const committedVerdict of ["CONFIRMS", "CONTRADICTS"] as const) {
          const p1 = pass(c1)
          const p2 = pass(c2)
          const pass1 = Object.entries(p1).map(([id, r]) => row(id, r))
          const committed = Object.entries(p1).map(([id, r]) =>
            row(id, r, gated.includes(id) ? committedVerdict : r.verdict),
          )
          const job = verifyJob(pass1, p2, committed, "h", (id) => gated.includes(id))
          const failed = c1 !== 6 || c2 !== 6
          // control fine in both passes: both gated rows read CONTRADICTS (9/18 delivered, 3/6 lost)
          const want = failed ? 0 : committedVerdict === "CONTRADICTS" ? 0 : gated.length
          const shows = job.lines.every((l) => !failed || l.includes(`control failed in a pass: ${c1}/6 vs ${c2}/6`))
          if (job.diff !== want || !shows)
            bad.push(
              `control ${c1}/${c2} committed ${committedVerdict}: diff ${job.diff}, want ${want}: ${job.lines[0]?.slice(0, 120)}`,
            )
        }
      // any other UNMEASURED-vs-committed change still DIFFs: a gated row that failed itself, and an ungated row
      // committed CONFIRMS (both wheel rows held), this pass's own leg failed: UNMEASURED outranks CONFIRMS
      const ok = Object.fromEntries(
        Object.entries(wheelResults(t(6), t(18, 18), t(0))).map(([id, r]) => [id, finalRow(id, r)]),
      )
      const own: Record<string, Result> = { ...ok, "n-wheel-after-raise-5ms": UN("errored: leg failed: x") }
      const c = Object.entries(ok).map(([id, r]) => row(id, r))
      if (verifyJob(c, own, c, "h", (id) => id === "n-wheel-after-raise-5ms").diff !== 1)
        bad.push("a gated row's own failure is hidden")
      const u = row("n-uipi-sendinput", { measured: "m; per design/d-windows.md:151 (x)", verdict: "CONFIRMS" })
      if (verifyJob([u], { "n-uipi-sendinput": UN("errored: leg failed: y") }, [u], "h", () => true).diff !== 1)
        bad.push("an ungated UNMEASURED change is hidden")
      return bad.length ? bad.slice(0, 5).join("; ") : undefined
    },
  },
  {
    finding: "LOW timing-flap",
    async run() {
      const cases: Array<[number, Bound | undefined, Verdict]> = [
        [0.5, BOUNDS.pollMs, "CONFIRMS"],
        [1.05, BOUNDS.pollMs, "UNMEASURED"],
        [16, BOUNDS.pollMs, "CONTRADICTS"],
        [Number.NaN, BOUNDS.pollMs, "UNMEASURED"],
        [16.2, undefined, "NEW-EDGE"],
      ]
      const bad = cases.filter(([p, b, v]) => timingVerdict(p, b, "m").verdict !== v)
      return bad.length ? `timing verdicts wrong for ${JSON.stringify(bad)}` : undefined
    },
  },
]

const INVALID_NOTE = "probe defect (return-in-loop); INVALID until a hosted run with the positive control succeeds"
const DISPLAY_OFF_NOTE = "design-adopted (re-pin item 12): capture proceeds; report session.displayAsleep:true"
const SUSPECT_IDS = [
  "n-barrier-fg-proves-wpf",
  "n-barrier-fg-ms-wpf",
  "n-barrier-posted-proves-wpf",
  "n-barrier-posted-ms-wpf",
  "n-fg-chord-ctrl-a-classic-edit-control",
]
const LEDGER_CHECKS: readonly Check[] = [
  {
    finding: "HIGH wheel-rows-invalid",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      const bad: string[] = []
      for (const id of ["n-wheel-after-raise-dwmflush", "n-wheel-after-raise-5ms"]) {
        const r = rows.find((x) => x.id === id && x.host === HOSTED)
        if (!r) bad.push(`${id}: no ${HOSTED} row`)
        else if (r.verdict === "INVALID") {
          if (r.notes !== INVALID_NOTE) bad.push(`${id}: INVALID without the defect note`)
        } else if (
          r.verdict === "UNMEASURED" &&
          /^UNMEASURED: control failed in a pass: \d+\/\d+ vs \d+\/\d+/.test(r.measured)
        ) {
          // combined with a control that failed in a pass: recorded, not judged
        } else {
          // a measured wheel verdict stands only on a control that delivered every wheel
          const m = /control delivered (\d+)\/(\d+)/.exec(r.measured)
          if (!m || m[1] !== m[2] || m[1] === "0")
            bad.push(`${id}: ${r.verdict} without a full positive control (${r.measured.slice(0, 60)})`)
          if (r.notes.startsWith("probe defect")) bad.push(`${id}: re-measured but still carries the defect note`)
        }
      }
      return bad.length ? bad.join("; ") : undefined
    },
  },
  {
    finding: "SUSPECT rows",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      // run 43136347200 re-measured these rows with the fixed read path: the SUSPECT note is gone, the reading is real
      const bad = SUSPECT_IDS.filter((id) => {
        const r = rows.find((x) => x.id === id && x.host === HOSTED)
        return !r || r.notes.startsWith("SUSPECT") || /leg failed/.test(r.measured)
      })
      if (bad.length) return `still SUSPECT or not re-measured: ${bad.join(",")}`
      return carriedNote("SUSPECT: x") === "-" ? undefined : "a SUSPECT note survives the re-measure that replaces it"
    },
  },
  {
    finding: "LEDGER locked-rows",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv")).filter((r) => r.id.endsWith("-locked"))
      const bad = rows.filter((r) =>
        r.verdict === "INVALID"
          ? !r.notes.startsWith("lock state unproven")
          : /CONFIRMS|CONTRADICTS|NEW-EDGE/.test(r.verdict) && !/lock=unlock->lock->lock/.test(r.measured),
      )
      return bad.length
        ? `locked rows without a positive lock read or an INVALID note: ${bad.map((r) => `${r.id}@${r.host}`).join(",")}`
        : undefined
    },
  },
  {
    finding: "LEDGER design-bounds",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv")).filter((r) => r.host === HOSTED && isTimingRow(r.id))
      const bad = rows.filter(
        (r) =>
          (r.verdict === "CONTRADICTS" || r.verdict === "CONFIRMS") && !/design\/d-windows\.md:\d+/.test(r.measured),
      )
      const free = rows.filter(
        (r) => !r.id.startsWith("n-poll-") && /p95=/.test(r.measured) && !/hang guard \(/.test(r.measured),
      )
      const notEdge = free.filter((r) => r.verdict !== "NEW-EDGE" || !r.measured.startsWith("first recorded: p95"))
      if (notEdge.length)
        return `unbounded timing rows not NEW-EDGE "first recorded": ${notEdge.map((r) => r.id).join(",")}`
      return bad.length ? `timing verdicts without a design bound: ${bad.map((r) => r.id).join(",")}` : undefined
    },
  },
  {
    finding: "LEDGER display-off",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv")).filter(
        (r) => r.id.endsWith("-display-off") && r.host === HOSTED,
      )
      const bad = rows.filter(
        (r) =>
          (r.verdict === "CONTRADICTS" && /class=frame/.test(r.measured)) ||
          (r.verdict === "NEW-EDGE" && r.notes !== DISPLAY_OFF_NOTE),
      )
      return bad.length
        ? `display-off rows not classified as the design adopted: ${bad.map((r) => r.id).join(",")}`
        : undefined
    },
  },
  {
    finding: "LOW hosted-rows-committed",
    async run() {
      const rows = readLedger(join(HERE, "win32-delivery.tsv"))
      const missing = Object.keys(SPEC).filter(
        (id) => !SPEC[id]?.h6Only && !SPEC[id]?.multiMonitor && !rows.some((r) => r.id === id && r.host === HOSTED),
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

async function selfTest(): Promise<number> {
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
  return failures.length ? 1 : 0
}

// Everything before the groups run: each early exit (fail or a raw rejection) leaves through runThroughCleanup.
export type Io = {
  readonly platform: string
  readonly programData: string
  readonly tmpBase: string
  readonly dirs: Set<string>
  readonly lockDown: (ctx: Ctx, p: string) => Promise<string | undefined>
  readonly leg: (ctx: Ctx, name: string) => Promise<Json>
}
export async function prepare(opt: ReturnType<typeof args>, io: Io) {
  if (io.platform !== "win32")
    fail(
      `PRECONDITION windows-interactive-desktop: SP-N measures a Windows interactive desktop; this host is ${io.platform}`,
    )
  const ctx: Ctx = {
    tmp: join(io.tmpBase, `omo-sp-n-${process.pid}`),
    // a fresh, unpredictable name: freshDir refuses one that already exists
    shared: join(io.programData, `omo-sp-n-${process.pid}-${randomBytes(6).toString("hex")}`),
    facts: {},
    targets: new Map(),
    spawned: [],
    notes: new Map(),
    live: new Set(),
    token: { aborted: false },
    cleanups: [],
    pending: new Map(),
    allowIrreversible: opt.allowIrreversible,
    session: {},
  }
  // registered for removal on every exit; only directories this run creates (freshDir refuses an existing one)
  if (!existsSync(ctx.tmp)) io.dirs.add(ctx.tmp)
  mkdirSync(ctx.tmp, { recursive: true })
  if (!existsSync(ctx.shared)) io.dirs.add(ctx.shared)
  await freshDir(ctx.shared, (p) => io.lockDown(ctx, p)).catch((e: Error) =>
    fail(`PRECONDITION shared-dir: ${e.message}`),
  )
  const pre = await io
    .leg(ctx, "precondition")
    .catch((e: Error) => fail(`PRECONDITION windows-interactive-desktop: ${e.message}`))
  if (pre.ok !== true) fail(`PRECONDITION windows-interactive-desktop: ${str(pre.reason)}`)
  ctx.facts = await io.leg(ctx, "facts")
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
  const want = new Set(opt.rows.length ? opt.rows : opt.mode === "verify" ? fromLedger : rowsForHost(host, ctx.facts))
  if (want.size === 0) fail(`LEDGER ${opt.file}: no row for host "${host}"`)
  return { ctx, host, build, ledger, want }
}

async function main(): Promise<number> {
  if (process.argv[2] === "--self-test") return await selfTest()
  const opt = args()
  const broken = await logicChecks()
  if (broken.length) fail(`PRECONDITION self-test: ${broken.join("; ")}`)
  const { ctx, host, build, ledger, want } = await prepare(opt, {
    platform: process.platform,
    programData: process.env.ProgramData ?? "C:\\ProgramData",
    tmpBase: tmpdir(),
    dirs: EXIT_DIRS,
    lockDown: lockDownWindows,
    leg: (c, n) => leg(c, n),
  })
  const groups = GROUPS.filter((g) => g.ids.some((id) => want.has(id)))
  const results: Record<string, Result> = {}
  const ids = Object.keys(SPEC).filter((id) => want.has(id))
  const noteOf = (notes: ReadonlyMap<string, string>, id: string) =>
    nativeNote(carriedNote(notes.get(id)), elevated.ids.includes(id) ? ctx.facts.native : undefined)
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
          ids.map((id) => [id, ledgerLine(id, finalRow(id, results[id] ?? missing), host, build, noteOf(notes, id))]),
        )
        writeFileSync(opt.file, `${mergeLedger(before, host, fresh).join("\n")}\n`)
        for (const id of ids)
          console.log(
            `${(results[id] ?? missing).verdict.padEnd(11)} ${id}  ${clean((results[id] ?? missing).measured)}`,
          )
        console.log(`SP-N measured ${ids.length} rows on ${host} (${build}) -> ${relative(process.cwd(), opt.file)}`)
        return 0
      }
      // pass 1 (opt.file) merged worst-of with this pass, judged against the committed ledger; the merged ledger
      // replaces pass 1 in opt.file (the uploaded artifact), never the committed file itself
      const committed = readLedger(LEDGER)
      const job = verifyJob(ledger, results, committed, host, (id) => want.has(id))
      for (const line of job.lines) console.log(line)
      if (resolve(opt.file) !== resolve(LEDGER)) {
        const notes = new Map(ledger.filter((r) => r.host === host).map((r) => [r.id, r.notes]))
        const fresh = new Map(
          Object.entries(job.merged).map(([id, m]) => [id, ledgerLine(id, m, host, build, noteOf(notes, id))]),
        )
        writeFileSync(opt.file, `${mergeLedger(ledger, host, fresh).join("\n")}\n`)
        console.log(`SP-N merged worst-of-both-passes ledger -> ${relative(process.cwd(), opt.file)}`)
      }
      const diff = job.diff
      console.log(
        `SP-N verify on ${host} (${build}): ${Object.keys(results).length} measured, merged worst-of with pass 1, ${diff} differing from the committed ledger`,
      )
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
  return end.exitCode
}

if (import.meta.main) {
  process.on("unhandledRejection", (e) => onFatal(e))
  process.on("uncaughtException", (e) => onFatal(e))
  // Explicit exit: a child the probe could not end must not keep the run alive (the hosted job hung here once).
  process.exit(await runThroughCleanup(main))
}
