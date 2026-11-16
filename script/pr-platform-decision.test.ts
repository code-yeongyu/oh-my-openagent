/// <reference types="bun-types" />

// The platform decision (#13859) reads a pull request's files from the pulls/files API, which lists at most 3000.
// A truncated list may hide a platform path, so a labelled pull request fails toward the full matrix (the lead's ruling).

import { afterAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

// The step runs against a PATH stub for gh, which Windows bash cannot shadow reliably.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

const root = mkdtempSync(join(tmpdir(), "pr-platform-decision-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function decideScript(): string {
  const workflow = load(readFileSync(new URL("../.github/workflows/pr-platform-decision.yml", import.meta.url), "utf8"))
  const steps = (workflow as { jobs: { decide: { steps: { id?: string; run?: string }[] } } }).jobs.decide.steps
  const step = steps.find((candidate) => candidate.id === "decide")
  if (step?.run === undefined) throw new Error("the decide step must exist")
  return step.run
}

function decide(
  name: string,
  listed: readonly string[],
  changedFiles: number,
  labels: readonly string[] = ["ci:full-matrix"],
) {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(dir, "files"), `${listed.join("\n")}\n`)
  writeFileSync(
    join(dir, "event.json"),
    JSON.stringify({
      pull_request: {
        number: 7,
        changed_files: changedFiles,
        body: "",
        labels: labels.map((label) => ({ name: label })),
      },
    }),
  )
  writeFileSync(join(bin, "gh"), '#!/bin/bash\ncat "$FAKE_DIR/files"\n')
  chmodSync(join(bin, "gh"), 0o755)
  writeFileSync(join(dir, "output"), "")
  const run = spawnSync("bash", ["-c", decideScript()], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: join(dir, "output"),
      GITHUB_EVENT_PATH: join(dir, "event.json"),
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: "owner/project",
      PR_NUMBER: "7",
      HEAD_REF: "feature/x",
      FAIL_ON_REFUSAL: "false",
    },
  })
  return { status: run.status, stdout: run.stdout, output: readFileSync(join(dir, "output"), "utf8") }
}

posixBashTest("#given a complete file list with a platform path #then the label is honored", () => {
  const result = decide("complete", ["crates/x/src/lib.rs", "README.md"], 2)
  expect(result.status).toBe(0)
  expect(result.output).toContain("full_matrix=true")
  expect(result.stdout).not.toContain("truncated")
})

// A capped list may hide a platform path, so a labelled pull request fails toward the full matrix (the lead's ruling).
posixBashTest(
  "#given the label and more changed files than the API listed #then the label is honored and the cap is named",
  () => {
    const result = decide("truncated", ["packages/utils/src/a.ts"], 3500)
    expect(result.status).toBe(0)
    expect(result.output).toContain("full_matrix=true")
    expect(result.stdout).toContain("::warning title=ci:full-matrix file list truncated::")
  },
)

// A listing short of changed_files at or under the cap (a head that moved between the event and the read) is judged by
// its paths, so it must not claim the label is honored without a path check.
posixBashTest("#given a short listing at or under the API cap #then no truncation warning is printed", () => {
  const result = decide("short-under-cap", ["packages/utils/src/a.ts"], 2)
  expect(result.status).toBe(0)
  expect(result.output).toContain("full_matrix=false")
  expect(result.stdout).not.toContain("file list truncated")
})

posixBashTest.each([
  [3000, false],
  [3001, true],
])("#given the label and a short listing of %i changed files #then the truncation warning is %p", (changed, warned) => {
  const result = decide(`edge-${changed}`, ["packages/utils/src/a.ts"], changed)
  expect(result.status).toBe(0)
  expect(result.output).toContain(warned ? "full_matrix=true" : "full_matrix=false")
  expect(result.stdout.includes("file list truncated")).toBe(warned)
})

posixBashTest("#given no label and a truncated list #then the pull request stays on Linux", () => {
  const result = decide("truncated-unlabelled", ["packages/utils/src/a.ts"], 3500, [])
  expect(result.status).toBe(0)
  expect(result.output).toContain("full_matrix=false")
  expect(result.stdout).not.toContain("file list truncated")
})
