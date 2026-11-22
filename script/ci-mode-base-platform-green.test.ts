/// <reference types="bun-types" />

// ci.yml's ci-mode step is what passes --base-platform-green to the classifier: a release-state pull request whose base
// already ran macOS/Windows green and whose diff is a release stamp stays on Linux; anything else keeps the full matrix.
// The step runs here as written in ci.yml, in a scratch repository, against a stub gh.

import { afterAll, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "ci-mode-base-green-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const stepFiles = [
  "script/ci-fast-path.mjs",
  "script/release-state-paths.mjs",
  ".github/scripts/base-platform-green.sh",
  ".github/scripts/platform-jobs.jq",
]

function classifyStep(): string {
  const workflow = load(readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8")) as {
    jobs: { "ci-mode": { steps: { id?: string; run?: string }[] } }
  }
  const run = workflow.jobs["ci-mode"].steps.find((step) => step.id === "classify")?.run
  if (run === undefined) throw new Error("ci.yml's ci-mode job must keep its classify step")
  return run
}

type Case = {
  readonly baseLegs: "green" | "red"
  readonly sourceChange: boolean
  readonly manifestEdit?: boolean
}

function runClassify(name: string, { baseLegs, sourceChange, manifestEdit = false }: Case): string {
  const dir = join(root, name)
  const repo = join(dir, "repo")
  const bin = join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  for (const file of stepFiles) {
    mkdirSync(join(repo, dirname(file)), { recursive: true })
    copyFileSync(join(repoRoot, file), join(repo, file))
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim()
  const manifests = ["package.json", "packages/omo-native/package.json"]
  const writeVersions = (version: string, extra: Record<string, string> = {}) => {
    for (const manifest of manifests) {
      mkdirSync(join(repo, dirname(manifest)), { recursive: true })
      writeFileSync(join(repo, manifest), `${JSON.stringify({ name: "x", version, ...extra }, null, 2)}\n`)
    }
  }
  git("init", "-q")
  writeVersions("5.1.80")
  writeFileSync(join(repo, "source.ts"), "export const a = 1\n")
  git("add", "-A")
  git("commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  writeVersions("5.1.81", manifestEdit ? { main: "other.js" } : {})
  if (sourceChange) writeFileSync(join(repo, "source.ts"), "export const a = 2\n")
  git("commit", "-qam", "stamp")
  const head = git("rev-parse", "HEAD")

  const runs = JSON.stringify({ workflow_runs: [{ id: 5, created_at: "2026-11-22T00:00:00Z" }] })
  const jobs = JSON.stringify({
    jobs: [
      {
        name: "test (windows-latest, 1/2)",
        conclusion: baseLegs === "green" ? "success" : "failure",
        html_url: "u",
        labels: ["windows-latest"],
        steps: [{ name: "Run tests", conclusion: baseLegs === "green" ? "success" : "failure" }],
      },
    ],
  })
  writeFileSync(join(dir, "runs.json"), runs)
  writeFileSync(join(dir, "jobs.json"), jobs)
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/bash",
      'case "$2" in *"/jobs?"*) f="$FAKE_DIR/jobs.json" ;; *) f="$FAKE_DIR/runs.json" ;; esac',
      'jq -r "$4" "$f"',
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  writeFileSync(join(dir, "event.json"), JSON.stringify({ pull_request: { changed_files: 3, body: "", labels: [] } }))
  writeFileSync(join(dir, "output"), "")

  const run = spawnSync("bash", ["-c", classifyStep()], {
    cwd: repo,
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
      GITHUB_SHA: head,
      BASE_SHA: base,
      HEAD_COMMIT_MESSAGE: "",
      HEAD_REF: "release/v5.1.81-source-state",
      PR_LABELS: "[]",
    },
  })
  if (run.status !== 0) throw new Error(`classify step failed: ${run.stderr}`)
  const fullMatrix = readFileSync(join(dir, "output"), "utf8").match(/^full_matrix=(\w+)$/m)?.[1]
  if (fullMatrix === undefined) throw new Error("classify step wrote no full_matrix output")
  return fullMatrix
}

posixBashTest(
  "#given a release stamp on a base whose macOS/Windows legs ran green #then the run stays on Linux",
  () => {
    expect(runClassify("green-stamp", { baseLegs: "green", sourceChange: false })).toBe("false")
  },
)

posixBashTest.each([
  ["the base's macOS/Windows legs were red", "red-stamp", { baseLegs: "red", sourceChange: false }],
  ["the diff changes source a stamp never writes", "green-source", { baseLegs: "green", sourceChange: true }],
  [
    "a stamped manifest changes more than its version",
    "green-manifest",
    { baseLegs: "green", sourceChange: false, manifestEdit: true },
  ],
] as const)("#given %s #then the run keeps the full matrix", (_name, dir, input) => {
  expect(runClassify(dir, input)).toBe("true")
})
