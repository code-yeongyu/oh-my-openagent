#!/usr/bin/env bun
// Spike SP-T: which process tccd charges for the computer-use launcher on macOS, which client_type the grant
// records, whether the grant survives a generation swap and a rebuild, which launchd session the launcher lands
// in, and which key route a session tap sees as untagged hardware input.
//
// A spike instrument, not engine code. It writes the ledger `macos-tcc.tsv` beside it (one row per question per
// condition) and re-measures it with --verify. See README.md in this directory for the host procedure.
//
//   --print-skeleton             print every ledger row unmeasured, each with its awaiting reason (no host needed)
//   --setup                      build the spawner, the probe bundle generations and the prompt-probe bundle
//   --request-grant              launch the current generation by path with the prompt flag (the H3 dialog)
//   --check-grant                launch the current generation by path and print its three preflights
//   --row <id>                   measure one row and print its ledger line (writes the row's evidence file)
//   --measure --out <ledger>     measure every row of this host and merge the result into <ledger>
//   --verify <ledger>            measure every row of this host again; exit 0 only if every verdict is identical
//   --cleanup                    remove probe-only state (work tree, LaunchServices entries, prompt-probe rows)
//   --leg <spec.json>            internal: one launch, run inside the GUI session or an ssh child
//   --self-test                  the pure classification logic and the row table against fixed inputs (any host)
//
// No agent clicks a TCC grant or answers a permission prompt. Rows that need the H3 grant or a Deny answer read
// WAITING-PERSON and launch nothing unless SPT_PERSON_PRESENT=1 (a person at the QA session for that slot), and
// --request-grant refuses without it.
//
// Sections, in file order: types and constants | process helpers | preconditions | work tree | legs |
// classification | measurements | the row table | ledger | cleanup | self-test | main
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

// ---------------------------------------------------------------------------------------------- types and constants

const PROBE_DIR = import.meta.dir
const BUNDLE_ID = "ai.sisyphuslabs.omo-computer-helper"
const PROMPT_BUNDLE_ID = `${BUNDLE_ID}.sp-t-prompt`
const APP_NAME = "omo-computer-helper.app"
const BUNDLE_NAME = "omo-computer-helper"
const DISPLAY_NAME = "OmO Computer Use"
const EXE_REL = "Contents/MacOS/omo-computer-engine"
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
const HEADER = ["id", "question", "condition", "host", "verdict", "rerun", "host_build", "measured", "evidence", "note"]
const LEG_TIMEOUT_MS = 20_000

type Os = 15 | 26
type HostRole = "h1" | "h2" | "h4"
type LaunchAction = "open-path" | "open-name" | "disclaim" | "plain"
type Context = "gui" | "ssh"
type PersonNeed = "grant" | "deny" | "tap"

const PERSON_REASON: Record<PersonNeed, string> = {
  grant:
    "waiting for a person: needs the H3 grant (Accessibility, Screen Recording, Input Monitoring to the helper bundle) given by a person at the QA session; no agent clicks a TCC grant",
  deny: "waiting for a person: raises a TCC dialog that a person at the QA session answers Deny; no agent answers a permission prompt",
  tap: "waiting for a person: the session tap needs the H3 Input Monitoring grant to the helper bundle (CGEventTapCreate raises the Input Monitoring prompt without it) and a person pressing the key through the route; no agent clicks a TCC grant",
}

function personPresent(): boolean {
  return process.env.SPT_PERSON_PRESENT === "1"
}

interface Measured {
  verdict: string
  measured: Record<string, string | number | boolean>
  note: string
}

interface RowDef {
  id: string
  question: string
  condition: string
  host: HostRole
  os: Os
  needs?: "h2" | "h4"
  person?: PersonNeed
  route?: "hypervisor-vkbd" | "vhid"
  measure: (env: HostEnv, log: EvidenceLog) => Promise<Measured>
}

interface HostEnv {
  major: number
  build: string
  qaUser: string
  qaUid: number
  qaHome: string
  sameUser: boolean
  work: string
  ev: string
  commit: string
  bun: string
  ownManager: string
}

interface LegSpec {
  action: LaunchAction
  target: string
  prompt: "" | "ax" | "all"
  tag: string
  result: string
  done: string
  spawner: string
  timeoutMs: number
  // set for the untagged-route legs: the launcher runs `tap <seconds> <result>` instead of `report`
  tapSeconds?: number
}

interface ProbeReport {
  marker: string
  pid: number
  ppid: number
  exe: string
  responsibleSymbol: boolean
  responsiblePid: number
  responsibleExe: string
  managerName: string
  securitySession: { status: number; hasGraphicAccess: boolean; isRemote: boolean }
  preflight: { accessibility: number; screenRecording: number; inputMonitoring: number }
  ancestry: Array<{ pid: number; exe: string }>
}

interface LegResult {
  hostPid: number
  hostExe: string
  hostManager: string
  launch: { argv: string[]; code: number; stdout: string; stderr: string }
  report: ProbeReport | null
  waitedMs: number
  startedAt: number
  tapFile?: string
}

class EvidenceLog {
  readonly lines: string[] = []
  add(title: string, body: unknown): void {
    this.lines.push(`## ${title}`, typeof body === "string" ? body : JSON.stringify(body, null, 2))
  }
}

class Precondition extends Error {}

const HOSTS: Record<HostRole, string> = {
  h1: "H1/H3 QA account GUI session",
  h2: "H2 virtual machine",
  h4: "H4 virtual HID keyboard on the QA Mac",
}

// ---------------------------------------------------------------------------------------------- process helpers

async function run(argv: string[], options: { env?: Record<string, string>; stdin?: string } = {}) {
  const proc = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    env: { ...process.env, ...options.env },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

function asQa(env: HostEnv, argv: string[], extraEnv: Record<string, string> = {}): string[] {
  const vars = Object.entries({
    CU_RUN: process.env.CU_RUN ?? "",
    EV: env.ev,
    SPT_COMMIT: env.commit,
    ...extraEnv,
  }).map(([k, v]) => `${k}=${v}`)
  if (env.sameUser) return ["env", ...vars, ...argv]
  return ["sudo", "-n", "-H", "-u", env.qaUser, "env", `HOME=${env.qaHome}`, ...vars, ...argv]
}

// The results directory belongs to the QA account (0700): the spec files in it decide what a QA-account leg runs, so
// no other account may write there. When the probe runs as another account every read and write goes through it.
async function qaWrite(env: HostEnv, path: string, text: string): Promise<void> {
  if (env.sameUser) {
    writeFileSync(path, text, { mode: 0o600 })
    return
  }
  const out = await run(asQa(env, ["/bin/sh", "-c", 'umask 077; cat > "$1"', "sh", path]), { stdin: text })
  if (out.code !== 0) throw new Error(`write as the QA account failed for ${basename(path)}: ${out.stderr}`)
}

async function qaRead(env: HostEnv, path: string): Promise<string | null> {
  if (env.sameUser) return existsSync(path) ? readFileSync(path, "utf8") : null
  const out = await run(asQa(env, ["cat", path]))
  return out.code === 0 ? out.stdout : null
}

async function ensureResultsDir(env: HostEnv, dir: string): Promise<void> {
  if (!existsSync(dir) && !isSymlink(dir)) {
    const made = env.sameUser
      ? (mkdirSync(dir, { mode: 0o700 }), { code: 0, stderr: "" })
      : await run(["sudo", "-n", "install", "-d", "-o", env.qaUser, "-m", "0700", dir])
    if (made.code !== 0) throw new Precondition(`the results directory created by the QA account (${made.stderr})`)
  }
  const problem = resultsDirProblem(lstatSync(dir), env.qaUid)
  if (problem) throw new Precondition(`a results directory owned by the QA account with mode 0700 (${problem})`)
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

// pure: what is wrong with the results directory's lstat, or "" when it is a real 0700 directory of the QA account
function resultsDirProblem(
  st: { isSymbolicLink(): boolean; isDirectory(): boolean; uid: number; mode: number },
  qaUid: number,
): string {
  if (st.isSymbolicLink()) return "it is a symlink; refused"
  if (!st.isDirectory()) return "it is not a directory"
  if (st.uid !== qaUid) return `owner uid ${st.uid}, not the QA account`
  if ((st.mode & 0o7777) !== 0o700) return `mode ${(st.mode & 0o7777).toString(8)}, not 700`
  return ""
}

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms)
}

