/// <reference types="bun-types" />

// The platform-red writer (#13802) runs as a shell step with no concurrency group; it must leave exactly one open
// ci:platform-red issue whatever order two writers race in. These cases run the real step against a fake gh.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"

// The writer runs against a PATH stub for gh, which Windows bash cannot shadow reliably.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

const root = mkdtempSync(join(tmpdir(), "platform-red-tracker-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function writerScript(): string {
  const workflow = load(readFileSync(new URL("../.github/workflows/platform-red-tracker.yml", import.meta.url), "utf8"))
  const steps = (workflow as { jobs: { "file-issue": { steps: { name?: string; run?: string }[] } } }).jobs[
    "file-issue"
  ].steps
  const step = steps.find((candidate) => candidate.name === "File or update the platform-red tracking issue")
  if (step?.run === undefined) throw new Error("the writer step must exist")
  return step.run
}

// `issue list` answers come from a queue, one line per call; every call is recorded.
function runWriter(name: string, listAnswers: readonly string[]): string[] {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(dir, "answers"), `${listAnswers.join("\n")}\n`)
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/bash",
      'echo "$*" >> "$FAKE_DIR/calls"',
      'case "$1 $2" in',
      '  "api repos/"*) echo "#13811" ;;',
      '  "issue list") head -n 1 "$FAKE_DIR/answers"; tail -n +2 "$FAKE_DIR/answers" > "$FAKE_DIR/rest"; mv "$FAKE_DIR/rest" "$FAKE_DIR/answers" ;;',
      '  "issue create") echo "https://github.com/owner/project/issues/42" ;;',
      "esac",
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  const run = spawnSync("bash", ["-euo", "pipefail", "-c", writerScript()], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      RUNNER_TEMP: dir,
      GH_REPO: "owner/project",
      RUN_URL: "https://example.invalid/run",
      RUN_NAME: "CI",
      HEAD_SHA: "abc",
      FAILED: "- test (windows-latest, 1/2)",
    },
  })
  expect(run.status).toBe(0)
  return readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
}

describe("#given the platform-red writer", () => {
  posixBashTest("#then an open issue gets a comment and nothing is created", () => {
    const calls = runWriter("existing", ["17"])
    expect(calls.filter((call) => call.startsWith("issue comment 17 "))).toHaveLength(1)
    expect(calls.some((call) => call.startsWith("issue create"))).toBe(false)
  })

  posixBashTest("#then a writer that lost the race comments on the older issue and closes its own", () => {
    const calls = runWriter("race", ["", "41"])
    expect(calls.filter((call) => call.startsWith("issue comment 41 "))).toHaveLength(1)
    expect(calls.filter((call) => call.startsWith("issue close 42 "))).toHaveLength(1)
  })

  posixBashTest("#then a re-read that briefly returns nothing keeps the issue it just created", () => {
    const calls = runWriter("stale-read", ["", ""])
    expect(calls.some((call) => call.startsWith("issue create"))).toBe(true)
    expect(calls.some((call) => call.startsWith("issue comment"))).toBe(false)
    expect(calls.some((call) => call.startsWith("issue close"))).toBe(false)
  })
})
