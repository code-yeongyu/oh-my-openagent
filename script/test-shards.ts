import { availableParallelism } from "node:os"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ROOT_TEST_SERIAL_QUARANTINE_PATHS, POSIX_TEST_TIMEOUT_MS } from "./root-test-serial-quarantine"
import {
  createChildRegistry,
  isReentry,
  type KillProcessGroup,
  REENTRY_ENV_VAR,
  shutdownChildren,
  signalExitCode,
  spawnInheritingStdio,
  type SpawnTestGroup,
  type TestFastGroup,
} from "./test-fast"

/**
 * Local sharded run of the whole root suite (#13345).
 *
 * The one-process `bun test --timeout 20000` stays the correctness contract. This runner keeps
 * every test and only spreads them over the machine's cores: the serial quarantine first, in one
 * process, then N ordinary serial `bun test --shard=i/N` processes, each over a contiguous slice
 * of the sorted file list. No `--parallel` (see the root-test comment in ci.yml).
 */

/** Upper bound on derived shards; past it the slowest single file sets the wall time anyway. */
export const MAX_SHARDS = 16

export const SHARDS_ENV_VAR = "OMO_TEST_SHARDS"

/** Per-file timings that balance `--shard` (shared with the hosted CI shards, #13315). */
export const TIMINGS_DIR = ".github/test-timings"