function compact(record: Record<string, string | number | boolean>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}=${String(v).replace(/[\t\n\r;]+/g, " ")}`)
    .join(";")
}

function logTimestamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ---------------------------------------------------------------------------------------------- preconditions

async function hostEnv(): Promise<HostEnv> {
  if (process.platform !== "darwin")
    throw new Precondition(`a macOS host with the QA account's GUI session (this host is ${process.platform})`)
  const cuRun = process.env.CU_RUN
  if (!cuRun) throw new Precondition("CU_RUN is not set (the host-side run root)")
  if (!existsSync(join(cuRun, "t3-signing", "IDENTITY")))
    throw new Precondition(`the T3 signing identity ($CU_RUN/t3-signing/IDENTITY); run sp-t-identity.sh create`)
  for (const tool of ["clang", "codesign", "security", "openssl", "sqlite3", "log", "launchctl", "open", "tccutil"]) {
    if (!Bun.which(tool)) throw new Precondition(`the ${tool} command`)
  }
  if (!existsSync(LSREGISTER)) throw new Precondition("lsregister (LaunchServices support tool)")
  const product = must(await run(["sw_vers", "-productVersion"]), "sw_vers -productVersion")
  const build = must(await run(["sw_vers", "-buildVersion"]), "sw_vers -buildVersion")
  const arch = must(await run(["uname", "-m"]), "uname -m")
  const qaUser = process.env.SPT_QA_USER ?? must(await run(["id", "-un"]), "id -un").stdout
  const uid = await run(["id", "-u", qaUser])
  if (uid.code !== 0) throw new Precondition(`the QA account ${qaUser}`)
  const sameUser = uid.stdout === must(await run(["id", "-u"]), "id -u").stdout
  if (!sameUser && (await run(["sudo", "-n", "true"])).code !== 0)
    throw new Precondition("a root sudo ticket (the probe runs as another account than the QA account)")
  // a failed ps is an error, never "no GUI session"
  const session = must(await run(["ps", "-U", qaUser, "-o", "comm="]), "ps -U")
  const comms = session.stdout.split("\n")
  if (!comms.some((c) => c.endsWith("/Dock")) || !comms.some((c) => c.endsWith("/Finder")))
    throw new Precondition(`a live GUI session of the QA account (no Dock/Finder under ${qaUser})`)
  const qaHome = must(await run(["dscl", ".", "-read", `/Users/${qaUser}`, "NFSHomeDirectory"]), "dscl").stdout.replace(
    /^NFSHomeDirectory:\s*/,
    "",
  )
  const work = join(cuRun, "sp-t-work")
  const ev = process.env.EV ?? join(cuRun, "evidence")
  const env: HostEnv = {
    major: Number(product.stdout.split(".")[0]),
    build: `macOS ${product.stdout} (${build.stdout}) ${arch.stdout}`,
    qaUser,
    qaUid: Number(uid.stdout),
    qaHome,
    sameUser,
    work,
    ev,
    commit:
      process.env.SPT_COMMIT ??
      must(await run(["git", "-C", PROBE_DIR, "rev-parse", "HEAD"]), "git rev-parse (set SPT_COMMIT)").stdout,
    bun: process.env.SPT_BUN ?? process.execPath,
    ownManager: must(await run(["launchctl", "managername"]), "launchctl managername").stdout,
  }
  const bunCheck = await run(asQa(env, [env.bun, "--version"]))
  if (bunCheck.code !== 0) throw new Precondition("a bun the QA account can execute (set SPT_BUN)")
  if ((await run(asQa(env, ["test", "-r", join(PROBE_DIR, "probe-sp-t.ts")]))).code !== 0)
    throw new Precondition("the probe directory readable by the QA account (stage it under $CU_RUN)")
  return env
}

// ---------------------------------------------------------------------------------------------- work tree

const paths = (env: HostEnv) => ({
  bin: join(env.work, "bin"),
  spawner: join(env.work, "bin", "sp-t-spawn"),
  generations: join(env.work, "generations"),
  current: join(env.work, "current"),
  previous: join(env.work, "previous"),
  results: join(env.work, "results"),
  prompt: join(env.work, "prompt-probe", APP_NAME),
  rebuild: join(env.work, "rebuild", APP_NAME),
})

async function buildApp(appPath: string, bundleId: string, display: string, marker: string) {
  const out = await run(["bash", join(PROBE_DIR, "sp-t-bundle.sh"), "app", appPath, bundleId, display, marker])
  if (out.code !== 0) throw new Error(`bundle build failed: ${out.stderr || out.stdout}`)
  const cdhash = /cdhash=(\S+)/.exec(out.stdout)?.[1] ?? ""
  const requirement = /requirement=(.*)/.exec(out.stdout)?.[1] ?? ""
  return { cdhash, requirement }
}

async function newGeneration(env: HostEnv, marker: string) {
  const p = paths(env)
  const staging = join(env.work, `staging-${marker}`, APP_NAME)
  const built = await buildApp(staging, BUNDLE_ID, DISPLAY_NAME, marker)
  const genDir = join(p.generations, built.cdhash)
  mkdirSync(genDir, { recursive: true })
  must(await run(["ditto", "--noextattr", "--noqtn", staging, join(genDir, APP_NAME)]), "ditto")
  rmSync(join(env.work, `staging-${marker}`), { recursive: true, force: true })
  must(await run(asQa(env, [LSREGISTER, "-f", join(genDir, APP_NAME)])), "lsregister -f")
  return { ...built, app: join(genDir, APP_NAME) }
}

function pointLink(link: string, target: string) {
  rmSync(link, { force: true })
  symlinkSync(target, link)
}

async function swapGeneration(env: HostEnv, marker: string) {
  const p = paths(env)
  const gen = await newGeneration(env, marker)
  if (existsSync(p.current)) pointLink(p.previous, realpathSync(p.current))
  pointLink(p.current, join(p.generations, gen.cdhash))
  return gen
}

function currentApp(env: HostEnv): string {
  return realpathSync(join(paths(env).current, APP_NAME))
}

async function setup(env: HostEnv) {
  process.umask(0o022)
  const p = paths(env)
  mkdirSync(p.bin, { recursive: true })
  await ensureResultsDir(env, p.results)
  if (!existsSync(p.spawner)) {
    const out = await run(["bash", join(PROBE_DIR, "sp-t-bundle.sh"), "spawner", p.spawner])
    if (out.code !== 0) throw new Error(`spawner build failed: ${out.stderr}`)
  }
  if (!existsSync(p.current)) await swapGeneration(env, `gen-a-${Date.now()}`)
  if (!existsSync(p.previous)) await swapGeneration(env, `gen-b-${Date.now()}`)
  if (!existsSync(p.prompt))
    await buildApp(p.prompt, PROMPT_BUNDLE_ID, `${DISPLAY_NAME} SP-T prompt probe`, `prompt-${Date.now()}`)
  return p
}

// ---------------------------------------------------------------------------------------------- legs

async function leg(specPath: string): Promise<number> {
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as LegSpec
  const startedAt = Date.now()
  const reportArgs = [
    "report",
    "--result",
    spec.result,
    "--tag",
    spec.tag,
    "--host-pid",
    String(process.pid),
    ...(spec.prompt ? ["--prompt", spec.prompt] : []),
  ]
  const tapping = spec.tapSeconds !== undefined
  const launcherArgs = tapping ? ["tap", String(spec.tapSeconds), spec.result] : reportArgs
  const argv =
    spec.action === "open-path"
      ? ["open", spec.target, "--args", ...launcherArgs]
      : spec.action === "open-name"
        ? ["open", "-a", spec.target, "--args", ...launcherArgs]
        : [spec.spawner, "spawn", spec.action, join(spec.target, EXE_REL), ...launcherArgs]
  const launch = await run(argv)
  let report: ProbeReport | null = null
  while (Date.now() - startedAt < spec.timeoutMs) {
    if (tapping) {
      if (existsSync(spec.result) && readFileSync(spec.result, "utf8").includes('"tapDone":true')) break
    } else if (existsSync(spec.result)) {
      report = JSON.parse(readFileSync(spec.result, "utf8")) as ProbeReport
      break
    }
    await sleep(200)
  }
  const result: LegResult = {
    hostPid: process.pid,
    hostExe: process.execPath,
    hostManager: must(await run(["launchctl", "managername"]), "launchctl managername").stdout,
    launch: { argv, ...launch },
    report,
    waitedMs: Date.now() - startedAt,
    startedAt,
    ...(tapping ? { tapFile: spec.result } : {}),
  }
  writeFileSync(`${spec.done}.tmp`, JSON.stringify(result))
  must(await run(["mv", `${spec.done}.tmp`, spec.done]), "mv of the leg result")
  return report || tapping ? 0 : 1
}

let legCounter = 0

