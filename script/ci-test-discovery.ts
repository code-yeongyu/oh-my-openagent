import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"

// The test files one `bun --config=<config> test <filters...>` invocation selects, run from the repository root.
// ci-shard-coverage.ts checks recorded shards against it; ci-macos-partition.test.ts checks the macOS jobs with it.

const testName = /[._](?:test|spec)\.(?:[jt]sx?|[cm][jt]s)$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Bun treats a filter that starts with "./" as a path (here: a directory or file under the root) and any other filter
// as a substring of the file path: `bun test packages/omo-senpi` also selects packages/omo-senpi-*/ files.
function selects(filter: string, path: string): boolean {
  if (!filter.startsWith("./")) return path.includes(filter)
  const target = filter.slice(2).replace(/\/+$/, "")
  return path === target || path.startsWith(`${target}/`)
}

export function discoverTestFiles(config: string, filters: readonly string[] = []): Set<string> {
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
      } else if (
        kind?.isFile() &&
        testName.test(entry.name) &&
        (filters.length === 0 || filters.some((filter) => selects(filter, path)))
      ) {
        files.add(path)
      }
    }
  }
  visit("")
  return files
}
