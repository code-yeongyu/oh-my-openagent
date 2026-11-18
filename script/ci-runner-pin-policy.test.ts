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
  "pr-automation-signal.yml/signal",
  "refresh-model-capabilities.yml/refresh",
  "review-claims.yml/gate",
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

// A matrix expression can yield any quoted JSON it holds: each list of a `fromJSON(cond && '[...]' || '[...]')`
// (#13802), and each object-list argument of a `fromJSON(format('[{0}{1}]', cond && '{...},' || '', '{...}'))`
// (#13928), whose template is not JSON itself. A literal that does not parse leaves the matrix unresolved, and so does a
// template holding anything beyond `{N}` placeholders, brackets and commas: a `{{ }}`-escaped leg in it is unreadable here.
const FORMAT_TEMPLATE = /format\(\s*'([^']*)'/g
const PLACEHOLDER_TEMPLATE = /^(?:\{\d+\}|[[\],\s])*$/
const JSON_LITERAL = /'([[{][^']*)'/g

function parseLiteral(literal: string): readonly unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(literal.startsWith("[") ? literal : `[${literal.replace(/,\s*$/, "")}]`)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function literalLists(value: unknown): readonly unknown[] | undefined {
  if (typeof value !== "string") return Array.isArray(value) ? value : undefined
  const templates = [...value.matchAll(FORMAT_TEMPLATE)].map((match) => match[1] ?? "")
  if (templates.some((template) => !PLACEHOLDER_TEMPLATE.test(template))) return undefined
  const lists = [...value.replace(FORMAT_TEMPLATE, "format(").matchAll(JSON_LITERAL)].map((match) =>
    parseLiteral(match[1] ?? ""),
  )
  return lists.length === 0 || lists.includes(undefined) ? undefined : lists.flatMap((list) => list ?? [])
}

function matrixValues(job: Job, key: string): readonly unknown[] | "unresolved" {
  const matrix = job.strategy?.matrix
  if (matrix === undefined) return "unresolved"
  const listed = matrix[key] === undefined ? [] : literalLists(matrix[key])
  const include = matrix.include === undefined ? [] : literalLists(matrix.include)
  if (listed === undefined || include === undefined) return "unresolved"
  const included = include.flatMap((entry) =>
    typeof entry === "object" && entry !== null && key in entry ? [(entry as Record<string, unknown>)[key]] : [],
  )
  return [...listed, ...included]
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
  test("#given macOS status matrices #when required contexts are preserved #then their physical runner stays pinned to Ubuntu", () => {
    const workflow = Bun.YAML.parse(readFileSync(join(WORKFLOWS_DIR, "ci.yml"), "utf8")) as {
      jobs: Record<string, Job>
    }
    for (const id of ["macos-test-1-status", "macos-test-2-status", "macos-codex-status", "macos-senpi-status"]) {
      expect(workflow.jobs[id]?.["runs-on"]).toBe("ubuntu-26.04")
    }
  })

  test("#given every workflow job #when its runner can resolve to ubuntu-latest #then the #9928 inventory reviewed it", () => {
    expect(floatingJobs()).toEqual([...REVIEWED_UBUNTU_LATEST_JOBS].sort())
  })

  test("#given runner expressions #when classified #then pass-through, mapped and fallback forms are told apart", () => {
    const os = (values: readonly string[]): Job => ({ strategy: { matrix: { os: values } } })
    expect(floats({ "runs-on": "ubuntu-latest" })).toBe(true)
    expect(floats({ "runs-on": "ubuntu-24.04" })).toBe(false)
    expect(floats({ ...os(["ubuntu-latest"]), "runs-on": "${{ matrix.os }}" })).toBe(true)
    expect(floats({ ...os(["ubuntu-22.04", "macos-14"]), "runs-on": "${{ matrix.os }}" })).toBe(false)
    expect(
      floats({
        ...os(["ubuntu-latest"]),
        "runs-on": "${{ matrix.os == 'ubuntu-latest' && 'ubuntu-26.04' || matrix.os }}",
      }),
    ).toBe(false)
    expect(
      floats({ "runs-on": "${{ startsWith(matrix.platform, 'darwin-') && 'macos-latest' || 'ubuntu-latest' }}" }),
    ).toBe(true)
    expect(floats({ "runs-on": "${{ matrix.os }}" })).toBe(true)
  })

  test("#given a format() matrix include #when its runners are read #then every object-list argument is a leg and the template is not", () => {
    const runner = (include: string): Job => ({ "runs-on": "${{ matrix.runner }}", strategy: { matrix: { include } } })
    // publish-platform.yml desktop-engine include (#13928), read from the workflow: the darwin legs must resolve to their pinned image.
    const publishPlatform = (
      Bun.YAML.parse(readFileSync(join(WORKFLOWS_DIR, "publish-platform.yml"), "utf8")) as { jobs: Record<string, Job> }
    ).jobs["desktop-engine"]
    if (publishPlatform === undefined) throw new Error("publish-platform.yml has no desktop-engine job")
    expect(matrixValues(publishPlatform, "runner")).toEqual([
      "macos-15",
      "macos-15",
      "ubuntu-22.04",
      "ubuntu-22.04-arm",
      "windows-latest",
      "windows-11-arm",
    ])
    expect(floats(publishPlatform)).toBe(false)
    const floatingArg = runner(
      "${{ fromJSON(format('[{0}{1}]', inputs.x == '' && '{\"runner\":\"macos-15\"},' || '', '{\"runner\":\"ubuntu-latest\"}')) }}",
    )
    expect(floats(floatingArg)).toBe(true)
    const unparseableArg = runner(
      "${{ fromJSON(format('[{0}{1}]', inputs.x == '' && '{\"runner\":' || '', '{\"runner\":\"ubuntu-24.04\"}')) }}",
    )
    expect(matrixValues(unparseableArg, "runner")).toBe("unresolved")
    expect(floats(unparseableArg)).toBe(true)
    // A leg written into the template through the `{{ }}` escape is a runner the inventory cannot read (#13981 review).
    const templateLeg = runner(
      '${{ fromJSON(format(\'[{{"runner":"ubuntu-latest"}},{0}]\', \'{"runner":"macos-15"}\')) }}',
    )
    expect(matrixValues(templateLeg, "runner")).toBe("unresolved")
    expect(floats(templateLeg)).toBe(true)
  })
})
