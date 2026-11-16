/// <reference types="bun-types" />

// Platform contract (#10856, #13802): a pull request runs every job of every workflow on Linux. The required
// matrix contexts keep their names because the leg still reports, but it runs on ubuntu with every heavy step
// skipped; a job with no Linux leg is skipped at the job level. macOS and Windows run on push, on dispatch and on
// a pull request that carries the one opt-in label, ci:full-matrix.

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { load } from "js-yaml"
import { type ExpressionContext, evaluate } from "../test-support/github-expression"

const workflowsDir = new URL("../.github/workflows/", import.meta.url)
const NOT_FULL_MATRIX = "needs.ci-mode.outputs.full_matrix != 'true'"
const OPT_IN_LABEL = "ci:full-matrix"

type Workflow = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function workflow(file: string): Workflow {
  const parsed: unknown = load(readFileSync(new URL(file, workflowsDir), "utf8"))
  if (!isRecord(parsed)) throw new Error(`${file} must parse as an object`)
  return parsed
}

function jobs(file: string): Record<string, unknown> {
  const found = workflow(file)["jobs"]
  if (!isRecord(found)) throw new Error(`${file} must define jobs`)
  return found
}

function job(file: string, name: string): Record<string, unknown> {
  const found = jobs(file)[name]
  if (!isRecord(found)) throw new Error(`${file} must define ${name}`)
  return found
}

function isExpression(value: unknown): boolean {
  return typeof value === "string" && value.includes("${{")
}

function matrixLegs(job: Record<string, unknown>, context: ExpressionContext): Record<string, unknown>[] {
  const strategy = job["strategy"]
  if (!isRecord(strategy)) return [{}]
  const raw = isExpression(strategy["matrix"]) ? evaluate(strategy["matrix"], context) : strategy["matrix"]
  if (!isRecord(raw)) throw new Error("matrix must resolve to an object")
  const resolved = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, isExpression(value) ? evaluate(value, context) : value]),
  )
  const { include = [], exclude, ...dimensions } = resolved
  if (exclude !== undefined) throw new Error("matrix exclude is not modelled here")
  if (!Array.isArray(include)) throw new Error("matrix include must resolve to a list")
  const keys = Object.keys(dimensions)
  let legs: Record<string, unknown>[] = keys.length === 0 ? [] : [{}]
  for (const [key, values] of Object.entries(dimensions)) {
    if (!Array.isArray(values)) throw new Error(`matrix ${key} must resolve to a list`)
    legs = legs.flatMap((leg) => values.map((value: unknown) => ({ ...leg, [key]: value })))
  }
  const base = [...legs]
  for (const row of include.filter(isRecord)) {
    const matches =
      keys.length === 0 ? [] : base.filter((leg) => keys.every((key) => !(key in row) || leg[key] === row[key]))
    if (matches.length === 0) legs.push({ ...row })
    for (const leg of matches) Object.assign(leg, row)
  }
  return legs
}

function scheduledRunners(file: string, github: Record<string, unknown>, fullMatrix: string): string[] {
  const needs = new Proxy(
    { "ci-mode": { outputs: { full_matrix: fullMatrix, run_heavy: "true" } } },
    { get: (target, key) => Reflect.get(target, key) ?? { result: "success", outputs: { full_matrix: fullMatrix } } },
  )
  const runners: string[] = []
  for (const [name, definition] of Object.entries(jobs(file))) {
    if (!isRecord(definition) || definition["uses"] !== undefined) continue
    const runsOn = definition["runs-on"]
    if (typeof runsOn === "string" && !isExpression(runsOn) && runsOn.startsWith("ubuntu-")) continue
    if (definition["if"] !== undefined && !evaluate(definition["if"], { github, needs })) continue
    for (const matrix of matrixLegs(definition, { github, needs })) {
      const label = isExpression(runsOn) ? evaluate(runsOn, { github, needs, matrix }) : runsOn
      runners.push(`${name}: ${String(label)}`)
    }
  }
  return runners
}

