// Probe: can a GitHub-hosted macOS runner carry live accessibility, input and capture legs?
//
//   bun script/qa/computer/probes/hosted-macos-live.ts [--question qN] [--out <dir>]   (GitHub-hosted macOS only)
//   bun script/qa/computer/probes/hosted-macos-live.ts --merge <ledger.tsv> <fragment.tsv>...
//   bun script/qa/computer/probes/hosted-macos-live.ts --decide <ledger.tsv>

import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { askGrantRoute } from "./hosted-macos-live-grant.ts"
import {
  countProbeRows,
  deleteProbeRows,
  grantedRows,
  pidOf,
  run,
  SYSTEM_TCC_DB,
  until,
} from "./hosted-macos-live-host.ts"
import {
  decideHostedMacosLive,
  formatRow,
  LEDGER_HEADER,
  type LedgerRow,
  mergeLedgers,
  parseLedger,
  QUESTIONS,
  type Question,
  rerunCommand,
  unsupportedHostReason,
} from "./hosted-macos-live-ledger.ts"
import {
  type Answer,
  askAxTree,
  askCapture,
  askPidClick,
  askSyntheticUser,
  askTap,
  askTrusted,
  directInvoke,
  type Fixture,
  type Probe,
} from "./hosted-macos-live-questions.ts"

const SWIFT_DIR = join(import.meta.dir, "hosted-macos-live")
const SOURCES = readdirSync(SWIFT_DIR)
  .filter((name) => name.endsWith(".swift"))
  .map((name) => join(SWIFT_DIR, name))
const FRAMEWORKS = ["AppKit", "ApplicationServices", "ScreenCaptureKit"].flatMap((name) => ["-framework", name])

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function build(output: string, identifier: string): void {
  mkdirSync(dirname(output), { recursive: true })
  const compiled = run("/usr/bin/xcrun", ["swiftc", "-O", "-o", output, ...SOURCES, ...FRAMEWORKS], 600_000)
  if (compiled.code !== 0) throw new Error(`swiftc failed for ${output}:\n${compiled.stderr}`)
  const signed = run("/usr/bin/codesign", ["-f", "-s", "-", "-i", identifier, output])
  if (signed.code !== 0) throw new Error(`ad-hoc codesign failed for ${output}: ${signed.stderr}`)
}

function recordFacts(out: string): void {
  const home = process.env.HOME ?? ""
  const lines = [
    `sw_vers: ${run("/usr/bin/sw_vers", []).stdout.replace(/\s+/g, " ")}`,
    `csrutil: ${run("/usr/bin/csrutil", ["status"]).stdout}`,
    `runner user: ${run("/usr/bin/id", ["-un"]).stdout}`,
    `system TCC granted rows (${SYSTEM_TCC_DB}):`,
    grantedRows(SYSTEM_TCC_DB, true).stdout,
    "user TCC granted rows:",
    grantedRows(join(home, "Library/Application Support/com.apple.TCC/TCC.db"), false).stdout || "(none or unreadable)",
  ]
  const text = `${lines.join("\n")}\n`
  writeFileSync(join(out, "facts.txt"), text)
  process.stdout.write(text)
}

async function startFixture(binary: string, scratch: string): Promise<{ fixture: Fixture; kill: () => void }> {
  const stateFile = join(scratch, "fixture.state")
  const readyFile = join(scratch, "fixture.ready")
  const child = Bun.spawn([binary, "fixture", stateFile, readyFile], { stdout: "ignore", stderr: "ignore" })
  const ready = await until(
    () => run("/bin/cat", [readyFile]).stdout,
    (text) => text !== "",
    15_000,
  )
  if (ready === "") throw new Error("the fixture app wrote no ready file within 15 s")
  const parsed: unknown = JSON.parse(ready)
  const field = (key: string) => Number(typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, key) : NaN)
  const fixture = { pid: field("pid"), windowNumber: field("windowNumber"), x: field("x"), y: field("y"), stateFile }
  return { fixture, kill: () => child.kill() }
}

async function openTextEdit(scratch: string): Promise<number | null> {
  const document = join(scratch, "probe-note.txt")
  writeFileSync(document, "hosted macOS live probe\n")
  run("/usr/bin/open", ["-g", "-F", "-a", "TextEdit", document, "--args", "-ApplePersistenceIgnoreState", "YES"])
  return until(
    () => pidOf("TextEdit"),
    (pid) => pid !== null,
    15_000,
  )
}

