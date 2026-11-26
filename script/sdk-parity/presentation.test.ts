import { describe, expect, test } from "bun:test"

import { candidateDigest, gateReport, renderReport } from "./gate"
import { HEAD, input } from "./gate-fixture"
import type { PresentationRow } from "./presentation"
import { AFTER, base, BEFORE, type Edit, IDS, onStreams, ROW, run, train12 } from "./presentation-fixture"
import type { Outcome } from "./scenario-run"

// Security contract of the changed-capability gate (design 7.4): a presentation-only pass is the one way an outcome
// difference under an unresolved capability merges without its SDK call, so each refusal below has its own control.

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

describe("presentation attribution (positive control: train 12's usage line)", () => {
  test("#given the real usage-only delta, the row and updated goldens #then all three scenarios pass as presentation-only and the reviewer's digest covers them", () => {
    expect(train12(base["native-remote-help"] ?? {})).not.toEqual(base["native-remote-help"])
    const report = run(train12)
    expect(report.failures).toEqual([])
    expect(report.presentation).toEqual(IDS.toSorted())
    expect(report.digest).toBe(
      candidateDigest(
        HEAD,
        IDS.map((id) => `${id}#presentation=remote send`),
      ),
    )
    expect(renderReport(report)).toContain(
      "PRESENTATION ONLY: native-remote-help (row remote send), native-remote-open-no-device (row remote send), native-remote-unknown (row remote send)",
    )
  })

  test("#given the same delta with no registry row #then every scenario fails as a capability change", () => {
    failsAll(train12, "no row of script/sdk-parity/presentation.json names scenario", [])
  })
})

describe("presentation attribution: the outcome's shape must be unchanged", () => {
  test("#given a field added to the outcome with identical usage text #then it fails", () => {
    failsAll((outcome) => ({ ...train12(outcome), signal: "SIGTERM" }), "is not an exit code with its two streams")
  })

  test("#given a field removed from the outcome #then it fails", () => {
    failsAll((outcome) => {
      const { stderr: _dropped, ...rest } = train12(outcome)
      return rest
    }, "is not an exit code with its two streams")
  })

  test("#given the exit code retyped to text with the same digits #then it fails", () => {
    failsAll(
      (outcome) => ({ ...train12(outcome), exit: `${outcome["exit"]}` }),
      "are not a numeric exit code and two text streams",
    )
  })

  test("#given a changed exit code #then it fails", () => {
    failsAll((outcome) => ({ ...train12(outcome), exit: Number(outcome["exit"]) + 1 }), "the exit code changed")
  })

  test("#given the usage block moved to the other stream #then the structure differs and it fails", () => {
    const report = run((outcome) => {
      const changed = train12(outcome)
      return { ...changed, stdout: changed["stderr"], stderr: changed["stdout"] }
    })
    expect(report.presentation).toEqual([])
    expect(report.failures).toHaveLength(3)
  })
})

// Layout outside the declared block is not normalised: lines are compared byte for byte, so white space, order and
// wrapping there are changes like any other. Inside the block the verbs and their entry/continuation layout must match.
describe("presentation attribution: layout outside the usage block is compared exactly, never normalised", () => {
  const OPEN_ERROR = "omo remote open: the device is required (the DEVICE column of omo remote devices)"
  const onOpen =
    (change: (stderr: string) => string): Edit =>
    (outcome, id) => {
      const changed = train12(outcome, id)
      return id === "native-remote-open-no-device" ? { ...changed, stderr: change(`${changed["stderr"]}`) } : changed
    }
  const failsOpen = (edit: Edit, reason: string) => {
    const report = run(edit)
    expect(report.presentation).toEqual(["native-remote-help", "native-remote-unknown"])
    expect(report.failures).toEqual([expect.stringContaining(reason)])
    expect(report.failures[0]).toContain("native-remote-open-no-device")
  }

  test("#given trailing white space added to the line before the block #then it fails", () => {
    failsOpen(
      onOpen((stderr) => stderr.replace(`${OPEN_ERROR}\n`, `${OPEN_ERROR} \n`)),
      "a line outside the usage block of omo remote changed",
    )
  })

  test("#given the line before the block moved after it #then it fails", () => {
    failsOpen(
      onOpen((stderr) => `${stderr.replace(`${OPEN_ERROR}\n`, "")}${OPEN_ERROR}\n`),
      "a line outside the usage block of omo remote changed",
    )
  })

  test("#given the line before the block wrapped onto two lines #then it fails", () => {
    failsOpen(
      onOpen((stderr) => stderr.replace(`${OPEN_ERROR}\n`, OPEN_ERROR.replace(" (the", "\n(the") + "\n")),
      "a line outside the usage block of omo remote changed",
    )
  })

  test("#given two verbs of the block swapped, every line text unchanged #then the block's layout changed and it fails", () => {
    const swapped = onStreams((stream) => {
      const lines = stream.replace(`${BEFORE}\n`, `${AFTER}\n`).split("\n")
      const [a, b] = ["  interrupt ", "  close "].map((start) => lines.findIndex((line) => line.startsWith(start)))
      if (a === undefined || b === undefined || a < 0 || b < 0) return stream
      ;[lines[a], lines[b]] = [lines[b] ?? "", lines[a] ?? ""]
      return lines.join("\n")
    })
    expect(swapped(base["native-remote-help"] ?? {}, "native-remote-help")).not.toEqual(
      train12(base["native-remote-help"] ?? {}, "native-remote-help"),
    )
    failsAll(swapped, "the usage block of omo remote changed its verbs or their layout")
  })

  test("#given a new verb added to the usage block, named by its own row #then the block's verbs changed and it fails", () => {
    const NEW = "  teleport <session>                      move a session"
    const added = onStreams((stream) => stream.replace(`${BEFORE}\n`, `${BEFORE}\n${NEW}\n`))
    const row: PresentationRow = { ...ROW, verb: "remote teleport", changes: [{ before: BEFORE, after: NEW }] }
    failsAll(added, "the usage block of omo remote changed its verbs or their layout", [ROW, row])
  })
})

describe("presentation attribution: the row and the goldens", () => {
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

  test("#given a scenario that declares no usage block #then a row cannot pass it and the row itself is refused", () => {
    const report = gateReport(
      input({
        head: { ...input().head, outcomes: { s1: { exit: 2, stdout: "", stderr: "x" } } },
        base: { ...input().base, outcomes: { s1: { exit: 2, stdout: "", stderr: "y" } } },
        presentation: { base: [], head: [{ ...ROW, scenarios: ["s1"] }] },
      }),
    )
    expect(report.failures).toEqual([
      "script/sdk-parity/presentation.json: the row for remote send names scenario s1, which declares no usage block",
      "threads.send: scenario s1 answers differently on the merge base and the head; this pull request changes what it does without the SDK call threads.send",
    ])
  })
})
