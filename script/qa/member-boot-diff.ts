import { readFileSync, writeFileSync } from "node:fs"

type Graph = { launch: number; stage: string; elapsed_ms: number; modules: string[] }
type Profile = { head: string; platform: string; bun: string; graphs: Graph[] }

export function compareMemberBoot(base: Profile, candidate: Profile) {
  if (base.platform !== candidate.platform || base.bun !== candidate.bun) throw new Error("Boot profiles require the same platform and Bun version")
  const differences = []
  for (const launch of [1, 2]) {
    for (const stage of ["bootstrap", "provider_registered", "session_start"]) {
      const before = base.graphs.find(graph => graph.launch === launch && graph.stage === stage)
      const after = candidate.graphs.find(graph => graph.launch === launch && graph.stage === stage)
      if (!before || !after) throw new Error(`Missing boot graph: launch=${launch} stage=${stage}`)
      const baseModules = new Set(before.modules)
      const candidateModules = new Set(after.modules)
      differences.push({ launch, stage, base_count: before.modules.length, candidate_count: after.modules.length,
        base_elapsed_ms: before.elapsed_ms, candidate_elapsed_ms: after.elapsed_ms,
        added: [...candidateModules].filter(path => !baseModules.has(path)).sort(),
        removed: [...baseModules].filter(path => !candidateModules.has(path)).sort(),
      })
    }
  }
  return { base: base.head, candidate: candidate.head, platform: base.platform, bun: base.bun, differences }
}

if (import.meta.main) {
  const [base, candidate, output] = process.argv.slice(2)
  if (!base || !candidate || !output) throw new Error("Usage: bun script/qa/member-boot-diff.ts <base.json> <candidate.json> <output.json>")
  const result = compareMemberBoot(JSON.parse(readFileSync(base, "utf8")), JSON.parse(readFileSync(candidate, "utf8")))
  writeFileSync(output, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, differences: result.differences.map(({ removed, ...difference }) => ({
    ...difference, removed_count: removed.length,
  })) }))
}