async function runLeg(
  env: HostEnv,
  log: EvidenceLog,
  context: Context,
  action: LaunchAction,
  target: string,
  prompt: LegSpec["prompt"] = "",
  tapSeconds?: number,
): Promise<LegResult> {
  const p = paths(env)
  const tag = `${context}-${action}-${Date.now()}-${legCounter++}`
  const spec: LegSpec = {
    action,
    target,
    prompt,
    tag,
    result: join(p.results, tapSeconds === undefined ? `${tag}.report.json` : `${tag}.tap.jsonl`),
    done: join(p.results, `${tag}.done.json`),
    spawner: p.spawner,
    timeoutMs: tapSeconds === undefined ? LEG_TIMEOUT_MS : (tapSeconds + 15) * 1000,
    ...(tapSeconds === undefined ? {} : { tapSeconds }),
  }
  const specPath = join(p.results, `${tag}.spec.json`)
  await qaWrite(env, specPath, JSON.stringify(spec))
  const legArgv = [env.bun, join(PROBE_DIR, "probe-sp-t.ts"), "--leg", specPath]
  let driver
  if (context === "gui") {
    const label = `ai.sisyphuslabs.sp-t.${tag}`
    driver = await run(
      [
        "bash",
        join(PROBE_DIR, "sp-t-gui-leg.sh"),
        label,
        String(spec.timeoutMs / 1000 + 10),
        spec.done,
        join(p.results, `${tag}.launchd.log`),
        "--",
        ...legArgv,
      ],
      {
        env: {
          SPT_QA_USER: env.qaUser,
          SPT_GUI_ROUTE: env.sameUser ? "self" : "sudo",
          CU_RUN: process.env.CU_RUN ?? "",
          EV: env.ev,
          SPT_COMMIT: env.commit,
        },
      },
    )
  } else {
    if (env.ownManager === "Aqua")
      throw new Precondition("an ssh context for the ssh-child rows (this probe runs under the Aqua manager)")
    driver = await run(asQa(env, legArgv))
  }
  log.add(`leg ${tag} driver (${context})`, driver)
  if (context === "gui" && driver.code === 3)
    throw new Precondition(
      `a bootstrap into gui/${env.qaUid} (refused: ${driver.stdout.split("\n").slice(-2).join(" ")})`,
    )
  const done = await qaRead(env, spec.done)
  if (done === null)
    throw new Error(`leg ${tag} produced no result (driver exit ${driver.code}): ${driver.stderr || driver.stdout}`)
  const result = JSON.parse(done) as LegResult
  log.add(`leg ${tag} result`, result)
  return result
}

interface RunOut {
  code: number
  stdout: string
  stderr: string
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

interface TccRow {
  service: string
  client: string
  clientType: string
  authValue: string
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? ""
}

// pure: the tccd log lines that mention a needle; a failed `log show` is an error, never "no lines"
function parseTccLog(out: RunOut, needles: string[]): Parsed<string[]> {
  if (out.code !== 0) return { ok: false, error: `log show exited ${out.code}: ${firstLine(out.stderr)}` }
  return { ok: true, value: out.stdout.split("\n").filter((line) => needles.some((n) => n && line.includes(n))) }
}

// pure: the TCC.db rows. The helper exits non-zero when a database is unreadable, and both database headers must be
// present: a failed or partial read is an error, never "no grant" (Accessibility rows live in the system database)
function parseTccDb(out: RunOut): Parsed<TccRow[]> {
  if (out.code !== 0)
    return {
      ok: false,
      error: `sp-t-tccdb.sh exited ${out.code}: ${firstLine(out.stderr) || out.stdout.split("\n").find((l) => l.includes("UNREADABLE")) || ""}`,
    }
  for (const scope of ["user", "system"])
    if (!out.stdout.split("\n").some((l) => l.startsWith(`#db ${scope} `)))
      return { ok: false, error: `TCC.db read-back is missing the ${scope} database header` }
  const rows = out.stdout
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [service = "", client = "", clientType = "", authValue = ""] = l.split("\t")
      return { service, client, clientType, authValue }
    })
  return { ok: true, value: rows }
}

// pure: whether pgrep found a match; exit 1 is "no match", anything else is an error, never "not running"
function pgrepFound(out: RunOut): boolean {
  if (out.code === 0) return true
  if (out.code === 1) return false
  throw new Error(`pgrep exited ${out.code}: ${firstLine(out.stderr)}`)
}

// a command whose failure must not be read as an answer: throw with its exit code and stderr
function must(out: RunOut, what: string): RunOut {
  if (out.code !== 0) throw new Error(`${what} exited ${out.code}: ${firstLine(out.stderr)}`)
  return out
}

// a reader that could not produce its evidence: the row is UNMEASURED with the reason
class Unmeasurable extends Error {}

async function tccLog(env: HostEnv, log: EvidenceLog, since: number, needles: string[]) {
  const out = await run([
    "log",
    "show",
    "--start",
    logTimestamp(since - 2000),
    "--style",
    "compact",
    "--predicate",
    'subsystem == "com.apple.TCC" OR process == "universalAccessAuthWarn"',
  ])
  const parsed = parseTccLog(out, needles)
  if (!parsed.ok) {
    log.add(`tccd log since ${logTimestamp(since - 2000)} FAILED`, out)
    throw new Unmeasurable(parsed.error)
  }
  log.add(
    `tccd log since ${logTimestamp(since - 2000)} (${parsed.value.length} matching lines, exit ${out.code})`,
    parsed.value.join("\n") || "(none)",
  )
  return parsed.value
}

async function tccDb(env: HostEnv, log: EvidenceLog, client: string): Promise<TccRow[]> {
  const out = await run(["bash", join(PROBE_DIR, "sp-t-tccdb.sh"), client], { env: { HOME: env.qaHome } })
  log.add(`TCC.db read-back for ${client}`, out)
  const parsed = parseTccDb(out)
  if (!parsed.ok) throw new Unmeasurable(`TCC.db read-back failed: ${parsed.error}`)
  return parsed.value
}

// ---------------------------------------------------------------------------------------------- classification

function classifyCharged(report: ProbeReport, leg: LegResult): string {
  if (!report.responsibleSymbol) return "UNMEASURED"
  if (report.responsibleExe.includes(`/${APP_NAME}/`)) return "bundle"
  if (report.responsibleExe === leg.hostExe) return "host"
  return `other:${basename(report.responsibleExe) || "unresolved"}`
}

function identityPath(report: ProbeReport): string {
  if (report.responsiblePid !== report.pid) return `inherited:${basename(report.responsibleExe)}`
  return report.ppid === 1 ? "open_a" : "disclaim"
}

function domainOf(report: ProbeReport): string {
  return `${report.managerName || "unknown"}/graphic=${report.securitySession.hasGraphicAccess ? 1 : 0}`
}

function base(report: ProbeReport | null, leg: LegResult): Record<string, string | number | boolean> {
  if (!report) return { report: "none", launchExit: leg.launch.code, hostManager: leg.hostManager }
  return {
    launchExit: leg.launch.code,
    hostManager: leg.hostManager,
    pid: report.pid,
    ppid: report.ppid,
    responsibleExe: basename(report.responsibleExe),
    responsibleIsSelf: report.responsiblePid === report.pid,
    manager: report.managerName,
    graphic: report.securitySession.hasGraphicAccess,
    ax: report.preflight.accessibility,
    sr: report.preflight.screenRecording,
    im: report.preflight.inputMonitoring,
  }
}

function noReport(leg: LegResult, what: string): Measured {
  return {
    verdict: "NO_LAUNCH",
    measured: base(null, leg),
    note: `${what}: the launcher wrote no report within ${LEG_TIMEOUT_MS / 1000}s (launch exit ${leg.launch.code})`,
  }
}

// ---------------------------------------------------------------------------------------------- measurements

function actionFor(path: "open" | "disclaim" | "plain"): LaunchAction {
  return path === "open" ? "open-path" : path
}

function charged(context: Context, path: "open" | "disclaim" | "plain") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const result = await runLeg(env, log, context, actionFor(path), currentApp(env))
    if (!result.report) return noReport(result, "charged")
    const lines = await tccLog(env, log, result.startedAt, [BUNDLE_ID, `pid=${result.report.pid}`])
    const attributed =
      lines.map((l) => /responsible=\{TCCDProcess: identifier=([^,]+)/.exec(l)?.[1]).find(Boolean) ?? ""
    let verdict = classifyCharged(result.report, result)
    if (attributed && (attributed === BUNDLE_ID) !== (verdict === "bundle"))
      verdict = `CONFLICT(responsibility=${verdict},tccd=${attributed})`
    return {
      verdict: `CHARGED=${verdict}`,
      measured: { ...base(result.report, result), tccdResponsible: attributed || "no attribution line" },
      note: "responsibility_get_pid_responsible_for_pid read inside the launcher, cross-checked against the tccd AUTHREQ_ATTRIBUTION line of its preflight",
    }
  }
}

