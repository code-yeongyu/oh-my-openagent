// Pass B of the hosted macOS baseline (measurement branch only; it uses the hosted-macOS probe's helpers from #13227).
// The release runs in-process and spawns its engine as a child, so TCC judges the driver host, bun. On a hosted runner
// every step's responsible process is the runner's agent, which already holds the grants, so a plain run is trusted by
// the agent's rows. Here bun is launched disclaimed (its own responsible process), shown DENIED first, granted by its
// real path bound to its designated requirement, shown TRUSTED, measured, and the rows are removed and counted to 0.
//
// Usage: bun legacy-macos-grant.ts --helper <probe helper> --out <dir> -- <run.ts arguments>
//        bun legacy-macos-grant.ts --probe --helper <probe helper>   (internal: run disclaimed, prints its own trust)

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  countProbeRows,
  deleteProbeRows,
  designatedRequirementHex,
  insertProbeRows,
} from "../../probes/hosted-macos-live-host.ts"

type Trust = {
  readonly bunPid: number
  readonly responsiblePid: number
  readonly axTrusted: boolean
  readonly raw: string
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function output(command: readonly string[]): Promise<{ code: number; text: string }> {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, text: (out + err).trim() }
}

// Runs inside the disclaimed bun: the helper is its child, so the helper's responsible process is this bun.
async function probe(helper: string): Promise<never> {
  const read = await output([helper, "trusted"])
  console.log(`GRANT_PROBE ${JSON.stringify({ bunPid: process.pid, code: read.code, trusted: read.text })}`)
  process.exit(0)
}

async function trustOfDisclaimedBun(helper: string, bun: string, self: string): Promise<Trust> {
  const ran = await output([helper, "disclaim", bun, self, "--probe", "--helper", helper])
  const line = ran.text.split("\n").find((entry) => entry.startsWith("GRANT_PROBE "))
  if (line === undefined) throw new Error(`the disclaimed probe printed no reading (exit ${ran.code}): ${ran.text}`)
  const parsed = JSON.parse(line.slice("GRANT_PROBE ".length)) as { bunPid: number; trusted: string }
  const trusted = JSON.parse(parsed.trusted) as { responsiblePid: number; axTrusted: boolean }
  return {
    bunPid: parsed.bunPid,
    responsiblePid: trusted.responsiblePid,
    axTrusted: trusted.axTrusted,
    raw: parsed.trusted,
  }
}

// The release's own permission report (its smoke line: capturePermission, inputPermission, axPermission), verbatim.
async function releaseReport(helper: string, bun: string, driver: string): Promise<string> {
  const ran = await output([helper, "disclaim", bun, driver, "--smoke"])
  return ran.text.split("\n").find((line) => line.startsWith("LEGACY_SMOKE ")) ?? `no smoke line (exit ${ran.code})`
}

async function main(): Promise<number> {
  const helper = flag("--helper")
  const out = flag("--out")
  const separator = args.indexOf("--")
  if (helper === undefined || out === undefined || separator < 0)
    throw new Error("usage: --helper <bin> --out <dir> -- <run.ts args>")
  const runArgs = args.slice(separator + 1)
  mkdirSync(out, { recursive: true })
  const bun = realpathSync(process.execPath)
  const self = realpathSync(import.meta.path)
  const driver = join(import.meta.dir, "legacy.ts")
  const record: Record<string, unknown> = {
    bun,
    grantedServices: "all four probe services (Accessibility, PostEvent, ListenEvent, ScreenCapture)",
  }
  const say = (line: string): void => console.log(`LEGACY_GRANT ${line}`)
  const save = (): void => writeFileSync(join(out, "grant.json"), `${JSON.stringify(record, null, 2)}\n`)

  const before = await trustOfDisclaimedBun(helper, bun, self)
  record.before = before
  say(`before bunPid=${before.bunPid} responsiblePid=${before.responsiblePid} axTrusted=${before.axTrusted}`)
  record.releaseBefore = await releaseReport(helper, bun, driver)
  say(`release before ${String(record.releaseBefore)}`)
  const disclaimed = before.responsiblePid === before.bunPid
  record.disclaimed = disclaimed
  if (!disclaimed || before.axTrusted) {
    record.verdict = disclaimed
      ? "already trusted before any grant: not a valid denied baseline"
      : "the disclaim did not take: bun is not its own responsible process"
    say(`STOP ${String(record.verdict)}`)
    save()
    return 2
  }

  const requirement = designatedRequirementHex(bun, mkdtempSync(join(tmpdir(), "legacy-grant-")))
  record.designatedRequirement = requirement === null ? "none (granted by path only)" : "compiled"
  const inserted = insertProbeRows(bun, requirement)
  record.insert = { code: inserted.code, stderr: inserted.stderr.slice(0, 300) }
  say(`insert code=${inserted.code} requirement=${record.designatedRequirement}`)
  try {
    const after = await trustOfDisclaimedBun(helper, bun, self)
    record.after = after
    say(`after bunPid=${after.bunPid} responsiblePid=${after.responsiblePid} axTrusted=${after.axTrusted}`)
    record.releaseAfter = await releaseReport(helper, bun, driver)
    say(`release after ${String(record.releaseAfter)}`)
    if (!after.axTrusted) {
      record.verdict = "the grant did not take on this binary"
      say(`STOP ${String(record.verdict)}`)
      return 3
    }
    const measured = await output([helper, "disclaim", bun, ...runArgs])
    record.measurement = { code: measured.code }
    writeFileSync(join(out, "pass-b.log"), `${measured.text}\n`)
    say(`measurement exit=${measured.code}`)
    record.verdict = "granted and measured"
    return measured.code === 0 ? 0 : 1
  } finally {
    const removed = deleteProbeRows(bun)
    const left = countProbeRows(bun)
    record.cleanup = { deleteCode: removed.code, rowsLeft: left }
    say(`cleanup delete=${removed.code} rowsLeft=${left}`)
    save()
  }
}

if (args.includes("--probe")) {
  const helper = flag("--helper")
  if (helper === undefined) throw new Error("--probe needs --helper")
  await probe(helper)
}
process.exit(await main())
