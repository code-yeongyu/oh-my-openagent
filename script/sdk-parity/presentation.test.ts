import { describe, expect, test } from "bun:test"

import { candidateDigest, gateReport, renderReport } from "./gate"
import { HEAD, input, text } from "./gate-fixture"
import type { PresentationRow } from "./presentation"
import type { Outcome } from "./scenario-run"
import { SCENARIOS } from "./scenarios"

// Controls of the presentation attribution, built from the real case: train 12 changes one usage line of omo remote,
// `send <session> <text>` to `send <session> <text|->`, with exit codes 0/2/2 unchanged. Base outcomes are the committed
// goldens of the three remote scenarios; both capabilities are unresolved, so without the attribution each delta fails.

const IDS = ["native-remote-help", "native-remote-unknown", "native-remote-open-no-device"]
const scenarios = SCENARIOS.filter((scenario) => IDS.includes(scenario.id))
const committed = JSON.parse(text("script/sdk-parity/goldens.json")) as Record<string, Outcome>
const base = Object.fromEntries(IDS.map((id) => [id, committed[id] ?? {}]))
const BEFORE = "  send <session> <text> [--steer|--follow-up] [--no-wait]"
const AFTER = "  send <session> <text|-> [--steer|--follow-up] [--no-wait]"

type Edit = (outcome: Outcome) => Outcome
const onStreams =
  (change: (stream: string) => string): Edit =>
  (outcome) => ({ ...outcome, stdout: change(String(outcome["stdout"])), stderr: change(String(outcome["stderr"])) })
const train12 = onStreams((stream) => stream.replace(`${BEFORE}\n`, `${AFTER}\n`))
const headWith = (edit: Edit) => Object.fromEntries(IDS.map((id) => [id, edit(base[id] ?? {})]))

const ROW: PresentationRow = {
  verb: "remote send",
  scenarios: IDS,
  changes: [{ before: BEFORE, after: AFTER }],
  reason: "the text argument also takes - to read the message from stdin; same verb, same exit codes",
}

const run = (edit: Edit, rows: readonly PresentationRow[] = [ROW], goldens = headWith(edit)) =>
  gateReport(
    input({
      scenarios,
      base: { ...input().base, outcomes: base },
      head: { ...input().head, outcomes: headWith(edit) },
      presentation: rows,
      goldens: { base, head: goldens },
    }),
  )

describe("presentation attribution (positive control: train 12's usage line)", () => {
  test("#given the real usage-only delta, the row and updated goldens #then all three scenarios pass as presentation-only and the reviewer's digest covers them", () => {
    expect(train12(base["native-remote-help"] ?? {})).not.toEqual(base["native-remote-help"])
    const report = run(train12)
    expect(report.failures).toEqual([])
    expect(report.presentation).toEqual(IDS.toSorted())
    expect(report.digest).toBe(
      candidateDigest(
        HEAD,
        IDS.map((id) => `${id}#presentation`),
      ),
    )
    expect(renderReport(report)).toContain("PRESENTATION ONLY: native-remote-help, native-remote-open-no-device")
  })

  test("#given the same delta with no registry row #then every scenario fails as a capability change", () => {
    const report = run(train12, [])
    expect(report.failures).toHaveLength(3)
    for (const failure of report.failures)
      expect(failure).toContain("no row of script/sdk-parity/presentation.json names scenario")
    expect(report.presentation).toEqual([])
  })
})

describe("presentation attribution (negative controls: a capability change dressed as wording fails even with the row)", () => {
  const failsAll = (
    edit: Edit,
    reason: string,
    rows: readonly PresentationRow[] = [ROW],
    goldens?: Record<string, Outcome>,
  ) => {
    const report = run(edit, rows, goldens)
    expect(report.presentation).toEqual([])
    expect(report.failures).toHaveLength(3)
    for (const failure of report.failures) expect(failure).toContain(reason)
  }

  test("#given a changed exit code #then it fails", () => {
    failsAll((outcome) => ({ ...train12(outcome), exit: Number(outcome["exit"]) + 1 }), "the exit code changed")
  })

  test("#given a changed line outside the usage block #then it fails", () => {
    const report = run((outcome) =>
      train12({ ...outcome, stderr: String(outcome["stderr"]).replace("omo remote", "omo  remote") }),
    )
    expect(report.failures).toContainEqual(expect.stringContaining("native-remote-unknown answers differently"))
    expect(report.failures.join("\n")).toContain("a line outside the usage block of omo remote changed")
  })

  test("#given the usage block moved to the other stream #then the structure differs and it fails", () => {
    const swap: Edit = (outcome) => {
      const changed = train12(outcome)
      return { ...changed, stdout: changed["stderr"], stderr: changed["stdout"] }
    }
    const report = run(swap)
    expect(report.presentation).toEqual([])
    expect(report.failures).toHaveLength(3)
  })

  test("#given a new verb added to the usage block, named by its own row #then the block's verbs changed and it fails", () => {
    const NEW = "  teleport <session>                      move a session"
    const added = onStreams((stream) => stream.replace(`${BEFORE}\n`, `${BEFORE}\n${NEW}\n`))
    const row: PresentationRow = { ...ROW, verb: "remote teleport", changes: [{ before: BEFORE, after: NEW }] }
    failsAll(added, "the usage block of omo remote changed its verbs or their layout", [ROW, row])
  })

  test("#given a usage delta without the goldens update #then it fails", () => {
    failsAll(train12, "goldens.json does not carry the head's new outcome", [ROW], base)
  })

  test("#given a row whose before/after is not the delta #then it fails", () => {
    failsAll(train12, "changed with no row naming that verb and this before/after", [
      { ...ROW, changes: [{ before: BEFORE, after: `${AFTER} [--json]` }] },
    ])
  })

  test("#given a row naming another verb #then it fails", () => {
    failsAll(train12, "changed with no row naming that verb", [{ ...ROW, verb: "remote close" }])
  })

  test("#given a row with no reason #then it fails", () => {
    failsAll(train12, "gives no reason", [{ ...ROW, reason: " " }])
  })

  test("#given a scenario that declares no usage block #then a row cannot pass it", () => {
    const report = gateReport(
      input({
        head: { ...input().head, outcomes: { s1: { exit: 2, stdout: "", stderr: "x" } } },
        base: { ...input().base, outcomes: { s1: { exit: 2, stdout: "", stderr: "y" } } },
        presentation: [{ ...ROW, scenarios: ["s1"] }],
      }),
    )
    expect(report.failures).toEqual([
      "threads.send: scenario s1 answers differently on the merge base and the head; this pull request changes what it does without the SDK call threads.send",
    ])
  })
})
