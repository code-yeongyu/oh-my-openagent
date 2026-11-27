import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { z } from "zod"

import { discoverTestFiles } from "./ci-test-discovery.ts"

// Partition contract of the Windows root tests (#15096): the three parallel Windows shards together run every root
// test file the unsplit root suite runs, each file exactly once. The reference is the same one the macOS partition
// pins (ci-macos-partition.test.ts): Windows shard 1 (`bun test packages/omo-opencode packages/memory-core`) plus
// ci-root-shard-2.sh in its unsplit `all` mode (the serial quarantine, then the remainder under bunfig.win2.parallel.toml).
// Shard 2 adds the serial quarantine, the rpc-host invocation (its own process for the Bun segfault workaround), and the
// remainder part A (./script + the smaller packages); shard 3 runs the rest under bunfig.win2.parallel.windows.rest.toml.

const stepSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  if: z.string().optional(),
  uses: z.string().optional(),
  run: z.string().optional(),
})
const { jobs } = z
  .object({ jobs: z.record(z.string(), z.object({ "runs-on": z.unknown(), steps: z.array(stepSchema) })) })
  .parse(Bun.YAML.parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")))
const shard2Script = readFileSync(new URL("../.github/scripts/ci-root-shard-2.sh", import.meta.url), "utf8")

interface Invocation {
  readonly config: string
  readonly filters: readonly string[]
}

const windowsTestArguments = (stepId: string): string[] => {
  const run = jobs["test"]?.steps.find((step) => step.id === stepId)?.run ?? ""
  const args = /-TestArguments @\(([^)]*)\)/.exec(run)?.[1]
  if (args === undefined) throw new Error(`ci.yml Windows step ${stepId} has no -TestArguments`)
  return args
    .split(",")
    .map((arg) => arg.trim().replace(/^"|"$/g, ""))
    .filter((arg) => arg.length > 0)
}

// The bun [--config=...] test ... invocation one telemetry wrapper carries.
const invocationOf = (args: readonly string[]): Invocation => {
  const test = args.indexOf("test")
  if (test === -1) throw new Error(`not a bun test invocation: ${args.join(" ")}`)
  let config = "bunfig.toml"
  const filters: string[] = []
  for (const token of args.slice(0, test)) {
    if (!token.startsWith("--config=")) throw new Error(`unmodeled bun flag ${token}`)
    config = token.slice("--config=".length)
  }
  for (const token of args.slice(test + 1)) {
    if (token === "--parallel") continue
    filters.push(token)
  }
  return { config, filters }
}

const shard2Invocations = (mode: "all"): Invocation[] => {
  const blocks = [...shard2Script.matchAll(/^if (.+); then\n([\s\S]*?)^fi$/gm)]
  const selected = blocks.filter(([, condition = ""]) => condition.includes(`"$mode" = "${mode}"`))
  if (selected.length === 0) throw new Error(`ci-root-shard-2.sh has no ${mode} block`)
  return selected.flatMap(([, , body = ""]) =>
    body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("bun "))
      .map((line) => {
        const tokens = line.replace(/\$\(junit [^)]*\)/g, "").trim().split(/\s+/)
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
      }),
  )
}

const windowsShard1 = (): Invocation => invocationOf(windowsTestArguments("root-tests-windows-1"))

// Shard 2/3: the serial quarantine files, then the rpc-host invocation, then remainder part A.
const windowsShard2 = (): Invocation[] => [
  invocationOf(windowsTestArguments("root-tests-windows-2").slice(0, windowsTestArguments("root-tests-windows-2").indexOf("exit") === -1 ? undefined : undefined)),
]

