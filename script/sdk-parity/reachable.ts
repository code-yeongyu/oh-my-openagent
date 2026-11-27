import { createResolver } from "../remote-import-guard-resolve"
import { scanRepository } from "../remote-import-guard-scan"

// Committed bundles stand for their build entry: the launcher loads them by path, the scan reads their source.
export const GENERATED_SOURCES: Readonly<Record<string, string>> = {
  "packages/omo-native/bin/lib/service-auth.generated.js": "packages/omo-native/launcher-commands.ts",
}

/** The reachable source set: static, `require()` and literal `import()` edges, generated bundles swapped for their source. */
export function reachableModules(repoRoot: string, entries: readonly string[]): string[] {
  const resolve = createResolver(repoRoot)
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const raw = queue.shift()
    if (raw === undefined) break
    const file = GENERATED_SOURCES[raw] ?? raw
    if (seen.has(file) || !file.startsWith("packages/") || file.includes("/node_modules/")) continue
    seen.add(file)
    const [facts] = scanRepository(repoRoot, [file])
    for (const edge of facts?.edges ?? []) {
      if (edge.typeOnly) continue
      const target = resolve(file, edge.specifier)
      if (target !== undefined) queue.push(target)
    }
  }
  return [...seen].toSorted()
}
