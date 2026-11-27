import { createResolver, type Resolver } from "../remote-import-guard-resolve"
import { scanRepository } from "../remote-import-guard-scan"
import { type ArgvFinding, GENERATED_SOURCES } from "./native-inventory"
import type { Row } from "./schema"

// Design 7.4, "what counts as changed": a capability's closure is the import closure of its parse and render modules
// (the adapter files where its routes and flags are dispatched, and its tools' definitions) plus its implementation
// closure (what its SDK member reaches; a row with no SDK member today has none). A pull request that moves any file in
// it changes the capability. Wide by design: an edit to a shared core module marks every capability that reaches it.

const THREAD = "packages/omo-senpi/src/components/thread/"
const TOOL_ADAPTERS = [`${THREAD}tools.ts`, `${THREAD}contracts/params.ts`, `${THREAD}contracts/create-params.ts`]
const SDK_ENTRIES: Readonly<Record<string, readonly string[]>> = {
  threads: [`${THREAD}sdk.ts`, "packages/omo-senpi/src/components/remote/index.ts"],
  devices: ["packages/omo-senpi/src/components/omo-sdk/index.ts", "packages/omo-senpi/src/components/remote/index.ts"],
  deviceService: [
    "packages/omo-senpi/src/components/omo-sdk/index.ts",
    "packages/omo-senpi/src/components/remote/index.ts",
  ],
  account: ["packages/omo-senpi/src/components/omo-sdk/index.ts"],
  config: ["packages/omo-senpi/src/components/omo-sdk/index.ts"],
  toolkit: ["packages/omo-codex/plugin/components/ulw-loop/src/sdk.ts"],
}

export class ImportGraph {
  private readonly edges = new Map<string, readonly string[]>()
  private readonly resolve: Resolver

  constructor(private readonly root: string) {
    this.resolve = createResolver(root)
  }

  private next(file: string): readonly string[] {
    const known = this.edges.get(file)
    if (known !== undefined) return known
    const [facts] = scanRepository(this.root, [file])
    const out = (facts?.edges ?? [])
      .filter((edge) => !edge.typeOnly)
      .map((edge) => this.resolve(file, edge.specifier))
      .filter((target): target is string => target !== undefined)
      .map((target) => GENERATED_SOURCES[target] ?? target)
      .filter((target) => target.startsWith("packages/") && !target.includes("/node_modules/"))
    this.edges.set(file, out)
    return out
  }

  closure(starts: readonly string[]): Set<string> {
    const seen = new Set<string>()
    const queue = starts.map((file) => GENERATED_SOURCES[file] ?? file)
    while (queue.length > 0) {
      const file = queue.shift()
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      queue.push(...this.next(file))
    }
    return seen
  }
}

// Each surface's findings: the native binary's argv scan, the loop component's, and the OpenCode Commander modules'.
export type SurfaceFindings = {
  readonly native: readonly ArgvFinding[]
  readonly loop: readonly ArgvFinding[]
  readonly commander: readonly ArgvFinding[]
}

function adapterModules(row: Row, findings: SurfaceFindings): string[] {
  const files = new Set<string>()
  for (const entry of row.cli) {
    const tokens = new Set([
      ...entry.route,
      ...Object.entries(entry.flags)
        .filter(([, target]) => target !== "render")
        .map(([flag]) => flag),
    ])
    const surface =
      entry.via === "loop" ? findings.loop : entry.via === "commander" ? findings.commander : findings.native
    for (const finding of surface) if (tokens.has(finding.token)) files.add(finding.file)
  }
  if (row.tool.length > 0) for (const file of TOOL_ADAPTERS) files.add(file)
  return [...files].toSorted()
}

function implementationEntries(row: Row): readonly string[] {
  if (row.today === "no") return []
  return SDK_ENTRIES[row.sdk.split(".")[0] ?? ""] ?? []
}

export function capabilityClosures(
  rows: readonly Row[],
  findings: SurfaceFindings,
  graph: ImportGraph,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.kind !== "capability") continue
    out.set(row.id, graph.closure([...adapterModules(row, findings), ...implementationEntries(row)]))
  }
  return out
}