const windowsShardSteps = (): Invocation[] => {
  const run = jobs["test"]?.steps.find((step) => step.id === "root-tests-windows-2")?.run ?? ""
  const invocations: Invocation[] = []
  for (const [, invocation = "", args = ""] of [
    ...run.matchAll(/-Invocation "([^"]+)"[\s\S]*?-TestArguments @\(([^)]*)\)/g),
  ]) {
    void invocation
    const tokens = args
      .split(",")
      .map((arg) => arg.trim().replace(/^"|"$/g, ""))
      .filter((arg) => arg.length > 0)
    if (tokens[0] === "script/bun-panic-retry.ts") {
      // script/bun-panic-retry.ts --config=... test --parallel ./packages/... : the retry wrapper
      // re-runs the same invocation, so the files it runs are the plain bun test's.
      const config = tokens.find((token) => token.startsWith("--config="))?.slice("--config=".length) ?? "bunfig.toml"
      const test = tokens.indexOf("test")
      invocations.push({ config, filters: tokens.slice(test + 1).filter((token) => token !== "--parallel") })
      continue
    }
    invocations.push(invocationOf(tokens))
  }
  return invocations
}

describe("Windows root test partition across the parallel Windows shards (#15096)", () => {
  const reference = [...new Set([...(function* () {
    for (const invocation of [windowsShard1(), ...shard2Invocations("all")])
      for (const file of discoverTestFiles(invocation.config, invocation.filters)) yield file
  })()])]
  const parts = [
    { id: "shard-1", invocations: [windowsShard1()] },
    { id: "shard-2", invocations: windowsShardSteps() },
    { id: "shard-3", invocations: [invocationOf(windowsTestArguments("root-tests-windows-3"))] },
  ]
  const ran = new Map<string, number>()
  for (const part of parts)
    for (const invocation of part.invocations)
      for (const file of discoverTestFiles(invocation.config, invocation.filters))
        ran.set(file, (ran.get(file) ?? 0) + 1)

  test("#given the unsplit root suite #when its files are listed #then the reference is non-empty", () => {
    expect(reference.length).toBeGreaterThan(0)
  })

  test("#given the three Windows shards #when their files are counted #then each reference file runs exactly once", () => {
    const expected = new Set(reference)
    expect({
      duplicated: [...ran].filter(([, count]) => count > 1).map(([file]) => file).sort(),
      missing: reference.filter((file) => !ran.has(file)).sort(),
      unexpected: [...ran.keys()].filter((file) => !expected.has(file)).sort(),
    }).toEqual({ duplicated: [], missing: [], unexpected: [] })
  })

  test("#given the release proof contract #when a Windows shard skips a step #then the skip is reasoned there", () => {
    // release-push-proof only accepts a skipped step the contract allows by name, so each shard's
    // allowedSkips must list exactly the steps its `if:` keeps from running on windows-latest.
    const { allowedSkips } = z
      .object({ allowedSkips: z.array(z.object({ job: z.string(), steps: z.array(z.string()).optional() })) })
      .parse(JSON.parse(readFileSync(new URL("../.github/scripts/release-proof-contract.json", import.meta.url), "utf8")))
    const steps = jobs["test"]?.steps ?? []
    for (const shard of ["1/3", "2/3", "3/3"]) {
      const skipped = steps
        .map((step) => ({
          name:
            step.name ??
            (step.uses !== undefined ? `Run ${step.uses}` : (step.run ?? "").split("\n").find((line) => line.trim() !== "")?.trim()),
          condition: step.if ?? "",
        }))
        .filter(({ condition }) => {
          if (condition.includes("runner.os != 'Windows'")) return true
          const other = [...condition.matchAll(/matrix\.shard == '([^']+)'/g)].map((match) => match[1])
          return other.length > 0 && !other.includes(shard)
        })
        .map(({ name }) => {
          if (name === undefined) throw new Error("a Windows step has neither name, uses nor a single-line run")
          return name
        })
      expect({ shard, skips: [...new Set(skipped)].sort() }).toEqual({
        shard,
        skips: allowedSkips.flatMap((entry) => (entry.job === `test (windows-latest, ${shard})` ? (entry.steps ?? []) : [])).sort(),
      })
    }
  })
})
