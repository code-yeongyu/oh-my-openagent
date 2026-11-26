/// <reference types="bun-types" />

// Release contract (#14847): ci.yml's ci-mode step passes --base-platform-green to the classifier. A release-state pull
// request stays on Linux only when its stamp is ONE commit on the pinned source, the pin is on the base branch, the pin's
// completed dev push run succeeded with every macOS/Windows leg run and green, the head is not a fork, and the stamp
// changes only versions. One case per rule; the step runs as written in ci.yml, in a scratch repository, against a stub gh.

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
  "script/release-stamp-strict.mjs",
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
  readonly pinRun?: "success" | "failure" | "in-progress" | "api-error"
  readonly leg?: "success" | "failure" | "skipped"
  readonly sourceChange?: boolean
  readonly extraCommit?: boolean
  readonly pinOffBase?: boolean
  readonly fork?: boolean
  readonly runHeadSha?: "pin" | "other"
  readonly silentChecker?: boolean
}

function runClassify(name: string, input: Case): { readonly fullMatrix: string; readonly log: string } {
  const {
    pinRun = "success",
    leg = "success",
    sourceChange = false,
    extraCommit = false,
    pinOffBase = false,
    fork = false,
    runHeadSha = "pin",
    silentChecker = false,
  } = input
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
  const writeVersions = (version: string) => {
    for (const manifest of ["package.json", "packages/omo-native/package.json"]) {
      mkdirSync(join(repo, dirname(manifest)), { recursive: true })
      writeFileSync(join(repo, manifest), `${JSON.stringify({ name: "x", version }, null, 2)}\n`)
    }
  }
  git("init", "-q", "-b", "dev")
  writeVersions("5.1.81")
  writeFileSync(join(repo, "source.ts"), "export const a = 1\n")
  git("add", "-A")
  git("commit", "-qm", "pin")
  const pin = git("rev-parse", "HEAD")
  git("checkout", "-q", "-b", "stamp")
  if (extraCommit) {
    writeFileSync(join(repo, "CHANGELOG.md"), "# notes\n")
    git("add", "-A")
    git("commit", "-qm", "extra")
  }
  writeVersions("5.1.82")
  if (sourceChange) writeFileSync(join(repo, "source.ts"), "export const a = 2\n")
  git("add", "-A")
  git("commit", "-qm", "stamp")
  const stamp = git("rev-parse", "HEAD")
  git("checkout", "-q", pinOffBase ? "--orphan" : "dev", ...(pinOffBase ? ["other"] : []))
  writeFileSync(join(repo, "later.ts"), "export const b = 1\n")
  git("add", "-A")
  git("commit", "-qm", "dev moved on")
  const base = git("rev-parse", "HEAD")
  const merge = git(
    "commit-tree",
    git("merge-tree", "--write-tree", "--allow-unrelated-histories", base, stamp).split("\n")[0] ?? "",
    "-p",
    base,
    "-p",
    stamp,
    "-m",
    "merge",
  )

  const pinRunRecord = (conclusion: string) => ({
    id: 45252882440,
    created_at: "2026-11-22T00:00:00Z",
    conclusion,
    head_sha: runHeadSha === "pin" ? pin : "0".repeat(40),
    head_branch: "dev",
    event: "push",
    status: "completed",
  })
  const runs = {
    "in-progress": [],
    success: [pinRunRecord("success")],
    failure: [pinRunRecord("failure")],
    "api-error": [],
  }[pinRun]
  writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: runs }))
  writeFileSync(
    join(dir, "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          name: "test (windows-latest, 1/2)",
          conclusion: leg,
          html_url: "u",
          labels: ["windows-latest"],
          steps: leg === "skipped" ? [] : [{ name: "Run tests", conclusion: leg }],
        },
      ],
    }),
  )
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/bash",
      pinRun === "api-error" ? 'echo "gh: Server Error (HTTP 502)" >&2; exit 1' : "",
      // Answers the runs query only for the pin's dev push runs, so a probe at any other commit fails the case.
      'case "$2" in',
      '  *"/jobs?"*) f="$FAKE_DIR/jobs.json" ;;',
      `  *"/runs?"*) for want in head_sha=${pin} branch=dev event=push; do [[ "&\${2#*\\?}&" == *"&$want&"* ]] || { echo "gh: unexpected query $2" >&2; exit 1; }; done; f="$FAKE_DIR/runs.json" ;;`,
      '  *) echo "gh: unexpected endpoint $2" >&2; exit 1 ;;',
      "esac",
      'jq -r "$4" "$f"',
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  writeFileSync(join(dir, "event.json"), JSON.stringify({ pull_request: { changed_files: 3, body: "", labels: [] } }))
  writeFileSync(join(dir, "output"), "")
  // A checker whose main-module guard does not fire exits 0 without judging; only its sentinel is a pass.
  if (silentChecker) writeFileSync(join(repo, "script/release-stamp-strict.mjs"), "")

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
      GITHUB_SHA: merge,
      BASE_SHA: base,
      PR_HEAD_SHA: stamp,
      PR_HEAD_REPO: fork ? "someone/project" : "owner/project",
      HEAD_COMMIT_MESSAGE: "",
      HEAD_REF: "release/v5.1.82-source-state",
      PR_LABELS: "[]",
    },
  })
  if (run.status !== 0) throw new Error(`classify step failed: ${run.stderr}`)
  const fullMatrix = readFileSync(join(dir, "output"), "utf8").match(/^full_matrix=(\w+)$/m)?.[1]
  if (fullMatrix === undefined) throw new Error("classify step wrote no full_matrix output")
  return { fullMatrix, log: `${run.stdout}${run.stderr}` }
}

posixBashTest(
  "#given a one-commit stamp on a pin whose completed dev push run is green, while dev moved on #then it stays on Linux and names the proof run",
  () => {
    const result = runClassify("green", {})
    expect(result.fullMatrix).toBe("false")
    expect(result.log).toContain("proof run 45252882440")
  },
)

posixBashTest.each([
  ["the stamp sits on an extra commit", "extra", { extraCommit: true }],
  ["the stamp changes source", "source", { sourceChange: true }],
  ["the pin's dev push run has not completed", "in-progress", { pinRun: "in-progress" }],
  ["the pin's dev push run failed", "failed-run", { pinRun: "failure" }],
  ["the pin's Windows leg was skipped", "skipped-leg", { leg: "skipped" }],
  ["the pin's Windows leg failed", "red-leg", { leg: "failure" }],
  ["the GitHub API errors", "api-error", { pinRun: "api-error" }],
  ["the head comes from a fork", "fork", { fork: true }],
  ["the pin is not on the base branch", "off-base", { pinOffBase: true }],
  ["the returned run is for another commit", "other-sha", { runHeadSha: "other" }],
  ["the strict checker exits 0 without its sentinel", "silent-checker", { silentChecker: true }],
] as const)("#given %s #then the run keeps the full matrix", (_name, dir, input) => {
  expect(runClassify(dir, input).fullMatrix).toBe("true")
})