async function answers(
  only: Question | undefined,
  probe: Probe,
  binary: string,
  subject: string,
): Promise<Map<Question, Answer>> {
  const wanted = (question: Question) => only === undefined || only === question
  const result = new Map<Question, Answer>()
  if (wanted("q1")) result.set("q1", askTrusted(probe))
  if (wanted("q2")) result.set("q2", await askAxTree(probe))
  if (wanted("q3")) result.set("q3", await askPidClick(probe))
  if (wanted("q4")) result.set("q4", askCapture(probe))
  if (wanted("q5")) result.set("q5", askTap(probe))
  if (wanted("q8")) result.set("q8", await askSyntheticUser(binary, probe))
  if (wanted("q6") || wanted("q7")) {
    const grant = await askGrantRoute(probe, binary, subject)
    if (wanted("q6")) result.set("q6", grant.q6)
    if (wanted("q7")) result.set("q7", grant.q7)
  }
  return result
}

function teardown(scratch: string, subject: string, killFixture: (() => void) | undefined): void {
  killFixture?.()
  run("/usr/bin/osascript", ["-e", 'tell application "TextEdit" to quit saving no'])
  deleteProbeRows(subject)
  const rows = countProbeRows(subject)
  const procs = run("/usr/bin/pgrep", ["-f", scratch])
    .stdout.split("\n")
    .filter((line) => line !== "").length
  rmSync(scratch, { recursive: true, force: true })
  console.log(`teardown: procs ${procs}; probe tcc rows ${rows}; dir REMOVED ${scratch}`)
}

async function probeRunner(args: readonly string[], image: string): Promise<number> {
  const asked = argValue(args, "--question")
  const only = QUESTIONS.find((question) => question === asked)
  if (asked !== undefined && only === undefined) throw new Error(`unknown question ${asked}`)
  const out = argValue(args, "--out") ?? join(process.env.RUNNER_TEMP ?? tmpdir(), "hosted-macos-live")
  mkdirSync(out, { recursive: true })
  const scratch = realpathSync(mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "omo-hosted-macos-live-")))
  const binary = join(scratch, "bin", "omo-probe")
  const subject = join(scratch, "subject", "omo-probe-subject")
  let killFixture: (() => void) | undefined
  try {
    recordFacts(out)
    build(binary, "dev.omo.computer.probe")
    build(subject, "dev.omo.computer.probe-subject")
    const started = await startFixture(binary, scratch)
    killFixture = started.kill
    const textEditPid = await openTextEdit(scratch)
    const invoke = directInvoke(binary)
    const probe: Probe = { invoke, control: invoke, fixture: started.fixture, textEditPid, scratch, settleMs: 5_000 }
    const results = await answers(only, probe, binary, subject)
    const symbols = `${JSON.stringify(invoke(["symbols"]))}\n`
    writeFileSync(join(out, `cuv3-symbols.${image}.json`), symbols)
    process.stdout.write(`private symbol resolve (runner shell, public controls included): ${symbols}`)
    const link = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`
    const rows: LedgerRow[] = [...results].map(([question, result]) => ({
      question,
      image,
      verdict: result.verdict,
      evidence: `${result.evidence} | run ${link}`,
      rerun: rerunCommand(question, image),
    }))
    const fragment = `${[LEDGER_HEADER, ...rows.map(formatRow)].join("\n")}\n`
    writeFileSync(join(out, `hosted-macos-live.${image}.tsv`), fragment)
    process.stdout.write(fragment)
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (summary !== undefined) {
      const table = rows.map((row) => `| ${row.question} | ${row.image} | ${row.verdict} |`).join("\n")
      appendFileSync(
        summary,
        `### Hosted macOS live probe (${image})\n\n| question | image | verdict |\n| --- | --- | --- |\n${table}\n`,
      )
    }
    return 0
  } finally {
    teardown(scratch, subject, killFixture)
  }
}

async function main(args: readonly string[]): Promise<number> {
  const merge = argValue(args, "--merge")
  if (merge !== undefined) {
    const fragments = args.slice(args.indexOf("--merge") + 2).map((path) => readFileSync(path, "utf8"))
    writeFileSync(merge, mergeLedgers(fragments))
    console.log(`merged ${fragments.length} fragments into ${merge}`)
    return 0
  }
  const decide = argValue(args, "--decide")
  if (decide !== undefined) {
    const decision = decideHostedMacosLive(parseLedger(readFileSync(decide, "utf8")))
    console.log(`HOSTED_MACOS_LIVE=${decision}`)
    return decision === "unmeasured" ? 1 : 0
  }
  const image = process.env.PROBE_IMAGE
  const reason = unsupportedHostReason({
    platform: process.platform,
    githubActions: process.env.GITHUB_ACTIONS,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    image,
  })
  if (reason !== null || image === undefined) {
    console.error(
      `hosted-macos-live: unsupported host (${reason}); this probe runs only on a GitHub-hosted macOS runner and wrote no ledger row`,
    )
    return 2
  }
  return probeRunner(args, image)
}

process.exitCode = await main(process.argv.slice(2))