const nonLinux = (runners: string[]) => runners.filter((runner) => !/: ubuntu-/.test(runner))

function pullRequestWorkflows(): string[] {
  return readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => {
      const parsed = workflow(file)
      const triggers = parsed["on"] ?? parsed["true"]
      const events = isRecord(triggers) ? Object.keys(triggers) : [triggers].flat().map(String)
      return events.includes("pull_request") || events.includes("pull_request_target")
    })
}

const pullRequest = (labels: readonly string[]) => ({
  event_name: "pull_request",
  ref: "refs/pull/1/merge",
  head_ref: "feature/change",
  event: { pull_request: { number: 1, labels: labels.map((name) => ({ name })) } },
})
const push = { event_name: "push", ref: "refs/heads/dev", event: {} }

describe("#given every workflow a pull request triggers", () => {
  test("#then a pull request without the opt-in label schedules no macOS or Windows runner", () => {
    const scheduled = pullRequestWorkflows().flatMap((file) =>
      nonLinux(scheduledRunners(file, pullRequest(["bug"]), "false")).map((runner) => `${file} ${runner}`),
    )
    expect(scheduled).toEqual([])
  })

  // The label is honored only through the one platform decision (#13859): a refused label must not reach a runner.
  test("#then a refused ci:full-matrix label schedules no macOS or Windows runner in any workflow", () => {
    const scheduled = pullRequestWorkflows().flatMap((file) =>
      nonLinux(scheduledRunners(file, pullRequest([OPT_IN_LABEL]), "false")).map((runner) => `${file} ${runner}`),
    )
    expect(scheduled).toEqual([])
  })

  test("#then only the decision's inputs read the PR labels; no workflow tests the raw label name", () => {
    const readers = readdirSync(workflowsDir)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => /pull_request\.labels|'ci:full-matrix'/.test(readFileSync(new URL(file, workflowsDir), "utf8")))
    // ci.yml and pr-platform-decision.yml feed the labels to the classifier; changelog-gate.yml reads changelog labels;
    // the label workflow's trigger tests the labeled event's own label name.
    expect(readers.sort()).toEqual([
      "changelog-gate.yml",
      "ci-full-matrix-label.yml",
      "ci.yml",
      "pr-platform-decision.yml",
    ])
  })

  test.each(pullRequestWorkflows())("#then the opt-in label gives %s the same macOS/Windows legs as a push", (file) => {
    const labelled = nonLinux(scheduledRunners(file, pullRequest([OPT_IN_LABEL]), "true"))
    expect(labelled).toEqual(nonLinux(scheduledRunners(file, push, "true")))
  })
})

describe("#given the dev push runs that now carry macOS/Windows coverage", () => {
  test("#then the platform-red tracker listens to every workflow that schedules macOS/Windows on a dev push", () => {
    const pushesDev = (file: string) => {
      const triggers = workflow(file)["on"]
      const pushTrigger = isRecord(triggers) ? triggers["push"] : undefined
      if (!isRecord(pushTrigger)) return false
      const branches = pushTrigger["branches"]
      return !Array.isArray(branches) || branches.includes("dev")
    }
    const platformOnDev = readdirSync(workflowsDir)
      .filter((file) => /\.ya?ml$/.test(file) && pushesDev(file))
      .filter((file) => nonLinux(scheduledRunners(file, push, "true")).length > 0)
      .map((file) => String(workflow(file)["name"]))
    const tracker = workflow("platform-red-tracker.yml")["on"]
    const watched = isRecord(tracker) && isRecord(tracker["workflow_run"]) ? tracker["workflow_run"]["workflows"] : []
    expect([...(Array.isArray(watched) ? watched : [])].sort()).toEqual(platformOnDev.sort())
  })

  // GitHub keeps one pending run per concurrency group and cancels the older one, so any group in the tracker can
  // drop a red run's failed jobs and merged PR before they reach the issue. Writers dedupe the issue instead.
  test("#then no tracker job can be dropped by a concurrency group, and only a failed macOS/Windows job writes", () => {
    const file = "platform-red-tracker.yml"
    expect(workflow(file)["concurrency"]).toBeUndefined()
    const grouped = Object.entries(jobs(file)).filter(
      ([, definition]) => isRecord(definition) && definition["concurrency"],
    )
    expect(grouped.map(([name]) => name)).toEqual([])
    const writer = job(file, "file-issue")
    const detect = String(writer["needs"])
    const runsFor = (failed: string) =>
      evaluate(writer["if"], { github: push, needs: { [detect]: { outputs: { failed } } } })
    expect(runsFor("")).toBe(false)
    expect(runsFor("- [test (windows-latest, 1/2)](url) on `windows-latest`")).toBe(true)
  })
})

