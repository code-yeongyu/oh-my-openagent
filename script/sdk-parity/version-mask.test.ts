import { describe, expect, test } from "bun:test"

import { candidateDigest, gateReport, goldenProblems, renderReport } from "./gate"
import { HEAD, input, text } from "./gate-fixture"
import type { Outcome } from "./scenario-run"
import { SCENARIOS } from "./scenarios"
import { type DeclaredVersions, readDeclaredVersions } from "./version-mask"

// Security contract of the changed-capability gate (design 7.4): the version mask is the one way a printed-version
// difference merges without its SDK call, so each refusal below has its own control. Built from the real case: the
// senpi pin bump of #15075 changes native-version's output from `(engine: senpi <base pin>)` to the new pin.

const ID = "native-version"
const scenarios = SCENARIOS.filter((scenario) => scenario.id === ID)
const committed = JSON.parse(text("script/sdk-parity/goldens.json")) as Record<string, Outcome>
const base = committed[ID] ?? {}
const declared = readDeclaredVersions(".")
if (declared === undefined) throw new Error("the repository has no native package manifest")
const NEW_PIN = "2099.1.2"
const bumped: DeclaredVersions = { ...declared, engine: NEW_PIN }
const withText = (outcome: Outcome, change: (stdout: string) => string): Outcome => ({
  ...outcome,
  stdout: change(`${outcome["stdout"]}`),
})
const pinBumped = withText(base, (stdout) => stdout.split(declared.engine).join(NEW_PIN))

type Versions = { readonly base: DeclaredVersions | undefined; readonly head: DeclaredVersions }
const BUMP: Versions = { base: declared, head: bumped }
const run = (after: Outcome, versions: Versions = BUMP, before: Outcome = base) =>
  gateReport(
    input({
      scenarios,
      base: { ...input().base, outcomes: { [ID]: before } },
      head: { ...input().head, outcomes: { [ID]: after } },
      versions,
    }),
  )

const failsAsChange = (after: Outcome, versions: Versions = BUMP, before: Outcome = base) => {
  const report = run(after, versions, before)
  expect(report.versionMasked).toEqual([])
  expect(report.failures).toEqual([expect.stringContaining(`scenario ${ID} answers differently`)])
}

describe("version mask (positive control: the engine pin bump of #15075)", () => {
  test("#given only the declared engine pin changed and native-version prints it #then it compares equal, is named and is digested", () => {
    expect(`${base["stdout"]}`).toContain(declared.engine)
    const report = run(pinBumped)
    expect(report.failures).toEqual([])
    expect(report.versionMasked).toEqual([`${ID}#version-mask`])
    expect(report.digest).toBe(candidateDigest(HEAD, [`${ID}#version-mask`]))
    expect(renderReport(report)).toContain(`VERSION MASK: ${ID}:`)
  })

  test("#given only the declared omo package version changed and native-version prints it #then it compares equal", () => {
    const after = withText(base, (stdout) => stdout.split(declared.omo).join("9.9.9"))
    expect(run(after, { base: declared, head: { ...declared, omo: "9.9.9" } }).failures).toEqual([])
  })
})

describe("version mask (the rest of the outcome is compared exactly)", () => {
  test("#given the pin bump plus a changed exit code #then it fails", () => {
    failsAsChange({ ...pinBumped, exit: Number(pinBumped["exit"]) + 1 })
  })

  test("#given the pin bump plus a changed stderr #then it fails", () => {
    failsAsChange({ ...pinBumped, stderr: `${pinBumped["stderr"]}warning\n` })
  })

  test("#given the pin bump plus an added outcome field #then it fails", () => {
    failsAsChange({ ...pinBumped, signal: "SIGTERM" })
  })

  test("#given the pin bump moved to the other stream #then it fails", () => {
    failsAsChange({ ...pinBumped, stdout: pinBumped["stderr"], stderr: pinBumped["stdout"] })
  })
})

describe("version mask (the reviewer's digest with another tier)", () => {
  test("#given a version-masked scenario and a candidate in one report #then the ids line lists the candidate first and the version mark last, and the digest covers both", () => {
    const report = gateReport(
      input({
        scenarios,
        base: { ...input().base, outcomes: { [ID]: base } },
        head: { ...input().head, outcomes: { [ID]: pinBumped } },
        versions: BUMP,
        changedFiles: ["packages/omo-native/bin/lib/thread.js"],
      }),
    )
    expect(report.failures).toEqual([])
    expect(report.candidates).toEqual(["threads.send"])
    expect(renderReport(report)).toContain(`count=2 ids=threads.send,${ID}#version-mask`)
    expect(report.digest).toBe(candidateDigest(HEAD, ["threads.send", `${ID}#version-mask`]))
  })
})

describe("version mask (negative controls)", () => {
  test("#given the pin bump plus one other changed character #then it fails", () => {
    failsAsChange(withText(pinBumped, (stdout) => stdout.replace("omo ", "omO ")))
  })

  test("#given the head prints a version its tree does not declare #then it is not masked and fails", () => {
    failsAsChange(pinBumped, { base: declared, head: declared })
  })

  test("#given the head prints the placeholder text itself #then it is never masked and fails", () => {
    failsAsChange(withText(base, (stdout) => stdout.split(declared.engine).join("<ENGINE_VERSION>")))
  })

  test("#given the merge base's output carries the placeholder text #then it is never masked and the bump fails", () => {
    const placeholderBase = withText(base, (stdout) => stdout.split(declared.engine).join("<ENGINE_VERSION>"))
    failsAsChange(pinBumped, BUMP, placeholderBase)
  })

  test("#given a merge base with no native manifest #then nothing is masked and the bump fails", () => {
    failsAsChange(pinBumped, { base: undefined, head: bumped })
  })

  test("#given the pin bump with stale goldens #then the CLI-vs-golden check inside the head stays exact and fails", () => {
    expect(goldenProblems({ [ID]: base }, { [ID]: pinBumped })).toEqual([
      expect.stringContaining(`goldens.json ${ID} differs from the scenario's live outcome`),
    ])
  })
})
