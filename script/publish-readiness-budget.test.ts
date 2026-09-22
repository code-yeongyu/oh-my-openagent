/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

interface Outcome {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  readonly npmCalls: number
  readonly curlCalls: number
  readonly sleeps: number
}

/**
 * npm stub: reports the version/dist-tag as absent for the first `readyAfterViews` `npm view`
 * calls, then as present. sleep stub: records the call and returns immediately.
 */
/**
 * npm stub: reports the version/dist-tag as absent for the first `readyAfterViews` `npm view`
 * calls, then as present. sleep stub: records the call and returns immediately.
 *
 * Both stubs are bash FUNCTIONS prepended to the extracted block, not executables on PATH. bash
 * resolves a function before any PATH lookup on every OS, whereas a `#!/usr/bin/env bash` script
 * on PATH is not executable on windows-latest (no shebang support, `;` PATH separator, `.cmd`
 * shims) - the first version of this harness did that and both cases hung to the 30 s budget on
 * Windows while passing on POSIX. The workflow text itself stays untouched.
 */
function runReadiness(options: { readonly metadataReadyAfterViews: number; readonly tarballReadyAfterHeads: number }): Outcome {
  const root = mkdtempSync(join(tmpdir(), "publish-readiness-"))
  try {
    const counter = join(root, "npm-views")
    const curlCounter = join(root, "curl-heads")
    const sleeps = join(root, "sleeps")
    writeFileSync(counter, "0")
    writeFileSync(curlCounter, "0")
    writeFileSync(sleeps, "")
    const preamble = [
      "npm() {",
      '  local n; n=$(cat "$COUNTER"); n=$((n+1)); printf "%s" "$n" > "$COUNTER"',
      '  if [ "$n" -gt "$METADATA_READY_AFTER" ]; then',
      '    if printf "%s\\n" "$*" | grep -q "dist.tarball"; then',
      '      printf "https://registry.npmjs.org/omo-ai/-/omo-ai-%s.tgz\\n" "$OMO_AI_VERSION"',
      "    else",
      '      printf "%s\\n" "$OMO_AI_VERSION"',
      "    fi",
      "  fi",
      "  return 0",
      "}",
      "curl() {",
      '  local n; n=$(cat "$CURL_COUNTER"); n=$((n+1)); printf "%s" "$n" > "$CURL_COUNTER"',
      '  [ "$n" -gt "$TARBALL_READY_AFTER" ]',
      "}",
      'sleep() { printf "%s\\n" "$1" >> "$SLEEPS"; }',
      "export -f npm curl sleep",
      "",
    ].join("\n")
    const script = join(root, "readiness.sh")
    writeFileSync(script, preamble + readinessRunBlock())
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        COUNTER: counter,
        CURL_COUNTER: curlCounter,
        SLEEPS: sleeps,
        METADATA_READY_AFTER: String(options.metadataReadyAfterViews),
        TARBALL_READY_AFTER: String(options.tarballReadyAfterHeads),
        OMO_AI_VERSION: "5.0.0-0.beta.42",
        ALREADY_PUBLISHED: "false",
      },
    })
    return {
      status: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      npmCalls: Number(readFileSync(counter, "utf8").trim()),
      curlCalls: Number(readFileSync(curlCounter, "utf8").trim()),
      sleeps: readFileSync(sleeps, "utf8").split("\n").filter(Boolean).length,
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("publish.yml post-publish-verify registry readiness", () => {
  test("#given the registry needs ~5 minutes to expose the version #when readiness polls #then it keeps waiting instead of failing a successful publish", () => {
    // 5 minutes at the loop's own interval, expressed in npm view calls (3 views per attempt).
    const outcome = runReadiness({ metadataReadyAfterViews: 3 * 20, tarballReadyAfterHeads: 0 })
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain("metadata and tarball are ready")
  })

  test("#given metadata is visible before the tarball #when artifact propagation takes several minutes #then readiness waits for the installable blob", () => {
    const outcome = runReadiness({ metadataReadyAfterViews: 0, tarballReadyAfterHeads: 20 })
    expect(outcome.status).toBe(0)
    expect(outcome.curlCalls).toBe(21)
    expect(outcome.sleeps).toBe(20)
    expect(outcome.stdout).toContain("metadata and tarball are ready")
  })

  test(
    "#given the registry never exposes the version #when the budget is exhausted #then it fails and names the publish-vs-propagation distinction",
    () => {
      const outcome = runReadiness({ metadataReadyAfterViews: Number.MAX_SAFE_INTEGER, tarballReadyAfterHeads: Number.MAX_SAFE_INTEGER })
      expect(outcome.status).not.toBe(0)
      expect(outcome.stdout + outcome.stderr).toContain("propagat")
      // Budget is wall-clock shaped, not "5 tries": sleeps x interval must cover several minutes.
      expect(outcome.sleeps).toBeGreaterThanOrEqual(20)
    },
    15_000,
  )
})
