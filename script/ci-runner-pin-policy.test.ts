import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// GitHub moves ubuntu-latest to Ubuntu 26.04 between October 19 and November 19, 2026 (#9928).
// A job may resolve to ubuntu-latest only if the #9928 inventory reviewed it; every other job runs
// on an explicit image (PR CI on ubuntu-26.04, unproven release/deploy paths pinned to ubuntu-24.04).
// A new job that floats on ubuntu-latest, or an entry for a job that no longer does, fails here.
const REVIEWED_UBUNTU_LATEST_JOBS: readonly string[] = [
  "bot-merge.yml/merge",
  "cla.yml/cla",
  "package-labels.yml/ensure-labels",
  "package-labels.yml/label-issue",
  "package-labels.yml/label-pull-request",
  "package-labels.yml/resolve-pr",
  "pr-automation-signal.yml/signal",
  "refresh-model-capabilities.yml/refresh",
  "review-claims.yml/gate",
  "review-claims.yml/reconcile",
  "review-claims.yml/stale-sweep",
  "sisyphus-agent.yml/agent",
  "stats.yml/stats",
]

const WORKFLOWS_DIR = join(import.meta.dir, "..", ".github", "workflows")
const FLOATING = "ubuntu-latest"
const PASSTHROUGH = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/
// 'ubuntu-latest' as an expression result, not as the left side of a `== 'ubuntu-latest'` test.
const RESULT_LITERAL = /(?<!==\s*)'ubuntu-latest'/

interface Job {
  readonly "runs-on"?: unknown
  readonly strategy?: { readonly matrix?: Readonly<Record<string, unknown>> }
}

function matrixValues(job: Job, key: string): readonly unknown[] | "unresolved" {
  const matrix = job.strategy?.matrix
  if (matrix === undefined) return "unresolved"
  const listed = matrix[key]
  const included = Array.isArray(matrix.include)
    ? matrix.include.flatMap((entry) => (typeof entry === "object" && entry !== null && key in entry ? [(entry as Record<string, unknown>)[key]] : []))
    : []
  if (listed !== undefined && !Array.isArray(listed)) return "unresolved"
  return [...(listed ?? []), ...included]
}

/** Whether `runs-on` can select ubuntu-latest; an expression this cannot evaluate counts as floating. */
function floats(job: Job): boolean {
  const labels = Array.isArray(job["runs-on"]) ? job["runs-on"] : [job["runs-on"]]
  return labels.some((label) => {
    if (typeof label !== "string") return label !== undefined
    if (label === FLOATING) return true
    if (!label.includes("${{")) return false
    const passthrough = PASSTHROUGH.exec(label.trim())
    if (passthrough?.[1] !== undefined) {
      const values = matrixValues(job, passthrough[1])
      return values === "unresolved" || values.some((value) => typeof value !== "string" || value === FLOATING)
    }
    return RESULT_LITERAL.test(label)
  })
}

function floatingJobs(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => {
      const workflow = Bun.YAML.parse(readFileSync(join(WORKFLOWS_DIR, file), "utf8")) as { jobs?: Record<string, Job> }
      return Object.entries(workflow.jobs ?? {})
        .filter(([, job]) => floats(job))
        .map(([id]) => `${file}/${id}`)
    })
    .sort()
}

describe("Ubuntu runner pin policy (#9928)", () => {
  test("#given every workflow job #when its runner can resolve to ubuntu-latest #then the #9928 inventory reviewed it", () => {
    expect(floatingJobs()).toEqual([...REVIEWED_UBUNTU_LATEST_JOBS].sort())
  })

  test("#given runner expressions #when classified #then pass-through, mapped and fallback forms are told apart", () => {
    const os = (values: readonly string[]): Job => ({ strategy: { matrix: { os: values } } })
    expect(floats({ "runs-on": "ubuntu-latest" })).toBe(true)
    expect(floats({ "runs-on": "ubuntu-24.04" })).toBe(false)
    expect(floats({ ...os(["ubuntu-latest"]), "runs-on": "${{ matrix.os }}" })).toBe(true)
    expect(floats({ ...os(["ubuntu-22.04", "macos-14"]), "runs-on": "${{ matrix.os }}" })).toBe(false)
    expect(floats({ ...os(["ubuntu-latest"]), "runs-on": "${{ matrix.os == 'ubuntu-latest' && 'ubuntu-26.04' || matrix.os }}" })).toBe(false)
    expect(floats({ "runs-on": "${{ startsWith(matrix.platform, 'darwin-') && 'macos-latest' || 'ubuntu-latest' }}" })).toBe(true)
    expect(floats({ "runs-on": "${{ matrix.os }}" })).toBe(true)
  })
})