export function shardCount(cores: number, override: string | undefined): number {
  if (override !== undefined && override !== "") {
    const parsed = Number(override)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${SHARDS_ENV_VAR} must be a positive integer, got ${JSON.stringify(override)}`)
    }
    return parsed
  }
  return Math.max(1, Math.min(cores - 1, MAX_SHARDS))
}

/** The default bunfig's ignore list; a CLI `--path-ignore-patterns` replaces it, so it is repeated. */
export function basePathIgnorePatterns(bunfigText: string): string[] {
  const parsed = Bun.TOML.parse(bunfigText) as { test?: { pathIgnorePatterns?: unknown } }
  const patterns = parsed.test?.pathIgnorePatterns
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) {
    throw new Error("bunfig.toml [test].pathIgnorePatterns must be a string array")
  }
  return patterns
}

export interface ShardPlanInput {
  readonly shards: number
  readonly basePatterns: readonly string[]
  readonly timingsFiles: readonly string[]
  readonly reportDir: string
}

export function shardGroups(input: ShardPlanInput): { serial: TestFastGroup; shards: TestFastGroup[] } {
  const timeout = `--timeout=${POSIX_TEST_TIMEOUT_MS}`
  const junit = (name: string) => ["--reporter=junit", `--reporter-outfile=${join(input.reportDir, `${name}.xml`)}`]
  const serial: TestFastGroup = {
    name: "serial-quarantine",
    args: [
      "test",
      timeout,
      ...junit("serial-quarantine"),
      ...ROOT_TEST_SERIAL_QUARANTINE_PATHS.map((path) => `./${path}`),
    ],
  }
  const ignore = [...input.basePatterns, ...ROOT_TEST_SERIAL_QUARANTINE_PATHS].map(
    (pattern) => `--path-ignore-patterns=${pattern}`,
  )
  const timings = input.timingsFiles.map((file) => `--timings=${file}`)
  const shards = Array.from({ length: input.shards }, (_, index) => {
    const name = `shard-${index + 1}`
    return {
      name,
      args: ["test", timeout, `--shard=${index + 1}/${input.shards}`, ...timings, ...ignore, ...junit(name)],
    }
  })
  return { serial, shards }
}

export interface JunitCase {
  readonly id: string
  readonly failed: boolean
}

export function junitCases(xml: string): JunitCase[] {
  const cases: JunitCase[] = []
  // A self-closing <testcase .../> passed or was skipped; an open one carries a <failure> child when it failed.
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = match[1] ?? ""
    const name = /\bname="([^"]*)"/.exec(attrs)?.[1]
    const classname = /\bclassname="([^"]*)"/.exec(attrs)?.[1] ?? ""
    const file = /\bfile="([^"]*)"/.exec(attrs)?.[1] ?? ""
    if (name !== undefined) {
      cases.push({ id: `${file} > ${classname} > ${name}`, failed: (match[2] ?? "").includes("<failure") })
    }
  }
  return cases
}

export interface FailureCheck {
  readonly onlySerial: string[]
  readonly onlyShards: string[]
}

export function compareFailures(serial: readonly JunitCase[], shards: readonly JunitCase[]): FailureCheck {
  const failedIds = (cases: readonly JunitCase[]) => new Set(cases.filter((c) => c.failed).map((c) => c.id))
  const serialFailed = failedIds(serial)
  const shardFailed = failedIds(shards)
  return {
    onlySerial: [...serialFailed].filter((id) => !shardFailed.has(id)),
    onlyShards: [...shardFailed].filter((id) => !serialFailed.has(id)),
  }
}

export interface UnionCheck {
  readonly missing: string[]
  readonly extra: string[]
  readonly duplicated: string[]
}

export function compareUnion(serialIds: readonly string[], shardIds: readonly (readonly string[])[]): UnionCheck {
  const seen = new Map<string, number>()
  for (const id of shardIds.flat()) seen.set(id, (seen.get(id) ?? 0) + 1)
  const serial = new Set(serialIds)
  return {
    missing: [...serial].filter((id) => !seen.has(id)),
    extra: [...seen.keys()].filter((id) => !serial.has(id)),
    duplicated: [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  }
}

export async function runShards(
  spawnGroup: SpawnTestGroup,
  groups: { serial: TestFastGroup; shards: TestFastGroup[] },
  log: (line: string) => void = console.log,
  shutdownSurvivors: () => void | Promise<void> = () => {},
): Promise<number> {
  log(`[test-shards] ${groups.serial.name} first, then ${groups.shards.length} shards in parallel`)
  const serialExit = await spawnGroup(groups.serial)
  try {
    const exits = await Promise.all(groups.shards.map(spawnGroup))
    return serialExit === 0 && exits.every((exit) => exit === 0) ? 0 : 1
  } catch (error) {
    await shutdownSurvivors()
    throw error
  }
}

function existingTimingsFiles(root: string): string[] {
  const dir = join(root, TIMINGS_DIR)
  if (!existsSync(dir)) return []
  return Array.from(new Bun.Glob("*.json").scanSync({ cwd: dir }), (file) => join(TIMINGS_DIR, file)).sort()
}

if (import.meta.main) {
  const verifyIndex = process.argv.indexOf("--verify")
  if (verifyIndex !== -1) {
    // --verify <serial.xml> <reportDir>: compare a serial run's JUnit set with the shards' union.
    const [serialXml, reportDir] = process.argv.slice(verifyIndex + 1)
    if (serialXml === undefined || reportDir === undefined) {
      console.error("usage: bun script/test-shards.ts --verify <serial.xml> <reportDir>")
      process.exit(2)
    }
    const reports = Array.from(new Bun.Glob("*.xml").scanSync({ cwd: reportDir })).sort()
    if (!reports.includes("serial-quarantine.xml") || !reports.some((file) => file.startsWith("shard-"))) {
      console.error(
        `[test-shards] verify: ${reportDir} needs serial-quarantine.xml and shard-*.xml, found ${reports.join(", ") || "none"}`,
      )
      process.exit(2)
    }
    const shardCases = reports.map((file) => junitCases(readFileSync(join(reportDir, file), "utf8")))
    const serialCases = junitCases(readFileSync(serialXml, "utf8"))
    const result = compareUnion(
      serialCases.map((c) => c.id),
      shardCases.map((cases) => cases.map((c) => c.id)),
    )
    const failures = compareFailures(serialCases, shardCases.flat())
    console.log(
      `[test-shards] verify: ${serialCases.length} serial tests; missing ${result.missing.length}, extra ${result.extra.length}, duplicated ${result.duplicated.length}; failed only serially ${failures.onlySerial.length}, failed only in shards ${failures.onlyShards.length}`,
    )
    const differences = [
      ...result.missing.map((id) => `missing ${id}`),
      ...result.extra.map((id) => `extra ${id}`),
      ...result.duplicated.map((id) => `duplicated ${id}`),
      ...failures.onlySerial.map((id) => `failed only serially ${id}`),
      ...failures.onlyShards.map((id) => `failed only in shards ${id}`),
    ]
    for (const line of differences.slice(0, 50)) console.log(`  ${line}`)
    process.exit(differences.length === 0 ? 0 : 1)
  }
  if (isReentry(process.env)) {
    console.error(`[test-shards] re-entry blocked: ${REENTRY_ENV_VAR} is set; refusing to recurse`)
    process.exit(1)
  }
  const root = join(import.meta.dir, "..")
  const reportDir = process.env.OMO_TEST_SHARDS_REPORT_DIR ?? join(root, ".test-shards")
  mkdirSync(reportDir, { recursive: true })
  const groups = shardGroups({
    shards: shardCount(availableParallelism(), process.env[SHARDS_ENV_VAR]),
    basePatterns: basePathIgnorePatterns(readFileSync(join(root, "bunfig.toml"), "utf8")),
    timingsFiles: existingTimingsFiles(root),
    reportDir,
  })
  const registry = createChildRegistry(process.platform)
  const killGroup: KillProcessGroup = (pid, forwarded) => void process.kill(pid, forwarded)
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      console.error(`[test-shards] ${signal} received: terminating shard children`)
      void shutdownChildren(registry, signal, killGroup).then(() => process.exit(signalExitCode(signal)))
    })
  }
  process.exitCode = await runShards(spawnInheritingStdio(registry, console.log), groups, console.log, () => {
    console.error("[test-shards] a shard failed to start: terminating surviving shards")
    return shutdownChildren(registry, "SIGTERM", killGroup)
  })
}
