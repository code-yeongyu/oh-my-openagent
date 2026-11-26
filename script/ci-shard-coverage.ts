import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { discoverTestFiles } from "./ci-test-discovery.ts"

const groups = {
  root: { config: "bunfig.win2.parallel.toml", filter: "", parts: ["remainder-1", "remainder-2"] },
  senpi: { config: "bunfig.toml", filter: "packages/omo-senpi", parts: ["one", "two"] },
} as const
type Group = keyof typeof groups

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

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
    files.set(file, ms)
  }
  return files
}

function verify(group: Group, dir: string): Map<string, number> {
  const { config, filter } = groups[group]
  const expected = discoverTestFiles(config, filter === "" ? [] : [filter])
  const record = (part: string) => readTimings(join(dir, `ci-shard-${group}-${part}`, "ci-shard-record.json"))
  const [one, two] = groups[group].parts
  const first = record(one)
  const second = record(two)
  const combined = new Map([...first, ...second])
  const differences = [
    ...[...first.keys()]
      .filter((file) => second.has(file))
      .sort()
      .map((file) => `duplicate: ${file}`),
    ...[...expected]
      .filter((file) => !combined.has(file))
      .sort()
      .map((file) => `missing: ${file}`),
    ...[...combined.keys()]
      .filter((file) => !expected.has(file))
      .sort()
      .map((file) => `unexpected: ${file}`),
  ]
  if (differences.length > 0) throw new Error(`${group} shard coverage mismatch:\n${differences.join("\n")}`)
  console.log(`${group}: ${expected.size} files match discovery exactly (${first.size} + ${second.size}; no overlap)`)
  return combined
}

const [mode, records, output, ...extra] = process.argv.slice(2)
if (!records || extra.length > 0) {
  throw new Error("Usage: bun script/ci-shard-coverage.ts <root|senpi|merge> <records-dir> [merged-file]")
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
} else {
  throw new Error("Expected root or senpi without an output path, or merge with an output path")
}
