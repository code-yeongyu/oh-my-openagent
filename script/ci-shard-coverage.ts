import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  discoverTestFiles,
  type Invocation,
  SENPI_SUITE,
  WINDOWS_SPLITS,
  type WindowsSplit,
} from "./ci-test-discovery.ts"

// Linux groups: each part uploads one ci-shard-<group>-<part>/ci-shard-record.json artifact.
const groups = {
  root: { suite: { config: "bunfig.win2.parallel.toml", filters: [] }, parts: ["remainder-1", "remainder-2"] },
  senpi: { suite: SENPI_SUITE, parts: ["one", "two"] },
} as const satisfies Record<string, { suite: Invocation; parts: readonly string[] }>
type Group = keyof typeof groups

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Bun writes Windows record keys with backslashes; discovery lists repository paths with forward slashes.
function readTimings(path: string): Map<string, number> {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isRecord(data) || data["version"] !== 1 || !isRecord(data["files"])) {
    throw new Error(`${path}: expected a Bun v1 timing record`)
  }
  const files = new Map<string, number>()
  for (const [file, ms] of Object.entries(data["files"])) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`${path}: invalid duration for ${file}`)
    }
    files.set(file.replaceAll("\\", "/"), ms)
  }
  return files
}

function compare(label: string, suite: Invocation, records: ReadonlyMap<string, Map<string, number>>) {
  const expected = discoverTestFiles(suite.config, suite.filters)
  const seen = new Set<string>()
  const differences: string[] = []
  for (const files of records.values()) {
    for (const file of files.keys()) {
      if (seen.has(file)) differences.push(`duplicate: ${file}`)
      else seen.add(file)
    }
  }
  const combined = new Map([...records.values()].flatMap((files) => [...files]))
  differences.sort()
  differences.push(
    ...[...expected]
      .filter((file) => !combined.has(file))
      .sort()
      .map((file) => `missing: ${file}`),
    ...[...combined.keys()]
      .filter((file) => !expected.has(file))
      .sort()
      .map((file) => `unexpected: ${file}`),
  )
  if (differences.length > 0) throw new Error(`${label} shard coverage mismatch:\n${differences.join("\n")}`)
  const sizes = [...records.values()].map((files) => files.size).join(" + ")
  console.log(`${label}: ${expected.size} files match discovery exactly (${sizes}; no overlap)`)
  return combined
}

function verify(group: Group, dir: string): Map<string, number> {
  const records = new Map(
    groups[group].parts.map((part) => [
      part,
      readTimings(join(dir, `ci-shard-${group}-${part}`, "ci-shard-record.json")),
    ]),
  )
  return compare(group, groups[group].suite, records)
}

// The artifact directory names carry run ids, so each record is found by its file name, exactly once.
function verifyWindows(group: WindowsSplit, dir: string): void {
  const records = new Map<string, Map<string, number>>()
  for (const name of WINDOWS_SPLITS[group].records) {
    const found = [...new Bun.Glob(`**/${name}.timings.json`).scanSync({ cwd: dir })]
    if (found.length !== 1)
      throw new Error(`${group}: expected one ${name}.timings.json under ${dir}, found ${found.length}`)
    records.set(name, readTimings(join(dir, found[0] ?? "")))
  }
  compare(group, WINDOWS_SPLITS[group].suite, records)
}

const [mode, records, output, ...extra] = process.argv.slice(2)
if (!records || extra.length > 0) {
  throw new Error(
    "Usage: bun script/ci-shard-coverage.ts <root|senpi|windows-root|windows-senpi|merge> <records-dir> [merged-file]",
  )
}
if (mode === "merge" && output) {
  const root = verify("root", records)
  const senpi = verify("senpi", records)
  const overlap = [...senpi.keys()].filter((file) => root.has(file)).sort()
  if (overlap.length > 0) throw new Error(`Files ran in both shard groups:\n${overlap.join("\n")}`)
  const files = Object.fromEntries([...root, ...senpi].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  writeFileSync(output, `${JSON.stringify({ version: 1, files }, null, 2)}\n`)
} else if ((mode === "root" || mode === "senpi") && output === undefined) {
  verify(mode, records)
} else if ((mode === "windows-root" || mode === "windows-senpi") && output === undefined) {
  verifyWindows(mode, records)
} else {
  throw new Error(
    "Expected root, senpi, windows-root or windows-senpi without an output path, or merge with an output path",
  )
}