describe("#given the OS matrix jobs that report required contexts", () => {
  test.each(["test", "codex-compatibility", "senpi-compatibility"])(
    "#then %s allocates a macOS or Windows runner only for the full matrix",
    (name) => {
      const runsOn = String(job("ci.yml", name)["runs-on"])
      expect(runsOn).toContain(NOT_FULL_MATRIX)
      const resolve = (os: string, fullMatrix: string) =>
        evaluate(runsOn, {
          github: push,
          matrix: { os },
          needs: { "ci-mode": { outputs: { full_matrix: fullMatrix } } },
        })
      for (const os of ["macos-latest", "windows-latest"]) {
        expect(resolve(os, "false")).toBe("ubuntu-26.04")
        expect(resolve(os, "")).toBe("ubuntu-26.04")
        expect(resolve(os, "true")).toBe(os)
      }
      expect(resolve("ubuntu-latest", "true")).toBe("ubuntu-26.04")
      expect(resolve("ubuntu-latest", "false")).toBe("ubuntu-26.04")
    },
  )
})

describe("#given native binary parity, which has no ubuntu leg", () => {
  test("#then the whole job is skipped outside the full matrix and heavy validation", () => {
    const condition = String(job("ci.yml", "native-binary-parity")["if"])
    expect(condition).toBe("needs.ci-mode.outputs.run_heavy == 'true' && needs.ci-mode.outputs.full_matrix == 'true'")
  })
})

describe("#given the path-filtered workflows that also run macOS/Windows on dev pushes", () => {
  test.each([
    "computer-engine.yml",
    "computer-fixtures.yml",
    "desktop-engine.yml",
    "desktop-windows-qa.yml",
    "desktop-linux-qa.yml",
    "engine-trust-helper.yml",
    "get-worker-ci.yml",
    "git-job-helper.yml",
  ])("#then %s cancels a superseded PR run but lets a dev run finish and collapses pending dev runs", (file) => {
    const concurrency = workflow(file)["concurrency"]
    if (!isRecord(concurrency)) throw new Error(`${file} must define concurrency`)
    const group = (github: unknown) =>
      String(concurrency["group"]).replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_match, body: string) =>
        String(evaluate(body, { github })),
      )
    const pr = { workflow: "W", event_name: "pull_request", event: { pull_request: { number: 7 } }, sha: "a" }
    const pushAt = (sha: string) => ({ workflow: "W", event_name: "push", event: {}, ref: "refs/heads/dev", sha })

    expect(group(pr)).toBe("W-7")
    expect(evaluate(concurrency["cancel-in-progress"], { github: pr })).toBe(true)
    expect(group(pushAt("a"))).toBe(group(pushAt("b")))
    expect(evaluate(concurrency["cancel-in-progress"], { github: pushAt("a") })).toBe(false)
  })
})

describe("#given the label-triggered full-matrix run", () => {
  test.each([
    [OPT_IN_LABEL, true],
    ["run-full-ci", false],
    ["bug", false],
  ])("#then the %s label starts it: %p", (label, starts) => {
    const condition = job("ci-full-matrix-label.yml", "full-matrix")["if"]
    expect(evaluate(condition, { github: { event: { label: { name: label } } } })).toBe(starts)
  })
})
