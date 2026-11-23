/// <reference types="bun-types" />

// A sparse checkout holds only the files it lists. pr-platform-decision.yml shipped a list without
// release-state-paths.mjs once ci-fast-path.mjs imported it, and every pull request's platform decision died with
// ERR_MODULE_NOT_FOUND. Every script a job's run steps invoke, and its whole relative import graph, must be listed.

import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const workflowsDir = path.join(repoRoot, ".github/workflows")
const relativeSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm
const invokedScript = /\b(?:node|bun|bash)\s+((?:script|scripts|\.github)\/[\w./-]+)/g

type Step = {
  readonly id?: string
  readonly uses?: string
  readonly run?: string
  readonly with?: Record<string, unknown>
}
type Workflow = { readonly jobs?: Record<string, { readonly steps?: readonly Step[] }> }
type SparseJob = { readonly where: string; readonly paths: readonly string[]; readonly steps: readonly Step[] }

function sparseJobs(): SparseJob[] {
  const jobs: SparseJob[] = []
  for (const file of readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = load(readFileSync(path.join(workflowsDir, file), "utf8")) as Workflow
    for (const [job, { steps = [] }] of Object.entries(workflow.jobs ?? {})) {
      for (const step of steps) {
        const sparse = step.with?.["sparse-checkout"]
        if (!step.uses?.startsWith("actions/checkout@") || typeof sparse !== "string") continue
        const paths = sparse
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
        jobs.push({ where: `${file} jobs.${job}`, paths, steps })
      }
    }
  }
  return jobs
}

// Workflow lists use forward slashes on every OS, so a reached path is compared in that form whatever `pathApi` is.
function reachedPath(pathApi: typeof path.posix, from: string, specifier: string): string {
  return pathApi
    .normalize(pathApi.join(pathApi.dirname(from), specifier))
    .split(pathApi.sep)
    .join("/")
}

function importClosure(entry: string): string[] {
  const seen = new Set<string>()
  const pending = [entry]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue
    seen.add(next)
    const source = readFileSync(path.join(repoRoot, next), "utf8")
    for (const match of source.matchAll(relativeSpecifier)) {
      const specifier = match[1]
      if (specifier !== undefined) pending.push(reachedPath(path, next, specifier))
    }
  }
  return [...seen]
}

function invokedScripts(steps: readonly Step[]): string[] {
  return steps
    .flatMap((step) => [...(step.run ?? "").matchAll(invokedScript)].map((match) => match[1] ?? ""))
    .filter((script) => existsSync(path.join(repoRoot, script)))
}

test("#given a relative import #when it is resolved with the posix or the win32 path module #then it matches the workflow's forward-slash entry", () => {
  for (const pathApi of [path.posix, path.win32]) {
    expect(reachedPath(pathApi, "script/ci-fast-path.mjs", "./release-state-paths.mjs")).toBe(
      "script/release-state-paths.mjs",
    )
  }
})

test("#given every sparse workflow checkout #when its run steps load their scripts #then every invoked script and each relative import it reaches is listed", () => {
  // given
  const jobs = sparseJobs()
  expect(jobs.some(({ where }) => where.startsWith("pr-platform-decision.yml"))).toBe(true)

  // when
  const missing = jobs.flatMap(({ where, paths, steps }) => {
    const entries = [...new Set([...paths.filter((entry) => /\.[cm]?js$/.test(entry)), ...invokedScripts(steps)])]
    const reached = new Set(
      entries.flatMap((entry) => (existsSync(path.join(repoRoot, entry)) ? importClosure(entry) : [entry])),
    )
    return [...reached].filter((file) => !paths.includes(file)).map((file) => `${where}: ${file}`)
  })

  // then
  expect(missing).toEqual([])
})

test("#given only the files pr-platform-decision checks out #when its decide step runs the classifier #then it prints a decision", () => {
  // given
  const decide = sparseJobs().find(({ where }) => where === "pr-platform-decision.yml jobs.decide")
  if (decide === undefined) throw new Error("pr-platform-decision.yml must keep its sparse decide job")
  const workspace = mkdtempSync(path.join(tmpdir(), "sparse-decide-"))
  try {
    for (const entry of decide.paths) {
      mkdirSync(path.join(workspace, path.dirname(entry)), { recursive: true })
      copyFileSync(path.join(repoRoot, entry), path.join(workspace, entry))
    }
    writeFileSync(path.join(workspace, "body.md"), "")
    const [entry] = invokedScripts(decide.steps)
    if (entry === undefined) throw new Error("the decide step must invoke a repository script")

    // when
    const run = spawnSync(
      "node",
      [entry, "--event", "pull_request", "--message", "", "--diff-available", "true", "--changed-files", "1"].concat([
        "--merge-parents",
        "2",
        "--head-ref",
        "x",
        "--labels",
        "[]",
        "--body-file",
        "body.md",
      ]),
      { cwd: workspace, input: "README.md\0", encoding: "utf8" },
    )

    // then
    expect(run.stderr).toBe("")
    expect(JSON.parse(run.stdout)).toHaveProperty("fullMatrix")
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
