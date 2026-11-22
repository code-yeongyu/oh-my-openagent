// Linux live tier, xorg-uinput leg: can this runner carry real Xorg with the dummy video driver, libinput and a
// writable /dev/uinput, with a virtual keyboard whose raw XI2 events reach the server? The answer is a graded ledger
// (CONFIRMS, CONTRADICTS, UNMEASURED, FLAKY across --runs), and the probe exits 0 only when every row CONFIRMS and
// every run tore down. It loads a kernel module, adds an input device and starts Xorg, so it refuses to run anywhere
// but a GitHub-hosted runner.
//
//   bun script/qa/computer/pool/xorg-uinput-probe.ts [--runs <n>] [--ledger <file.tsv>] [--workdir <dir>]
//   bun script/qa/computer/pool/xorg-uinput-probe.ts --teardown-check   (read-only: the job's teardown receipts)

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  combine,
  type LedgerRow,
  ledgerTsv,
  QUESTIONS,
  type QuestionId,
  type Reading,
  summaryLines,
} from "./xorg-uinput-ledger.ts"
import { collectTeardownFacts, judgeTeardown } from "./teardown-check.ts"
import { run } from "./xorg-session.ts"
import { measureOnce } from "./xorg-uinput-run.ts"

type Args = { readonly runs: number; readonly ledger: string | null; readonly workdir: string | null }

function parseArgs(argv: readonly string[]): Args {
  let runs = 3
  let ledger: string | null = null
  let workdir: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    i += 1
    if (flag === "--runs") runs = Number(value)
    else if (flag === "--ledger") ledger = value
    else if (flag === "--workdir") workdir = value
    else throw new Error(`unknown argument ${flag}`)
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
  return { runs, ledger, workdir }
}

async function hostBuild(): Promise<string> {
  const kernel = (await run(["uname", "-r"])).out.trim()
  const xorg = await run(["Xorg", "-version"])
  const xorgVersion = /X\.Org X Server ([\d.]+)/.exec(xorg.out + xorg.err)?.[1] ?? "unknown"
  const pkgs = await run([
    "dpkg-query",
    "-W",
    "-f",
    "${Package}=${Version} ",
    "xserver-xorg-video-dummy",
    "xserver-xorg-input-libinput",
  ])
  const image = `${process.env.ImageOS ?? "unknown"}/${process.env.ImageVersion ?? "unknown"}`
  return `${new Date().toISOString().slice(0, 10)} kernel=${kernel} xorg=${xorgVersion} ${pkgs.out.trim()} runner-image=${image}`
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === "--teardown-check") {
    const { lines, ok } = judgeTeardown(await collectTeardownFacts())
    for (const line of lines) console.log(line)
    return ok ? 0 : 1
  }
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (error) {
    console.error(`usage error: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  if (
    process.platform !== "linux" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    console.error(
      "refused: this probe loads a kernel module, adds an input device and starts Xorg; it runs only on a GitHub-hosted runner",
    )
    return 2
  }
  const workdir = mkdtempSync(join(args.workdir ?? tmpdir(), "omo-xorg-uinput-"))
  const perQuestion = new Map<QuestionId, Reading[]>(QUESTIONS.map((q) => [q.id, []]))
  let teardownOk = true
  try {
    for (let i = 0; i < args.runs; i++) {
      const result = await measureOnce(workdir, i)
      for (const q of QUESTIONS) {
        perQuestion.get(q.id)?.push(result.readings.get(q.id) ?? { verdict: "UNMEASURED", observed: "not reached" })
      }
      for (const line of result.receipts) console.log(`run ${i + 1}: ${line}`)
      teardownOk &&= !result.receipts.some((l) =>
        / LEFT | UNREAD |DESTROY-FAILED|TEARDOWN incomplete|^procs [1-9]/.test(l),
      )
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true })
    const gone = !existsSync(workdir)
    console.log(gone ? `dir REMOVED ${workdir}` : `dir LEFT ${workdir}`)
    teardownOk &&= gone
  }
  const build = await hostBuild()
  const rerun = `bun script/qa/computer/pool/xorg-uinput-probe.ts --runs ${args.runs}`
  const rows: LedgerRow[] = QUESTIONS.map((q) => {
    const readings = perQuestion.get(q.id) ?? []
    const { verdict, agree } = combine(readings)
    const observed = [...new Set(readings.map((r) => r.observed))].join(" || ")
    return { ...q, verdict, runs: agree, rerun, observed, hostBuild: build }
  })
  const tsv = ledgerTsv(rows)
  if (args.ledger) writeFileSync(args.ledger, tsv)
  process.stdout.write(tsv)
  for (const line of summaryLines(rows)) console.log(line)
  if (!teardownOk) console.log("TEARDOWN incomplete: see the LEFT receipts above")
  return rows.every((r) => r.verdict === "CONFIRMS") && teardownOk ? 0 : 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