// the grant-check leg: null when the helper bundle holds Accessibility, else the row's outcome
async function grantCheck(env: HostEnv, log: EvidenceLog): Promise<Measured | null> {
  return grantGate(await runLeg(env, log, "gui", "open-path", currentApp(env)))
}

// pure: "not granted" only from a report that says so; a leg with no report is NO_LAUNCH, never "not granted"
function grantGate(result: LegResult): Measured | null {
  if (!result.report) return noReport(result, "grant check")
  return result.report.preflight.accessibility === 1 ? null : AWAITING_H3
}

const AWAITING_H3: Measured = {
  verdict: "WAITING-PERSON",
  measured: {},
  note: `${PERSON_REASON.grant} (measured: Accessibility is not granted to the helper bundle)`,
}

function clientType(path: "open" | "disclaim") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const grant = await grantCheck(env, log)
    if (grant) return grant
    const result = await runLeg(env, log, "gui", actionFor(path), currentApp(env))
    if (!result.report) return noReport(result, "client_type")
    const rows = await tccDb(env, log, "omo-computer-helper")
    const ax = rows.filter(
      (r) => r.service === "kTCCServiceAccessibility" && (r.client === BUNDLE_ID || r.client.includes(`/${APP_NAME}`)),
    )
    const covered = result.report.preflight.accessibility === 1
    const types = [...new Set(ax.map((r) => r.clientType))].sort().join("+") || "none"
    return {
      verdict: covered ? `CLIENT_TYPE=${types}` : `NOT_COVERED(rows=${types})`,
      measured: {
        ...base(result.report, result),
        rows:
          ax.map((r) => `${r.clientType === "0" ? r.client : "<path>"}:${r.clientType}:${r.authValue}`).join(",") ||
          "none",
      },
      note: "the Accessibility rows for the helper bundle after the H3 grant, read beside the launcher's own AXIsProcessTrusted",
    }
  }
}

function swapSurvives(path: "open" | "disclaim") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const grant = await grantCheck(env, log)
    if (grant) return grant
    const before = currentApp(env)
    const gen = await swapGeneration(env, `swap-${path}-${Date.now()}`)
    log.add("generation swap", { before, after: gen.app, cdhash: gen.cdhash, requirement: gen.requirement })
    const result = await runLeg(env, log, "gui", actionFor(path), currentApp(env))
    if (!result.report) return noReport(result, "swap")
    const swapped = result.report.exe.startsWith(realpathSync(gen.app))
    return {
      verdict: swapped ? `SURVIVES=${result.report.preflight.accessibility === 1 ? "yes" : "no"}` : "NOT_SWAPPED",
      measured: {
        ...base(result.report, result),
        ranNewGeneration: swapped,
        currentResolvesTo: basename(join(currentApp(env), "..")),
        requirement: gen.requirement,
      },
      note: "grant given to the bundle before the swap; current re-pointed to a new generations/<cdhash>/ directory; the launch passes the RESOLVED current-generation bundle path (what `open <current-generation bundle path>` names), not the current link itself; the new copy's AXIsProcessTrusted",
    }
  }
}

function identityPathRow(path: "open" | "disclaim") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const result = await runLeg(env, log, "gui", actionFor(path), currentApp(env))
    if (!result.report) return noReport(result, "identity.path")
    return {
      verdict: `IDENTITY_PATH=${identityPath(result.report)}`,
      measured: base(result.report, result),
      note: "open_a = parent is launchd and the launcher is its own responsible process; disclaim = parent is the spawner and the launcher is its own responsible process",
    }
  }
}

async function byNameOpen(env: HostEnv, log: EvidenceLog): Promise<Measured> {
  const p = paths(env)
  const current = realpathSync(join(p.current, APP_NAME))
  const previous = realpathSync(join(p.previous, APP_NAME))
  for (const app of [current, previous]) must(await run(asQa(env, [LSREGISTER, "-f", app])), "lsregister -f")
  const dumpOut = must(await run(asQa(env, [LSREGISTER, "-dump"])), "lsregister -dump")
  const dump = { stdout: String(dumpOut.stdout.split("\n").filter((l) => l.endsWith(BUNDLE_ID)).length) }
  const result = await runLeg(env, log, "gui", "open-name", BUNDLE_NAME)
  if (!result.report) return noReport(result, "open -a")
  const exe = result.report.exe
  const launched = exe.startsWith(current) ? "current" : exe.startsWith(previous) ? "previous" : "other"
  return {
    verdict: `LAUNCHED=${launched}`,
    measured: { ...base(result.report, result), registeredEntries: dump.stdout },
    note: "current and previous both registered with lsregister -f, then open -a <bundle name>; the launched copy read from proc_pidpath",
  }
}

async function rebuildSurvives(env: HostEnv, log: EvidenceLog): Promise<Measured> {
  const grant = await grantCheck(env, log)
  if (grant) return grant
  const p = paths(env)
  const readings: string[] = []
  const requirements: string[] = []
  for (const marker of [`rebuild-1-${Date.now()}`, `rebuild-2-${Date.now()}`]) {
    const built = await buildApp(p.rebuild, BUNDLE_ID, DISPLAY_NAME, marker)
    requirements.push(built.requirement)
    log.add(`rebuild ${marker}`, built)
    const result = await runLeg(env, log, "gui", "open-path", p.rebuild)
    if (!result.report) return noReport(result, "rebuild")
    readings.push(`${built.cdhash.slice(0, 12)}:ax=${result.report.preflight.accessibility}`)
  }
  const sameRequirement = requirements[0] === requirements[1]
  const namesHash = requirements.some((r) => r.includes("cdhash"))
  return {
    verdict: `SURVIVES=${readings.every((r) => r.endsWith("ax=1")) ? "yes" : "no"}`,
    measured: {
      readings: readings.join(","),
      sameRequirement,
      requirementNamesCdhash: namesHash,
      requirement: requirements[0] ?? "",
    },
    note: "two builds at one path signed with the T3 identity (different cdhash, same designated requirement), each launched by path",
  }
}

function domainRow(context: Context, path: "open" | "disclaim") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const result = await runLeg(env, log, context, actionFor(path), currentApp(env))
    if (!result.report) return noReport(result, "domain")
    return {
      verdict: `DOMAIN=${domainOf(result.report)}`,
      measured: {
        ...base(result.report, result),
        ancestry: result.report.ancestry.map((a) => basename(a.exe)).join("<"),
      },
      note: "launchctl managername run by the launcher itself, plus SessionGetInfo sessionHasGraphicAccess",
    }
  }
}

function promptRow(context: Context, path: "open" | "disclaim") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    const p = paths(env)
    const reset = await run(asQa(env, ["tccutil", "reset", "Accessibility", PROMPT_BUNDLE_ID]))
    log.add("reset prompt-probe rows before the prompt", reset)
    // a stale Deny left by a failed reset would read as PROMPT=none, so the row is not measured at all
    if (reset.code !== 0) return resetFailed("before", reset)
    console.log(
      `OPERATOR: a TCC dialog naming "${DISPLAY_NAME} SP-T prompt probe" may appear on the QA session; answer Deny.`,
    )
    let outcome: Measured
    let after: Awaited<ReturnType<typeof run>>
    try {
      const result = await runLeg(env, log, context, actionFor(path), p.prompt, "ax")
      if (!result.report) outcome = noReport(result, "prompt")
      else {
        const seenAfterMs = await pollForProcess("universalAccessAuthWarn", PROMPT_POLL_MS)
        const lines = await tccLog(env, log, result.startedAt, [
          PROMPT_BUNDLE_ID,
          "universalAccessAuthWarn",
          `pid=${result.report.pid}`,
        ])
        outcome = {
          verdict: `PROMPT=${promptVerdict(lines, seenAfterMs !== null)}`,
          measured: {
            ...base(result.report, result),
            promptLines: lines.length,
            authWarnProcess: seenAfterMs !== null,
            authWarnSeenAfterMs: seenAfterMs ?? `not within ${PROMPT_POLL_MS}`,
          },
          note: "a separate never-granted identifier (the prompt probe) asks AXIsProcessTrustedWithOptions(prompt); read from the tccd prompting lines and a bounded poll for the universalAccessAuthWarn process",
        }
      }
    } finally {
      // every exit path, including a leg with no report or a thrown error, leaves no Deny row for the prompt probe
      after = await run(asQa(env, ["tccutil", "reset", "Accessibility", PROMPT_BUNDLE_ID]))
      log.add("reset prompt-probe rows after the prompt", after)
    }
    if (after.code !== 0)
      return {
        ...outcome,
        note: `${outcome.note}; ${resetFailed("after", after).note} (the Deny row may remain until --cleanup)`,
      }
    return outcome
  }
}

