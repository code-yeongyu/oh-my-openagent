/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Executes the "Smoke test published lazycodex-ai" step of publish.yml with `npm`, `npx`, and
 * `sleep` stubbed as bash functions, so the propagation budget is asserted rather than assumed.
 *
 * Regression pinned (2026-09-12, 5.0.0-beta.57, #8182): `npm publish` succeeded at 06:08:39Z, the
 * registry exposed the version at 06:12:54Z, and the smoke gave up at 06:12:23Z after 12 x 10 s -
 * a false failure of a successful publish, the same shape the omo-ai readiness loop was cured of
 * in `publish-readiness-budget.test.ts`.
 */

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")
const workflow = Bun.YAML.parse(workflowText) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }

function smokeRunBlock(): string {
  const step = workflow.jobs["post-publish-verify"].steps.find((s) => s.name === "Smoke test published lazycodex-ai")
  if (!step?.run) throw new Error("post-publish-verify has no 'Smoke test published lazycodex-ai' run block")
  return step.run
}

interface Outcome { readonly status: number; readonly output: string; readonly npmViews: number; readonly sleptSeconds: number }

function runSmoke(readyAfterViews: number): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-lazycodex-smoke-"))
  try {
    const counter = join(root, "npm-views")
    const sleeps = join(root, "sleeps")
    writeFileSync(counter, "0")
    writeFileSync(sleeps, "")
    const preamble = [
      "npm() {",
      '  local n; n=$(cat "$COUNTER"); n=$((n+1)); printf "%s" "$n" > "$COUNTER"',
      '  if [ "$n" -gt "$READY_AFTER" ]; then printf "%s\\n" "$OMO_VERSION"; return 0; fi',
      "  return 1",
      "}",
      "npx() { return 1; }",
      'sleep() { printf "%s\\n" "$1" >> "$SLEEPS"; }',
      "export -f npm npx sleep",
      "",
    ].join("\n")
    const script = join(root, "smoke.sh")
    writeFileSync(script, preamble + smokeRunBlock())
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      env: { ...process.env, COUNTER: counter, SLEEPS: sleeps, READY_AFTER: String(readyAfterViews), OMO_VERSION: "5.0.0-beta.57", DIST_TAG: "beta", GITHUB_WORKSPACE: root },
    })
    const sleptSeconds = readFileSync(sleeps, "utf8").split("\n").filter(Boolean).reduce((sum, line) => sum + Number(line), 0)
    return { status: result.status ?? -1, output: result.stdout + result.stderr, npmViews: Number(readFileSync(counter, "utf8").trim()), sleptSeconds }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("publish.yml post-publish-verify LazyCodex smoke readiness", () => {
  test("#given the registry needs ~5 minutes to expose the version #when the smoke polls #then it reaches the package instead of giving up", () => {
    const outcome = runSmoke(20)
    expect(outcome.npmViews).toBe(21)
    expect(outcome.output).toContain("became visible")
  })

  test("#given the registry never exposes the version #when the budget is exhausted #then it fails and names propagation, not the package", () => {
    const outcome = runSmoke(Number.MAX_SAFE_INTEGER)
    expect(outcome.status).not.toBe(0)
    expect(outcome.output).toContain("registry propagation")
    expect(outcome.sleptSeconds).toBeGreaterThanOrEqual(15 * 60)
  })
})
