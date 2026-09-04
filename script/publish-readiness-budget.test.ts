/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Executes the "Wait for omo-ai registry readiness" step of publish.yml with `npm` and `sleep`
 * stubbed on PATH, so the loop's budget is asserted rather than assumed.
 *
 * Regression pinned (2026-09-04, beta.42): `npm publish` printed "+ omo-ai@5.0.0-0.beta.42" and
 * "Your package is being processed and may take a few minutes to become available", yet the verify
 * step gave up after 5 x 15 s = 60 s and failed the release run - a false failure of a successful
 * publish (the same shape that bit lazycodex-ai in beta.31 and beta.34). The registry showed the
 * version roughly five minutes after publish.
 */

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")
const workflow = Bun.YAML.parse(workflowText) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }

function readinessRunBlock(): string {
  const step = workflow.jobs["post-publish-verify"].steps.find((s) => s.name === "Wait for omo-ai registry readiness")
  if (!step?.run) throw new Error("post-publish-verify has no 'Wait for omo-ai registry readiness' run block")
  return step.run
}

interface Outcome { readonly status: number; readonly stdout: string; readonly stderr: string; readonly npmCalls: number; readonly sleeps: number }

/**
 * npm stub: reports the version/dist-tag as absent for the first `readyAfterViews` `npm view`
 * calls, then as present. sleep stub: records the call and returns immediately.
 */
function runReadiness(readyAfterViews: number): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-readiness-"))
  try {
    const bin = join(root, "bin")
    const counter = join(root, "npm-views")
    const sleeps = join(root, "sleeps")
    Bun.spawnSync(["mkdir", "-p", bin])
    writeFileSync(counter, "0")
    writeFileSync(sleeps, "")
    writeFileSync(join(bin, "npm"), [
      "#!/usr/bin/env bash",
      'n=$(cat "$COUNTER"); n=$((n+1)); echo "$n" > "$COUNTER"',
      'if [ "$n" -gt "$READY_AFTER" ]; then echo "$OMO_AI_VERSION"; fi',
      "exit 0",
      "",
    ].join("\n"))
    writeFileSync(join(bin, "sleep"), ["#!/usr/bin/env bash", 'echo "$1" >> "$SLEEPS"', ""].join("\n"))
    chmodSync(join(bin, "npm"), 0o755)
    chmodSync(join(bin, "sleep"), 0o755)
    const script = join(root, "readiness.sh")
    writeFileSync(script, readinessRunBlock())
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, COUNTER: counter, SLEEPS: sleeps, READY_AFTER: String(readyAfterViews), OMO_AI_VERSION: "5.0.0-0.beta.42", ALREADY_PUBLISHED: "false" },
    })
    return {
      status: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      npmCalls: Number(readFileSync(counter, "utf8").trim()),
      sleeps: readFileSync(sleeps, "utf8").split("\n").filter(Boolean).length,
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("publish.yml post-publish-verify registry readiness", () => {
  test("#given the registry needs ~5 minutes to expose the version #when readiness polls #then it keeps waiting instead of failing a successful publish", () => {
    // 5 minutes at the loop's own interval, expressed in npm view calls (2 views per attempt).
    const outcome = runReadiness(2 * 20)
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain("is ready")
  })

  test("#given the registry never exposes the version #when the budget is exhausted #then it fails and names the publish-vs-propagation distinction", () => {
    const outcome = runReadiness(Number.MAX_SAFE_INTEGER)
    expect(outcome.status).not.toBe(0)
    expect(outcome.stdout + outcome.stderr).toContain("propagat")
    // Budget is wall-clock shaped, not "5 tries": sleeps x interval must cover several minutes.
    expect(outcome.sleeps).toBeGreaterThanOrEqual(20)
  })
})
