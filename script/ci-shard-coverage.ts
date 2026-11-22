import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const groups = {
  root: { config: "bunfig.win2.parallel.toml", filter: "", parts: ["remainder-1", "remainder-2"] },
  senpi: { config: "bunfig.toml", filter: "packages/omo-senpi", parts: ["one", "two"] },
} as const
type Group = keyof typeof groups

const testName = /[._](?:test|spec)\.(?:[jt]sx?|[cm][jt]s)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function discover({ config, filter }: (typeof groups)[Group]): Set<string> {
  const parsed: unknown = Bun.TOML.parse(readFileSync(config, "utf8"))
  const test = isRecord(parsed) ? parsed["test"] : undefined
  const patterns = isRecord(test) ? test["pathIgnorePatterns"] : undefined
  if (!Array.isArray(patterns)) throw new Error(`${config} must define test.pathIgnorePatterns`)
  const ignores = patterns.map((pattern: unknown) => {
    if (typeof pattern !== "string") throw new Error(`${config} has a non-string test.pathIgnorePatterns entry`)
    return new Bun.Glob(pattern)
  })
  const files = new Set<string>()
  const ancestors = new Set([realpathSync(".")])

  function visit(dir: string): void {
    for (const entry of readdirSync(dir || ".", { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (ignores.some((ignore) => ignore.match(path))) continue
      const kind = entry.isSymbolicLink() ? statSync(path, { throwIfNoEntry: false }) : entry
      if (kind?.isDirectory()) {
        // Bun skips dot directories, but still accepts a dot-prefixed test file.
        if (entry.name.startsWith(".") || entry.name.toLowerCase() === "node_modules") continue
        const real = realpathSync(path)
        if (ancestors.has(real)) continue
        ancestors.add(real)
        visit(path)
        ancestors.delete(real)
      } else if (kind?.isFile() && testName.test(entry.name) && path.includes(filter)) {
        // `bun test packages/omo-senpi` is a path substring, not a directory argument.
        files.add(path)
      }
    }
  }
  visit("")
  return files
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
  const expected = discover(groups[group])
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
