import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { z } from "zod"
import { discoverTestFiles } from "./ci-test-discovery.ts"

// Partition contract of the macOS root tests (#14849): the parallel macOS jobs together run every root test file the
// unsplit root suite runs, each file exactly once. The reference is independent of the macOS split: shard 1 is the
// Windows shard-1 invocation in ci.yml (`bun test packages/omo-opencode packages/memory-core`), shard 2 is
// ci-root-shard-2.sh in its unsplit `all` mode (the serial quarantine, then the remainder). Each macOS job's files are
// derived from its root test steps in ci.yml, the bunfig each command names, and the shard-2 script modes.
// The LSP, Codex and Senpi suites are whole steps, each pinned to exactly one job by ci-macos-combined.test.ts.

const stepSchema = z.object({ id: z.string().optional(), run: z.string().optional() })
const { jobs } = z
  .object({ jobs: z.record(z.string(), z.object({ "runs-on": z.unknown(), steps: z.array(stepSchema) })) })
  .parse(Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")))
const shard2Script = readFileSync(new URL("../.github/scripts/ci-root-shard-2.sh", import.meta.url), "utf8")

interface Invocation {
  readonly config: string
  readonly filters: readonly string[]
}

// One `bun [--config=<file>] test <flags and filters>` command line; an unmodeled flag fails instead of being guessed.
function parseBunTest(line: string): Invocation {
  const tokens = line
    .replace(/\$\(junit [^)]*\)/g, "")
    .trim()
    .split(/\s+/)
  if (tokens[0] !== "bun") throw new Error(`not a bun command: ${line}`)
  let config = "bunfig.toml"
  let index = 1
  for (; tokens[index] !== "test"; index++) {
    const token = tokens[index]
    if (token === undefined || !token.startsWith("--config=")) throw new Error(`unmodeled bun command: ${line}`)
    config = token.slice("--config=".length)
  }
  const filters: string[] = []
  for (index++; index < tokens.length; index++) {
    const token = tokens[index] ?? ""
    if (token === "--timeout") index++
    else if (token.startsWith("--") && token.includes("=")) continue
    else if (token.startsWith("-")) throw new Error(`unmodeled bun test flag ${token}: ${line}`)
    else filters.push(token)
  }
  return { config, filters }
}

// The bun commands of every flat if-block of ci-root-shard-2.sh whose condition names this mode.
function shard2Invocations(mode: string): Invocation[] {
  const blocks = [...shard2Script.matchAll(/^if (.+); then\n([\s\S]*?)^fi$/gm)]
  const selected = blocks.filter(([, condition = ""]) =>
    [...condition.matchAll(/"\$mode" = "([a-z]+)"/g)].some(([, name]) => name === mode),
  )
  if (selected.length === 0) throw new Error(`ci-root-shard-2.sh has no ${mode} block`)
  return selected.flatMap(([, , body = ""]) =>
    body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("bun "))
      .map(parseBunTest),
  )
}

function stepInvocations(run: string): Invocation[] {
  return run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("mkdir -p "))
    .flatMap((line) => {
      const shard2 = /^bash \.github\/scripts\/ci-root-shard-2\.sh ([a-z]+)$/.exec(line)
      if (shard2?.[1] !== undefined) return shard2Invocations(shard2[1])
      if (line.startsWith("bun ")) return [parseBunTest(line)]
      throw new Error(`unmodeled root test line: ${line}`)
    })
}

function files(invocations: readonly Invocation[]): string[] {
  return invocations.flatMap(({ config, filters }) => [...discoverTestFiles(config, filters)])
}

function windowsShard1(): Invocation {
  const run = jobs["test"]?.steps.find((step) => step.id === "root-tests-windows-1")?.run ?? ""
  const args = /-TestArguments @\(([^)]*)\)/.exec(run)?.[1]
  if (args === undefined) throw new Error("ci.yml Windows shard 1 has no -TestArguments")
  return parseBunTest(
    `bun ${args
      .split(",")
      .map((arg) => arg.trim().replace(/^"|"$/g, ""))
      .join(" ")}`,
  )
}

function macosRootJobs(): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [id, job] of Object.entries(jobs)) {
    if (job["runs-on"] !== "macos-latest") continue
    const rootSteps = job.steps.filter((step) => step.id?.startsWith("root-tests-posix-"))
    if (rootSteps.length > 0) result.set(id, files(rootSteps.flatMap((step) => stepInvocations(step.run ?? ""))))
  }
  return result
}

function counts(list: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const file of list) result.set(file, (result.get(file) ?? 0) + 1)
  return result
}

describe("macOS root test partition across the parallel macOS jobs (#14849)", () => {
  const reference = files([windowsShard1(), ...shard2Invocations("all")])
  const macos = macosRootJobs()

  test("#given the unsplit root suite #when its files are listed #then the reference is non-empty and duplicate-free", () => {
    expect(reference.length).toBeGreaterThan(0)
    expect([...counts(reference)].filter(([, count]) => count > 1).map(([file]) => file)).toEqual([])
  })

  test("#given the macOS jobs #when their root files are compared #then they run in at least two jobs and share no file", () => {
    expect(macos.size).toBeGreaterThanOrEqual(2)
    const shared: string[] = []
    const ids = [...macos.keys()]
    for (const [index, id] of ids.entries()) {
      const own = new Set(macos.get(id))
      for (const other of ids.slice(index + 1)) {
        for (const file of macos.get(other) ?? []) if (own.has(file)) shared.push(`${id} & ${other}: ${file}`)
      }
    }
    expect(shared.sort()).toEqual([])
  })

  test("#given the macOS jobs #when every root step's files are counted #then each reference file runs exactly once", () => {
    const ran = counts([...macos.values()].flat())
    const expected = new Set(reference)
    expect({
      duplicated: [...ran]
        .filter(([, count]) => count > 1)
        .map(([file]) => file)
        .sort(),
      missing: reference.filter((file) => !ran.has(file)).sort(),
      unexpected: [...ran.keys()].filter((file) => !expected.has(file)).sort(),
    }).toEqual({ duplicated: [], missing: [], unexpected: [] })
  })
})