const PROMPT_POLL_MS = 10_000

function resetFailed(when: "before" | "after", out: { code: number; stderr: string }): Measured {
  return {
    verdict: "UNMEASURED",
    measured: { resetExit: out.code },
    note: `tccutil reset Accessibility of the prompt-probe identifier ${when} the prompt failed (exit ${out.code}: ${out.stderr.split("\n")[0] ?? ""})`,
  }
}

// bounded wait for a process to appear: returns the ms it took, or null when it never appeared within the bound
async function pollForProcess(name: string, boundMs: number): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < boundMs) {
    if (pgrepFound(await run(["pgrep", "-x", name]))) return Date.now() - start
    await sleep(250)
  }
  return null
}

// pure: the prompt verdict from the tccd log lines and whether the prompt process was seen
function promptVerdict(lines: string[], authWarnSeen: boolean): "shown" | "none" {
  return authWarnSeen || lines.some((l) => /AUTHREQ_PROMPTING|prompting|universalAccessAuthWarn/i.test(l))
    ? "shown"
    : "none"
}

async function bunshinDomain(env: HostEnv, log: EvidenceLog): Promise<Measured> {
  const ps = must(await run(["ps", "-axo", "pid=,uid=,command="]), "ps -axo")
  const agents = ps.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /bunshin/i.test(basename(l.split(/\s+/)[2] ?? "")))
  log.add("bunshin processes", agents.map((l) => l.replace(/\s+\S*\/Users\/[^ ]+/g, " <path>")).join("\n") || "(none)")
  if (agents.length === 0) return { verdict: "UNMEASURED", measured: {}, note: "no bunshin agent process on this host" }
  const domains = new Set<string>()
  for (const line of agents) {
    const pid = line.split(/\s+/)[0] ?? ""
    const info = await run(["sudo", "-n", "launchctl", "procinfo", pid])
    log.add(
      `launchctl procinfo ${pid}`,
      info.code === 0
        ? info.stdout
            .split("\n")
            .filter((l) => /domain|session|manager/i.test(l))
            .join("\n")
        : info.stderr,
    )
    const text = info.stdout
    if (info.code !== 0) domains.add("unreadable")
    else if (/gui\/\d+/.test(text)) domains.add("gui")
    else if (/user\/\d+/.test(text)) domains.add("user")
    else if (/\bsystem\b/.test(text)) domains.add("system")
    else domains.add("other")
  }
  const list = [...domains].sort().join("+")
  if (list === "unreadable")
    return {
      verdict: "UNMEASURED",
      measured: { agents: agents.length },
      note: "launchctl procinfo needs a root sudo ticket",
    }
  return {
    verdict: `DOMAIN=${list}`,
    measured: { agents: agents.length },
    note: "launchctl procinfo <pid> for every bunshin agent process on the host",
  }
}

function untagged(route: "hypervisor-vkbd" | "vhid") {
  return async (env: HostEnv, log: EvidenceLog): Promise<Measured> => {
    // the route itself is checked by measureRow BEFORE the person gate (routeGate), so a host without the route reads
    // UNMEASURED 'awaiting H2/H4' whether or not a person is present
    const seconds = Number(process.env.SPT_TAP_SECONDS ?? "20")
    console.log(`OPERATOR: press the "a" key through the ${route} route within ${seconds}s.`)
    // the tap runs inside the helper bundle launched BY PATH through LaunchServices, like the other legs, so the
    // bundle is its own responsible process and TCC checks Input Monitoring for the helper bundle's identity
    const leg = await runLeg(env, log, "gui", "open-path", currentApp(env), "", seconds)
    const tapText = leg.tapFile ? await qaRead(env, leg.tapFile) : null
    log.add("tap file", tapText === null ? "(not read)" : tapText)
    return tapOutcome(tapText, leg.launch.code)
  }
}

interface TapEvent {
  type?: number
  sourcePid?: number
  sourceStateId?: number
  error?: string
}

// pure: the untagged-route verdict from the tap file text. null = the file could not be read: NO_LAUNCH after a failed
// launch, otherwise UNMEASURED; NO_EVENT only from a file that was read and holds no keyDown
function tapOutcome(tapText: string | null, launchCode: number): Measured {
  if (tapText === null)
    return launchCode !== 0
      ? {
          verdict: "NO_LAUNCH",
          measured: { launchExit: launchCode },
          note: `the tap launch exited ${launchCode} and wrote no readable tap file`,
        }
      : {
          verdict: "UNMEASURED",
          measured: { launchExit: launchCode },
          note: "the tap file could not be read (never written, or unreadable as the QA account); no keyDown count is claimed",
        }
  const events = (tapText ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TapEvent)
  const keys = events.filter((e) => e.type === 10)
  if (events.some((e) => e.error))
    return {
      verdict: "UNMEASURED",
      measured: { launchExit: launchCode },
      note: "the session tap could not be created inside the helper bundle launched by path (its own responsible process): Input Monitoring is not granted to the helper bundle",
    }
  if (keys.length === 0)
    return { verdict: "NO_EVENT", measured: { events: events.length }, note: "no keyDown reached the session tap" }
  return {
    verdict: `ROUTE=${classifyTap(keys)}`,
    measured: {
      keyDowns: keys.length,
      sourcePids: [...new Set(keys.map((e) => e.sourcePid))].join(","),
      stateIds: [...new Set(keys.map((e) => e.sourceStateId))].join(","),
    },
    note: "listen-only kCGSessionEventTap inside the helper bundle launched by path (open <bundle> --args tap; the bundle is its own responsible process); untagged = kCGEventSourceUnixProcessID 0 on every keyDown",
  }
}

// pure: untagged = every keyDown carries kCGEventSourceUnixProcessID 0
function classifyTap(keys: TapEvent[]): "untagged" | "mixed" | "tagged" {
  if (keys.every((e) => e.sourcePid === 0)) return "untagged"
  return keys.some((e) => e.sourcePid === 0) ? "mixed" : "tagged"
}

// ---------------------------------------------------------------------------------------------- the row table

const Q = {
  charged: "Which process does tccd charge for the launcher (the helper bundle)?",
  clientType: "Which client_type does TCC.db record for the grant (0 = bundle id, 1 = path)?",
  swap: "Does the grant survive a generations/<cdhash>/ swap under current?",
  identityPath: "Which identity.path does the launcher report (open_a or disclaim)?",
  byName: "With current AND previous both registered, does by-name open -a launch current?",
  rebuild: "Does a grant given to the bundle survive a rebuild signed with the same identity?",
  domain: "Which launchd session does the launcher land in?",
  prompt: "Does the TCC prompt appear at all?",
  bunshin: "Which launchd domain does the bunshin agent run in on a Mac?",
  untagged: "Which route delivers a key press that a session tap sees as untagged hardware input?",
}

const C = {
  guiOpen: "GUI-resident Bun host (LaunchAgent in gui/<uid>) -> open <current bundle path> --args --host-pid <pid>",
  guiDisclaim: "GUI-resident Bun host -> posix_spawn with responsibility_spawnattrs_setdisclaim",
  guiPlain: "GUI-resident Bun host -> plain posix_spawn (control, no disclaim)",
  sshOpen: "ssh child -> open <current bundle path> --args --host-pid <pid>",
  sshDisclaim: "ssh child -> posix_spawn with responsibility_spawnattrs_setdisclaim",
  sshPromptOpen:
    "ssh child -> open <prompt-probe bundle path> --args --prompt ax (never-granted prompt-probe identifier)",
  sshPromptDisclaim:
    "ssh child -> posix_spawn of the prompt-probe bundle with responsibility_spawnattrs_setdisclaim (never-granted prompt-probe identifier)",
  guiOpenPromptControl: "GUI-resident Bun host -> open <prompt-probe bundle path> (positive control)",
  byName: "GUI-resident Bun host -> open -a <bundle name> with current and previous registered",
  rebuild: "GUI-resident Bun host -> open <rebuilt bundle path>, same T3 identity",
  bunshin: "launchctl procinfo of the running agent",
}

