/// <reference types="bun-types" />

// Platform contract (#10856): a pull request outside the full matrix must not take a hosted
// macOS or Windows runner. The required matrix contexts keep their names because the leg still
// reports, but it runs on ubuntu with every heavy step skipped; native binary parity, which is
// not a required context, is skipped at the job level.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

const workflowsDir = new URL("../.github/workflows/", import.meta.url)
const NOT_FULL_MATRIX = "needs.ci-mode.outputs.full_matrix != 'true'"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jobs(file: string): Record<string, unknown> {
  const parsed: unknown = load(readFileSync(new URL(file, workflowsDir), "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed["jobs"])) throw new Error(`${file} must define jobs`)
  return parsed["jobs"]
}

function job(file: string, name: string): Record<string, unknown> {
  const found = jobs(file)[name]
  if (!isRecord(found)) throw new Error(`${file} must define ${name}`)
  return found
}

function toJavaScript(expression: string): string {
  return expression
    .replace(/([!=])=/g, "$1==")
    .replaceAll("needs.ci-mode.", 'needs["ci-mode"].')
    .replace(/(?<=[\w\]])\.(?=[A-Za-z_])/g, "?.")
}

function resolveRunner(expression: string, os: string, fullMatrix: string): string {
  const body = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(expression)?.[1]
  if (body === undefined) return expression
  const evaluate = new Function("matrix", "needs", `return ${toJavaScript(body)}`)
  const result: unknown = evaluate({ os }, { "ci-mode": { outputs: { full_matrix: fullMatrix } } })
  if (typeof result !== "string") throw new Error(`runs-on must resolve to a label, got ${String(result)}`)
  return result
}

describe("#given the OS matrix jobs that report required contexts", () => {
  test.each(["test", "codex-compatibility", "senpi-compatibility"])(
    "#then %s allocates a macOS or Windows runner only for the full matrix",
    (name) => {
      const runsOn = String(job("ci.yml", name)["runs-on"])
      expect(runsOn).toContain(NOT_FULL_MATRIX)
      for (const os of ["macos-latest", "windows-latest"]) {
        expect(resolveRunner(runsOn, os, "false")).toBe("ubuntu-26.04")
        expect(resolveRunner(runsOn, os, "")).toBe("ubuntu-26.04")
        expect(resolveRunner(runsOn, os, "true")).toBe(os)
      }
      expect(resolveRunner(runsOn, "ubuntu-latest", "true")).toBe("ubuntu-26.04")
      expect(resolveRunner(runsOn, "ubuntu-latest", "false")).toBe("ubuntu-26.04")
    },
  )
})

describe("#given native binary parity, which has no ubuntu leg", () => {
  test("#then the whole job is skipped outside the full matrix and heavy validation", () => {
    const condition = String(job("ci.yml", "native-binary-parity")["if"])
    expect(condition).toBe(
      "needs.ci-mode.outputs.run_heavy == 'true' && needs.ci-mode.outputs.full_matrix == 'true'",
    )
  })
})

describe("#given the path-filtered workflows that also run macOS/Windows on dev pushes", () => {
  test.each(["desktop-engine.yml", "desktop-windows-qa.yml", "desktop-linux-qa.yml", "get-worker-ci.yml"])(
    "#then %s cancels a superseded PR run but lets a dev run finish and collapses pending dev runs",
    (file) => {
      const parsed: unknown = load(readFileSync(new URL(file, workflowsDir), "utf8"))
      if (!isRecord(parsed) || !isRecord(parsed["concurrency"])) throw new Error(`${file} must define concurrency`)
      const concurrency = parsed["concurrency"]
      const evaluate = (expression: unknown, github: unknown) => {
        const body = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(String(expression))?.[1]
        if (body === undefined) throw new Error(`${file} concurrency must be an expression`)
        return new Function("github", `return ${toJavaScript(body)}`)(github)
      }
      const group = (github: unknown) => String(concurrency["group"]).replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_match, body: string) => String(new Function("github", `return ${toJavaScript(body)}`)(github)))
      const pr = { workflow: "W", event_name: "pull_request", event: { pull_request: { number: 7 } }, ref: "refs/pull/7/merge", sha: "a" }
      const push = (sha: string) => ({ workflow: "W", event_name: "push", event: {}, ref: "refs/heads/dev", sha })

      expect(group(pr)).toBe("W-7")
      expect(evaluate(concurrency["cancel-in-progress"], pr)).toBe(true)
      expect(group(push("a"))).toBe(group(push("b")))
      expect(evaluate(concurrency["cancel-in-progress"], push("a"))).toBe(false)
    },
  )
})

describe("#given the label-triggered full-matrix run", () => {
  test.each(["ci:full-matrix", "run-full-ci"])("#then the %s label starts it", (label) => {
    const condition = String(job("ci-full-matrix-label.yml", "full-matrix")["if"])
    const evaluate = new Function("github", `return ${toJavaScript(condition)}`)
    expect(evaluate({ event: { label: { name: label } } })).toBe(true)
    expect(evaluate({ event: { label: { name: "bug" } } })).toBe(false)
  })
})
