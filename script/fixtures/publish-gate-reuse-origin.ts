import { spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A real git origin for publish-gate-reuse-ci-basis-waiver.test.ts: the gate-reuse waiver fetches,
// checks ancestry and diffs real commits, so its delta rule is exercised against git, not a stub.

function file(path: string, body: string): string {
  return `M 100644 inline ${path}\ndata ${Buffer.byteLength(body)}\n${body}\n`
}

/**
 * A: base. B: workflow-only on A. C: source change on B. D: workflow-only sibling of B.
 * E: a non-workflow .github/ change on B. R: A with a source file renamed into .github/workflows/.
 * Built by one fast-import stream: two git processes, so the fixture stays cheap on a loaded runner.
 */
const COMMITS = [
  ["A", "main", "", file("src/a.ts", "a\n") + file(".github/workflows/publish.yml", "on: workflow_dispatch\n")],
  ["B", "main", "A", file(".github/workflows/publish.yml", "on: workflow_dispatch\n# waiver\n")],
  ["C", "main", "B", file("src/a.ts", "c\n")],
  ["D", "sibling", "A", file(".github/workflows/ci.yml", "on: push\n")],
  ["E", "scripts", "B", file(".github/scripts/summary.sh", "echo\n")],
  ["R", "rename", "A", `D src/a.ts\n${file(".github/workflows/a.yml", "a\n")}`],
] as const

export type CommitName = (typeof COMMITS)[number][0]

export interface GitOrigin {
  /** Hermetic git environment: no system or user config. */
  readonly gitEnv: Readonly<Record<string, string>>
  readonly sha: Readonly<Record<CommitName, string>>
  /** Makes `dir` an empty repository whose `origin` is this fixture, like a depth-1 Actions checkout before fetch. */
  readonly initCheckout: (dir: string) => void
}

export function createGitOrigin(root: string): GitOrigin {
  const gitConfig = join(root, "gitconfig")
  writeFileSync(gitConfig, "")
  const gitEnv = { PATH: process.env.PATH ?? "", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitConfig }
  const git = (cwd: string, args: readonly string[], input?: string): void => {
    const result = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8", input })
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: status=${result.status} signal=${result.signal} ${result.stderr}`)
    }
  }

  const origin = join(root, "origin.git")
  git(root, ["init", "-q", "--bare", origin])
  appendFileSync(join(origin, "config"), "[uploadpack]\n\tallowAnySHA1InWant = true\n")
  const markOf = (name: string): number => COMMITS.findIndex(([candidate]) => candidate === name) + 1
  const stream = COMMITS.map(([name, branch, parent, files]) => {
    const from = parent ? `from :${markOf(parent)}\n` : ""
    const header = `commit refs/heads/${branch}\nmark :${markOf(name)}\ncommitter t <t@example.invalid> 1700000000 +0000\n`
    return `${header}data ${name.length}\n${name}\n${from}${files}\n`
  }).join("")
  const marks = join(root, "marks")
  git(origin, ["fast-import", "--quiet", `--export-marks=${marks}`], stream)

  const sha: Record<CommitName, string> = { A: "", B: "", C: "", D: "", E: "", R: "" }
  for (const line of readFileSync(marks, "utf8").trim().split("\n")) {
    const [mark, id] = line.split(" ")
    const entry = COMMITS[Number(mark?.slice(1)) - 1]
    if (entry && id) sha[entry[0]] = id
  }

  const remote = `[remote "origin"]\n\turl = file://${origin.replaceAll("\\", "/")}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
  const initCheckout = (dir: string): void => {
    mkdirSync(dir)
    git(dir, ["init", "-q"])
    appendFileSync(join(dir, ".git", "config"), remote)
  }
  return { gitEnv, sha, initCheckout }
}