function osRows(os: Os): RowDef[] {
  const host: HostRole = os === 26 ? "h1" : "h2"
  const needs = os === 15 ? ("h2" as const) : undefined
  const row = (
    slug: string,
    question: string,
    condition: string,
    measure: RowDef["measure"],
    person?: PersonNeed,
  ): RowDef => ({
    id: `${slug}.m${os}`,
    question,
    condition,
    host,
    os,
    needs,
    ...(person ? { person } : {}),
    measure,
  })
  return [
    row("bunshin-domain", Q.bunshin, C.bunshin, bunshinDomain),
    row("domain.ssh-open", Q.domain, C.sshOpen, domainRow("ssh", "open")),
    row("domain.ssh-disclaim", Q.domain, C.sshDisclaim, domainRow("ssh", "disclaim")),
    row("charged.ssh-open", Q.charged, C.sshOpen, charged("ssh", "open")),
    row("charged.ssh-disclaim", Q.charged, C.sshDisclaim, charged("ssh", "disclaim")),
    row("prompt.gui-open-control", Q.prompt, C.guiOpenPromptControl, promptRow("gui", "open"), "deny"),
    row("prompt.ssh-open", Q.prompt, C.sshPromptOpen, promptRow("ssh", "open"), "deny"),
    row("prompt.ssh-disclaim", Q.prompt, C.sshPromptDisclaim, promptRow("ssh", "disclaim"), "deny"),
    row("charged.gui-open", Q.charged, C.guiOpen, charged("gui", "open")),
    row("charged.gui-disclaim", Q.charged, C.guiDisclaim, charged("gui", "disclaim")),
    row("charged.gui-plain-control", Q.charged, C.guiPlain, charged("gui", "plain")),
    row("domain.gui-open", Q.domain, C.guiOpen, domainRow("gui", "open")),
    row("domain.gui-disclaim", Q.domain, C.guiDisclaim, domainRow("gui", "disclaim")),
    row("identity-path.gui-open", Q.identityPath, C.guiOpen, identityPathRow("open")),
    row("identity-path.gui-disclaim", Q.identityPath, C.guiDisclaim, identityPathRow("disclaim")),
    row("by-name-open-a.gui", Q.byName, C.byName, byNameOpen),
    row("client-type.gui-open", Q.clientType, C.guiOpen, clientType("open"), "grant"),
    row("client-type.gui-disclaim", Q.clientType, C.guiDisclaim, clientType("disclaim"), "grant"),
    row("swap.gui-open", Q.swap, C.guiOpen, swapSurvives("open"), "grant"),
    row("swap.gui-disclaim", Q.swap, C.guiDisclaim, swapSurvives("disclaim"), "grant"),
    row("rebuild.gui-open", Q.rebuild, C.rebuild, rebuildSurvives, "grant"),
  ]
}

const ROWS: RowDef[] = [
  ...osRows(26),
  ...osRows(15).filter((r) => !r.id.startsWith("bunshin-domain")),
  {
    id: "untagged.hypervisor-vkbd",
    question: Q.untagged,
    condition: "the hypervisor's virtual keyboard inside an H2 virtual machine",
    host: "h2",
    os: 26,
    needs: "h2",
    person: "tap",
    route: "hypervisor-vkbd",
    measure: untagged("hypervisor-vkbd"),
  },
  {
    id: "untagged.vhid",
    question: Q.untagged,
    condition: "the H4 virtual HID keyboard on the QA Mac",
    host: "h4",
    os: 26,
    needs: "h4",
    person: "tap",
    route: "vhid",
    measure: untagged("vhid"),
  },
]

// ---------------------------------------------------------------------------------------------- ledger

function rerun(id: string): string {
  return `bun crates/omo-computer-backend-macos/probes/probe-sp-t.ts --row ${id}`
}

function evidencePath(id: string): string {
  return `$EV/task-9.sp-t/${id}.txt`
}

function skeletonLine(def: RowDef): string[] {
  const awaiting =
    def.needs === "h4"
      ? "awaiting H4: the host is not confirmed"
      : def.needs === "h2"
        ? "awaiting H2: the host is not confirmed"
        : "awaiting H1: the named host has no QA account"
  const person = def.person ? `; then WAITING-PERSON: ${PERSON_REASON[def.person]}` : ""
  const verdict = "UNMEASURED"
  const note = `${awaiting}${person}`
  return [
    def.id,
    def.question,
    def.condition,
    HOSTS[def.host] + (def.host === "h1" || def.host === "h2" ? ` (macOS ${def.os})` : ""),
    verdict,
    rerun(def.id),
    `none: ${awaiting.split(":")[0]}`,
    "-",
    evidencePath(def.id),
    note,
  ]
}

function parseLedger(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const line of text.split("\n").slice(1)) {
    if (!line.trim()) continue
    const cols = line.split("\t")
    map.set(cols[0] ?? "", cols)
  }
  return map
}

function ledgerText(rows: string[][]): string {
  return `${[HEADER, ...rows].map((r) => r.join("\t")).join("\n")}\n`
}

// H1 rows and the H4 row run on the QA Mac; H2 rows run inside an H2 virtual machine started with SPT_HOST_ROLE=h2.
function appliesHere(def: RowDef, env: HostEnv): boolean {
  const role = process.env.SPT_HOST_ROLE === "h2" ? "h2" : "h1"
  return def.os === env.major && (def.host === "h2" ? "h2" : "h1") === role
}

// pure: a row bound to a key route reads UNMEASURED 'awaiting H2/H4' until that route exists, checked before the person
function routeGate(def: RowDef, hwRoute: string | undefined): Measured | null {
  if (!def.route || hwRoute === def.route) return null
  const awaiting = def.route === "vhid" ? "awaiting H4" : "awaiting H2"
  return {
    verdict: "UNMEASURED",
    measured: {},
    note: `${awaiting}: set SPT_HW_ROUTE=${def.route} on a host where that route exists`,
  }
}

// --measure and --row write the row's evidence file (the ledger's evidence column); --verify writes <id>.verify.txt
// beside it, so a DIFF never replaces the evidence behind the recorded verdict
function evidenceFile(id: string, mode: "measure" | "verify"): string {
  return mode === "verify" ? `${id}.verify.txt` : `${id}.txt`
}

async function measureRow(
  def: RowDef,
  env: HostEnv,
  mode: "measure" | "verify" = "measure",
): Promise<{ line: string[]; exit: number }> {
  const log = new EvidenceLog()
  let measured: Measured
  let exit = 0
  try {
    const gate = routeGate(def, process.env.SPT_HW_ROUTE)
    if (!appliesHere(def, env))
      measured = {
        verdict: "UNMEASURED",
        measured: {},
        note: `awaiting ${def.host.toUpperCase()}: this host is not the row's host (${env.build})`,
      }
    else if (gate) measured = gate
    else if (def.person && !personPresent())
      measured = { verdict: "WAITING-PERSON", measured: {}, note: `${PERSON_REASON[def.person]}; no leg was launched` }
    else measured = await def.measure(env, log)
  } catch (error) {
    if (error instanceof Precondition)
      measured = { verdict: "UNMEASURED", measured: {}, note: `precondition missing: ${error.message}` }
    else if (error instanceof Unmeasurable)
      measured = { verdict: "UNMEASURED", measured: {}, note: `evidence reader failed: ${error.message}` }
    else {
      measured = {
        verdict: "ERROR",
        measured: {},
        note: String(error instanceof Error ? error.message : error).slice(0, 300),
      }
      exit = 1
    }
  }
  const line = [
    def.id,
    def.question,
    def.condition,
    HOSTS[def.host] + (def.host === "h4" ? "" : ` (macOS ${def.os})`),
    measured.verdict,
    rerun(def.id),
    env.build,
    compact(measured.measured) || "-",
    evidencePath(def.id),
    measured.note,
  ]
  const dir = join(env.ev, "task-9.sp-t")
  mkdirSync(dir, { recursive: true })
  const body = [
    `command: ${[env.bun, ...process.argv.slice(1)].join(" ")} (row ${def.id}, ${mode})`,
    `commit: ${env.commit}`,
    `host_build: ${env.build}`,
    ...log.lines,
    "## ledger line",
    line.join("\t"),
    `EXIT ${exit}`,
  ]
  writeFileSync(join(dir, evidenceFile(def.id, mode)), `${body.join("\n")}\n`)
  return { line, exit }
}

// ---------------------------------------------------------------------------------------------- cleanup

type CleanupStep = [label: string, step: () => Promise<string>]

