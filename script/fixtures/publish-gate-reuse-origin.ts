import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process"
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A real git origin for publish-gate-reuse-ci-basis-waiver.test.ts: the gate-reuse waiver fetches,
// checks ancestry and diffs real commits, so its delta rule is exercised against git, not a stub.

function file(path: string, body: string): string {
  return `M 100644 inline ${path}\ndata ${Buffer.byteLength(body)}\n${body}\n`
}

/**
 * A: base. B: workflow-only on A. C: source change on B. D: workflow-only sibling of B.
 * E: a non-workflow .github/ change on B. R: A with a source file renamed into .github/workflows/. T: version stamp on B.
 * P: a release stamp on A (manifest + changelog). Q: a release stamp on A that also changes source.
 * S: a release stamp on A that also renames a source file into the changelog fragments.
 * Built by one fast-import stream: two git processes, so the fixture stays cheap on a loaded runner.
 */
const COMMITS = [
  [
    "H", "historical", "",
    [
      file("src/a.ts", "a\n"),
      file(".github/workflows/publish.yml", "on: workflow_dispatch\n"),
      file("package.json", '{"version":"1.0.0"}\n'),
      file("packages/omo-native/package.json", '{"version":"1.0.0-0"}\n'),
    ].join(""),
  ],
  ["O", "historical", "H", file("script/release-state-paths.mjs", 'process.exit(process.argv[2] === "--check" ? 0 : 1)\n')],
  ["HT", "historical-stamp", "H", file("package.json", '{"version":"1.0.1"}\n')],
  ["OT", "older-stamp", "O", file("package.json", '{"version":"1.0.1"}\n')],
  ["HX", "unsafe-stamp", "H", file("src/a.ts", "changed\n") + file("script/release-state-paths.mjs", "process.exit(0)\n")],
  [
    "A", "main", "O",
    file("script/release-state-paths.mjs", readFileSync(new URL("../release-state-paths.mjs", import.meta.url), "utf8")) +
      ["release-push-proof.sh", "release-push-proof.mjs", "release-proof-contract.json"]
        .map((name) => file(`.github/scripts/${name}`, readFileSync(new URL(`../../.github/scripts/${name}`, import.meta.url), "utf8")))
        .join(""),
  ],
  ["B", "main", "A", file(".github/workflows/publish.yml", "on: workflow_dispatch\n# waiver\n")],
  ["C", "main", "B", file("src/a.ts", "c\n")],
  ["D", "sibling", "A", file(".github/workflows/ci.yml", "on: push\n")],
  ["E", "scripts", "B", file(".github/scripts/summary.sh", "echo\n")],
  ["R", "rename", "A", `D src/a.ts\n${file(".github/workflows/a.yml", "a\n")}`],
  ["T", "dev", "B", file("package.json", '{"version":"1.0.1"}\n')],
  ["P", "stamp", "A", file("package.json", '{"version":"1.0.1"}\n') + file("CHANGELOG.md", "## 1.0.1\n") + file("packages/omo-native/package.json", '{"version":"1.0.1-0"}\n')],
  ["Q", "stamp-and-source", "A", file("package.json", '{"version":"1.0.1"}\n') + file("packages/omo-native/package.json", '{"version":"1.0.1-0"}\n') + file("src/a.ts", "q\n")],
  [
    "S",
    "stamp-and-rename",
    "A",
    `D src/a.ts\n${file("changes/a.md", "a\n")}` +
      file("package.json", '{"version":"1.0.1"}\n') +
      file("packages/omo-native/package.json", '{"version":"1.0.1-0"}\n'),
  ],
] as const

export type CommitName = (typeof COMMITS)[number][0]

// Git Bash's mktemp and native children must agree on a directory owned by
// this case, even when the hermetic subprocess env has no Windows TEMP.
export function runReleaseBash(root: string, script: string, options: SpawnSyncOptionsWithStringEncoding) {
  const temp = mkdtempSync(join(root, "runner-temp-"))
  try {
    const command = process.platform === "win32" ? 'RUNNER_TEMP="$(cygpath -u "$RUNNER_TEMP")"; source "$(cygpath -u "$1")"' : 'source "$1"'
    return spawnSync("bash", ["-eo", "pipefail", "-c", command, "bash", script], {
      ...options,
      env: { ...options.env, RUNNER_TEMP: temp, TMPDIR: temp, TEMP: temp, TMP: temp },
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

export interface GitOrigin {
  readonly origin: string
  /** Hermetic git environment: no system or user config. */
  readonly gitEnv: Readonly<Record<string, string>>
  readonly sha: Readonly<Record<CommitName, string>>
  /** Makes `dir` an empty repository whose `origin` is this fixture, like a depth-1 Actions checkout before fetch. */
  readonly initCheckout: (dir: string) => void
}

export function createGitOrigin(root: string, seed?: GitOrigin): GitOrigin {
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
  const sha = seed ? seed.sha : importOrigin(root, origin, git)
  // Copy refs as well as objects: the workflow can push tags without changing the seed or another case.
  if (seed) cpSync(seed.origin, origin, { recursive: true })
  const remote = `[remote "origin"]\n\turl = file://${origin.replaceAll("\\", "/")}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
  const initCheckout = (dir: string): void => {
    mkdirSync(dir)
    git(dir, ["init", "-q"])
    appendFileSync(join(dir, ".git", "config"), remote)
  }
  return { origin, gitEnv, sha, initCheckout }
}

function importOrigin(
  root: string,
  origin: string,
  git: (cwd: string, args: readonly string[], input?: string) => void,
): GitOrigin["sha"] {
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

  const sha: Record<CommitName, string> = {
    H: "", O: "", HT: "", OT: "", HX: "", A: "", B: "", C: "", D: "", E: "", R: "", T: "", P: "", Q: "", S: "",
  }
  for (const line of readFileSync(marks, "utf8").trim().split("\n")) {
    const [mark, id] = line.split(" ")
    const entry = COMMITS[Number(mark?.slice(1)) - 1]
    if (entry && id) sha[entry[0]] = id
  }

  return sha
}
