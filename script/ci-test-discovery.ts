import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"

// The test files one `bun --config=<config> test <filters...>` invocation selects, run from the repository root.
// ci-shard-coverage.ts checks recorded shards against it; ci-macos-partition.test.ts and ci-windows-partition.test.ts
// check the macOS and Windows jobs with it.

export interface Invocation {
  readonly config: string
  readonly filters: readonly string[]
}

// The unsplit suites the platform partitions must cover exactly: root shard 1 (omo-opencode + memory-core, which the
// Linux parts and the macOS and Windows jobs each split differently) and the Senpi package suite.
export const ROOT_SHARD_1: Invocation = {
  config: "bunfig.toml",
  filters: ["packages/omo-opencode", "packages/memory-core"],
}
export const SENPI_SUITE: Invocation = { config: "bunfig.toml", filters: ["packages/omo-senpi"] }

// The bun test commands of every flat if-block of .github/scripts/ci-root-shard-2.sh whose condition names this mode.
// Mode "all" is the unsplit root shard 2: the serial quarantine, then the remainder.
export function rootShard2Invocations(mode: string): Invocation[] {
  const script = readFileSync(new URL("../.github/scripts/ci-root-shard-2.sh", import.meta.url), "utf8")
  const blocks = [...script.matchAll(/^if (.+); then\n([\s\S]*?)^fi$/gm)]
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

// The split Windows suites (#14942, #15096): each named invocation writes <name>.timings.json through
// windows-ci-telemetry.ps1 -TimingRecord, and the Linux status job checks the records against the unsplit suite, the
// union of the files its invocations select.
export const WINDOWS_SPLITS = {
  "windows-root": { suite: [ROOT_SHARD_1], records: ["shard-1a", "shard-1b"] },
  "windows-root-2": {
    suite: rootShard2Invocations("all"),
    records: ["shard-2-quarantine", "shard-2-rpc-host", "shard-2a", "shard-2b"],
  },
  "windows-senpi": {
    suite: [SENPI_SUITE],
    records: ["senpi-one", "senpi-two", "senpi-three-worker", "senpi-three-rest"],
  },
} as const satisfies Record<string, { suite: readonly Invocation[]; records: readonly string[] }>
export type WindowsSplit = keyof typeof WINDOWS_SPLITS

export function discoverSuite(suite: readonly Invocation[]): Set<string> {
  return new Set(suite.flatMap(({ config, filters }) => [...discoverTestFiles(config, filters)]))
}

// One `bun [script/bun-panic-retry.ts] [--config=<file>] test <flags and filters>` command line; an unmodeled flag
// fails instead of being guessed. bun-panic-retry.ts re-runs the same bun arguments once only after a Bun crash.
export function parseBunTest(line: string): Invocation {
  const tokens = line
    .replace(/\$\(junit [^)]*\)/g, "")
    .trim()
    .split(/\s+/)
  if (tokens[0] !== "bun") throw new Error(`not a bun command: ${line}`)
  let config = "bunfig.toml"
  let index = tokens[1] === "script/bun-panic-retry.ts" ? 2 : 1
  for (; tokens[index] !== "test"; index++) {
    const token = tokens[index]
    if (token === undefined || !token.startsWith("--config=")) throw new Error(`unmodeled bun command: ${line}`)
    config = token.slice("--config=".length)
  }
  const filters: string[] = []
  for (index++; index < tokens.length; index++) {
    const token = tokens[index] ?? ""
    if (token === "--timeout") index++
    else if (token === "--parallel" || (token.startsWith("--") && token.includes("="))) continue
    else if (token.startsWith("-")) throw new Error(`unmodeled bun test flag ${token}: ${line}`)
    else filters.push(token)
  }
  return { config, filters }
}

export interface TimedInvocation {
  readonly record: string
  readonly invocation: Invocation
}

// Every `windows-ci-telemetry.ps1 -Invocation "<name>" -TimingRecord -TestArguments @(...)` call of one pwsh step.
export function windowsTimedInvocations(run: string): TimedInvocation[] {
  return [...run.matchAll(/-Invocation "([a-z0-9-]+)" `\s*-TimingRecord `\s*-TestArguments @\(([^)]*)\)/g)].map(
    ([, record = "", args = ""]) => ({
      record,
      invocation: parseBunTest(
        `bun ${args
          .split(",")
          .map((arg) => arg.trim().replace(/^"|"$/g, ""))
          .join(" ")}`,
      ),
    }),
  )
}

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