// runs every diagnostic step, then every teardown step. A failing step is recorded as a receipt line and never stops
// the steps after it, so the results dir and the work dir are removed even when a diagnostic read fails.
async function runCleanupSteps(diagnostics: CleanupStep[], teardown: CleanupStep[]): Promise<string[]> {
  const receipts: string[] = []
  const attempt = async ([label, step]: CleanupStep) => {
    try {
      receipts.push(await step())
    } catch (error) {
      receipts.push(`${label} FAILED: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    for (const step of diagnostics) await attempt(step)
  } finally {
    for (const step of teardown) await attempt(step)
  }
  return receipts
}

async function cleanup(env: HostEnv) {
  const p = paths(env)
  const diagnostics: CleanupStep[] = []
  for (const dir of [p.generations, join(env.work, "rebuild"), join(env.work, "prompt-probe")]) {
    if (!existsSync(dir)) continue
    const apps = dir === p.generations ? readdirSync(dir).map((g) => join(dir, g, APP_NAME)) : [join(dir, APP_NAME)]
    for (const app of apps) {
      const name = `lsregister -u ${basename(join(app, "..", ".."))}/${basename(join(app, ".."))}`
      diagnostics.push([name, async () => `${name}: exit ${(await run(asQa(env, [LSREGISTER, "-u", app]))).code}`])
    }
  }
  diagnostics.push(
    [
      "tccutil reset",
      async () =>
        `tccutil reset Accessibility ${PROMPT_BUNDLE_ID}: exit ${(await run(asQa(env, ["tccutil", "reset", "Accessibility", PROMPT_BUNDLE_ID]))).code}`,
    ],
    [
      "launchctl list",
      async () => {
        const jobs = must(await run(asQa(env, ["launchctl", "list"])), "launchctl list")
        return `leftover sp-t launchd jobs: ${jobs.stdout.split("\n").filter((l) => l.includes("ai.sisyphuslabs.sp-t.")).length}`
      },
    ],
    [
      "pgrep",
      async () => {
        const procs = await run(["pgrep", "-f", "omo-computer-helper.app/Contents/MacOS/omo-computer-engine"])
        return `procs ${pgrepFound(procs) ? procs.stdout.split("\n").length : 0}`
      },
    ],
  )
  const teardown: CleanupStep[] = [
    [
      // the results directory belongs to the QA account (0700), so it is removed as that account first
      "results dir",
      async () =>
        `results dir removed as the QA account: exit ${env.sameUser ? 0 : (await run(asQa(env, ["rm", "-rf", p.results]))).code}`,
    ],
    [
      "work dir",
      async () => {
        rmSync(env.work, { recursive: true, force: true })
        return existsSync(env.work) ? `dir STILL PRESENT ${env.work}` : `dir REMOVED ${env.work}`
      },
    ],
  ]
  const receipts = await runCleanupSteps(diagnostics, teardown)
  receipts.push(
    "kept: the T3 identity and the H3 grants to the helper bundle (later rows need them; the final teardown removes them)",
  )
  return receipts
}

// ---------------------------------------------------------------------------------------------- self-test

// --self-test: the pure classification logic and the row table against fixed inputs; runs on any host, exits 1 on a
// mismatch. It is the probe's unit coverage (the row's write scope allows no separate test file).
async function selfTest(): Promise<number> {
  const report = (over: Partial<ProbeReport>): ProbeReport => ({
    marker: "m",
    pid: 500,
    ppid: 1,
    exe: `/w/generations/abc/${APP_NAME}/${EXE_REL}`,
    responsibleSymbol: true,
    responsiblePid: 500,
    responsibleExe: `/w/generations/abc/${APP_NAME}/${EXE_REL}`,
    managerName: "Aqua",
    securitySession: { status: 0, hasGraphicAccess: true, isRemote: false },
    preflight: { accessibility: 0, screenRecording: 0, inputMonitoring: 0 },
    ancestry: [],
    ...over,
  })
  const leg: LegResult = {
    hostPid: 400,
    hostExe: "/opt/bun",
    hostManager: "Aqua",
    launch: { argv: [], code: 0, stdout: "", stderr: "" },
    report: null,
    waitedMs: 0,
    startedAt: 0,
  }
  const st = (kind: "dir" | "link" | "file", uid: number, mode: number) => ({
    isSymbolicLink: () => kind === "link",
    isDirectory: () => kind === "dir",
    uid,
    mode,
  })
  const rowOf = (id: string) => ROWS.find((r) => r.id === id)
  const cases: Array<[string, unknown, unknown]> = [
    ["charged: responsible is the bundle", classifyCharged(report({}), leg), "bundle"],
    [
      "charged: responsible is the host",
      classifyCharged(report({ responsiblePid: 400, responsibleExe: "/opt/bun" }), leg),
      "host",
    ],
    [
      "charged: responsible is another app",
      classifyCharged(report({ responsiblePid: 9, responsibleExe: "/usr/sbin/sshd" }), leg),
      "other:sshd",
    ],
    ["charged: symbol missing", classifyCharged(report({ responsibleSymbol: false }), leg), "UNMEASURED"],
    ["identity.path: open re-exec", identityPath(report({ ppid: 1 })), "open_a"],
    ["identity.path: disclaimed child", identityPath(report({ ppid: 77 })), "disclaim"],
    [
      "identity.path: inherited",
      identityPath(report({ responsiblePid: 9, responsibleExe: "/x/Terminal" })),
      "inherited:Terminal",
    ],
    ["domain: Aqua with graphics", domainOf(report({})), "Aqua/graphic=1"],
    [
      "domain: Background",
      domainOf(
        report({ managerName: "Background", securitySession: { status: 0, hasGraphicAccess: false, isRemote: true } }),
      ),
      "Background/graphic=0",
    ],
    [
      "tap: all untagged",
      classifyTap([
        { type: 10, sourcePid: 0 },
        { type: 10, sourcePid: 0 },
      ]),
      "untagged",
    ],
    [
      "tap: mixed",
      classifyTap([
        { type: 10, sourcePid: 0 },
        { type: 10, sourcePid: 42 },
      ]),
      "mixed",
    ],
    ["tap: tagged", classifyTap([{ type: 10, sourcePid: 42 }]), "tagged"],
    ["prompt: process seen", promptVerdict([], true), "shown"],
    ["prompt: tccd prompting line", promptVerdict(["tccd AUTHREQ_PROMPTING msgID=1"], false), "shown"],
    ["prompt: nothing", promptVerdict(["tccd AUTHREQ_ATTRIBUTION msgID=1"], false), "none"],
    ["results dir: QA-owned 0700", resultsDirProblem(st("dir", 502, 0o40700), 502), ""],
    ["results dir: symlink refused", resultsDirProblem(st("link", 502, 0o120700), 502), "it is a symlink; refused"],
    ["results dir: 1777 refused", resultsDirProblem(st("dir", 502, 0o41777), 502), "mode 1777, not 700"],
    [
      "results dir: other owner refused",
      resultsDirProblem(st("dir", 501, 0o40700), 502),
      "owner uid 501, not the QA account",
    ],
    ["evidence: measure file", evidenceFile("a.m26", "measure"), "a.m26.txt"],
    ["evidence: verify file", evidenceFile("a.m26", "verify"), "a.m26.verify.txt"],
    ["compact: separators stripped", compact({ a: "x;y\tz", b: 1 }), "a=x y z;b=1"],
    [
      "tcc log: matching lines",
      parseTccLog({ code: 0, stdout: "a tccd x\nb other", stderr: "" }, ["tccd"]),
      { ok: true, value: ["a tccd x"] },
    ],
    [
      "tcc log: failed log show is an error, never 'no lines'",
      parseTccLog({ code: 64, stdout: "", stderr: "log: bad predicate" }, ["tccd"]),
      { ok: false, error: "log show exited 64: log: bad predicate" },
    ],
    [
      "tcc db: both databases read",
      parseTccDb({
        code: 0,
        stdout: "#db user direct\n#db system sudo\nkTCCServiceAccessibility\tai.x\t0\t2",
        stderr: "",
      }),
      { ok: true, value: [{ service: "kTCCServiceAccessibility", client: "ai.x", clientType: "0", authValue: "2" }] },
    ],
    [
      "tcc db: failed helper with empty stdout is an error, never 'no grant'",
      parseTccDb({ code: 2, stdout: "", stderr: "sp-t-tccdb: missing precondition" }),
      { ok: false, error: "sp-t-tccdb.sh exited 2: sp-t-tccdb: missing precondition" },
    ],
    [
      "tcc db: system database unreadable is an error (Accessibility lives there)",
      parseTccDb({ code: 3, stdout: "#db user direct\n#db system UNREADABLE authorization denied", stderr: "" }),
      { ok: false, error: "sp-t-tccdb.sh exited 3: #db system UNREADABLE authorization denied" },
    ],
    [
      "tcc db: a database header missing is an error",
      parseTccDb({ code: 0, stdout: "#db user direct", stderr: "" }),
      { ok: false, error: "TCC.db read-back is missing the system database header" },
    ],
    [
      "must: a failed command throws with its exit code",
      (() => {
        try {
          return must({ code: 4, stdout: "", stderr: "boom\nmore" }, "lsregister -f").code
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })(),
      "lsregister -f exited 4: boom",
    ],
    ["pgrep: match", pgrepFound({ code: 0, stdout: "12", stderr: "" }), true],
    ["pgrep: no match", pgrepFound({ code: 1, stdout: "", stderr: "" }), false],
    [
      "pgrep: an error is thrown, never 'not running'",
      (() => {
        try {
          return pgrepFound({ code: 3, stdout: "", stderr: "pgrep: fatal" })
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })(),
      "pgrep exited 3: pgrep: fatal",
    ],
  ]
  const vhid = rowOf("untagged.vhid")
  const vkbd = rowOf("untagged.hypervisor-vkbd")
  cases.push(
    [
      "route gate: vhid without route",
      vhid ? routeGate(vhid, undefined)?.note : "missing row",
      "awaiting H4: set SPT_HW_ROUTE=vhid on a host where that route exists",
    ],
    ["route gate: vkbd without route", vkbd ? routeGate(vkbd, "vhid")?.verdict : "missing row", "UNMEASURED"],
    ["route gate: route present", vhid ? routeGate(vhid, "vhid") : "missing row", null],
    ["rows: untagged rows are person-gated", [vhid?.person, vkbd?.person].join(","), "tap,tap"],
    ["rows: ids are unique", new Set(ROWS.map((r) => r.id)).size, ROWS.length],
    [
      "rows: every prompt row names the prompt-probe bundle",
      ROWS.filter((r) => r.id.startsWith("prompt.")).every((r) => r.condition.includes("prompt-probe")),
      true,
    ],
  )
  const legWith = (report: ProbeReport | null, code: number): LegResult => ({
    ...leg,
    report,
    launch: { ...leg.launch, code },
  })
  const verdictOf = (m: Measured | null) => (m ? m.verdict : "granted")
  const order: string[] = []
  const cleanupReceipts = await runCleanupSteps(
    [
      ["diag ok", async () => (order.push("diag ok"), "diag ok")],
      [
        "launchctl list",
        async () => {
          order.push("diag fails")
          throw new Error("launchctl list exited 5: boom")
        },
      ],
    ],
    [["results dir", async () => (order.push("teardown"), "results dir removed")]],
  ).catch((error: unknown) => [`threw: ${error instanceof Error ? error.message : String(error)}`])
  cases.push(
    ["tap: unreadable file after a failed launch is NO_LAUNCH", tapOutcome(null, 1).verdict, "NO_LAUNCH"],
    ["tap: unreadable file after a launch is UNMEASURED, never NO_EVENT", tapOutcome(null, 0).verdict, "UNMEASURED"],
    [
      "tap: file read with no keyDown is NO_EVENT",
      tapOutcome('{"tapReady":true}\n{"tapDone":true}', 0).verdict,
      "NO_EVENT",
    ],
    [
      "tap: tap creation failed is UNMEASURED",
      tapOutcome('{"error":"tap_create_failed"}\n{"tapDone":true}', 0).verdict,
      "UNMEASURED",
    ],
    ["tap: untagged keyDowns", tapOutcome('{"type":10,"sourcePid":0}\n{"tapDone":true}', 0).verdict, "ROUTE=untagged"],
    [
      "grant: report with Accessibility",
      verdictOf(
        grantGate(legWith(report({ preflight: { accessibility: 1, screenRecording: 0, inputMonitoring: 0 } }), 0)),
      ),
      "granted",
    ],
    [
      "grant: report without Accessibility is WAITING-PERSON",
      verdictOf(grantGate(legWith(report({}), 0))),
      "WAITING-PERSON",
    ],
    [
      "grant: no report after a failed launch is NO_LAUNCH, never not-granted",
      verdictOf(grantGate(legWith(null, 1))),
      "NO_LAUNCH",
    ],
    [
      "grant: no report after a timeout is NO_LAUNCH, never not-granted",
      verdictOf(grantGate(legWith(null, 0))),
      "NO_LAUNCH",
    ],
    [
      "cleanup: a failed diagnostic is a receipt and teardown still runs",
      cleanupReceipts,
      ["diag ok", "launchctl list FAILED: launchctl list exited 5: boom", "results dir removed"],
    ],
    ["cleanup: steps ran in order, teardown last", order, ["diag ok", "diag fails", "teardown"]],
  )
  let failed = 0
  for (const [name, got, want] of cases) {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed++
    console.log(
      `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
    )
  }
  console.log(failed === 0 ? `SELF_TEST_OK ${cases.length}` : `SELF_TEST_FAILED ${failed}/${cases.length}`)
  return failed === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------------------------- main

async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => argv.includes(name)
  const value = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }

  if (flag("--leg")) return leg(value("--leg") ?? "")
  if (flag("--self-test")) return await selfTest()
  if (flag("--print-skeleton")) {
    process.stdout.write(ledgerText(ROWS.map(skeletonLine)))
    return 0
  }
  const verifyPath = value("--verify")
  if (verifyPath && !existsSync(verifyPath)) {
    console.error(`SP-T precondition missing: the ledger ${verifyPath}`)
    return 2
  }

  let env: HostEnv
  try {
    env = await hostEnv()
  } catch (error) {
    if (error instanceof Precondition) {
      console.error(`SP-T precondition missing: ${error.message}`)
      return 2
    }
    throw error
  }
  if (flag("--cleanup")) {
    for (const receipt of await cleanup(env)) console.log(receipt)
    return 0
  }
  await setup(env)

  if (flag("--setup")) {
    console.log(`setup done: current=${currentApp(env)}`)
    return 0
  }
  if (flag("--request-grant") && !personPresent()) {
    console.error(`SP-T WAITING-PERSON: ${PERSON_REASON.grant}`)
    return 2
  }
  if (flag("--request-grant") || flag("--check-grant")) {
    const log = new EvidenceLog()
    const result = await runLeg(env, log, "gui", "open-path", currentApp(env), flag("--request-grant") ? "all" : "")
    console.log(
      JSON.stringify({
        preflight: result.report?.preflight ?? null,
        responsibleIsSelf: result.report ? result.report.responsiblePid === result.report.pid : null,
      }),
    )
    return result.report ? 0 : 1
  }
  const rowId = value("--row")
  if (rowId) {
    const def = ROWS.find((r) => r.id === rowId)
    if (!def) {
      console.error(`unknown row ${rowId}`)
      return 2
    }
    const { line, exit } = await measureRow(def, env)
    console.log(line.join("\t"))
    return exit
  }
  if (flag("--measure")) {
    const out = value("--out") ?? join(PROBE_DIR, "macos-tcc.tsv")
    const existing = existsSync(out) ? parseLedger(readFileSync(out, "utf8")) : new Map<string, string[]>()
    let exit = 0
    for (const def of ROWS) {
      if (!appliesHere(def, env)) continue
      const { line, exit: rowExit } = await measureRow(def, env)
      existing.set(def.id, line)
      exit ||= rowExit
      console.log(`${def.id}\t${line[4]}`)
    }
    writeFileSync(out, ledgerText(ROWS.map((def) => existing.get(def.id) ?? skeletonLine(def))))
    return exit
  }
  if (verifyPath) {
    const ledger = parseLedger(readFileSync(verifyPath, "utf8"))
    let mismatches = 0
    for (const def of ROWS) {
      const recorded = ledger.get(def.id)
      if (!recorded) {
        console.log(`MISSING ${def.id}`)
        mismatches++
        continue
      }
      if (!appliesHere(def, env)) {
        console.log(`SKIP ${def.id} (${recorded[3]}; this host is ${env.build})`)
        continue
      }
      const { line } = await measureRow(def, env, "verify")
      const same = line[4] === recorded[4]
      if (!same) mismatches++
      console.log(`${same ? "SAME" : "DIFF"} ${def.id} recorded=${recorded[4]} measured=${line[4]}`)
    }
    console.log(mismatches === 0 ? "VERIFY_OK" : `VERIFY_FAILED mismatches=${mismatches}`)
    return mismatches === 0 ? 0 : 1
  }
  console.error(
    "usage: probe-sp-t.ts --self-test | --print-skeleton | --setup | --request-grant | --check-grant | --row <id> | --measure --out <ledger> | --verify <ledger> | --cleanup",
  )
  return 2
}

process.exit(await main(process.argv.slice(2)))
