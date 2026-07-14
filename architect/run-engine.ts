// MaTrix Architect — Self-Improvement Engine Runner (Level 1).
//
// Invokes the EXISTING engine functions from
// packages/omo-opencode/src/features/self-improvement/engine.ts
// WITHOUT modifying engine source or rebuilding the plugin:
//   - recurring errors  -> detectRecurringErrors -> applyLevel1 (persist to .matrix/vault/learnings.jsonl)
//   - high-cost calls    -> detectHighCostTasks   -> applyLevel1
//
// Must run with CWD=/home/shiro so the engine's relative .matrix/ paths resolve.
import {
  readErrorSignals,
  detectRecurringErrors,
  detectHighCostTasks,
  applyLevel1,
  readLearnings,
} from "/home/shiro/matrix-port/packages/omo-opencode/src/features/self-improvement/engine.ts"
import { readFileSync, existsSync } from "node:fs"

const HOME = "/home/shiro"
const costPath = `${HOME}/.matrix/logs/cost.jsonl`

async function main() {
  // L1 — recurring errors
  const signals = readErrorSignals()
  const errProposals = detectRecurringErrors(signals, { minOccurrences: 3, windowDays: 7 })
  let applied = 0
  for (const p of errProposals) {
    const r = await applyLevel1(p)
    if (r.applied) applied++
  }

  // L1 — high-cost tasks from cost.jsonl
  let costProposals = []
  if (existsSync(costPath)) {
    const lines = readFileSync(costPath, "utf8").split("\n").filter(Boolean)
    const records = lines
      .map((l) => JSON.parse(l))
      .map((r) => ({
        agent: r.agent ?? "unknown",
        model: r.model ?? r.provider ?? "unknown",
        totalCost: Number(r.total_cost ?? r.totalCost ?? 0),
      }))
    costProposals = detectHighCostTasks(records, { thresholdUsd: 0.5, minOccurrences: 2 })
    for (const p of costProposals) {
      const r = await applyLevel1(p)
      if (r.applied) applied++
    }
  }

  const learnings = readLearnings()
  console.log(
    `[architect-engine] signals=${signals.length} errProposals=${errProposals.length} costProposals=${costProposals.length} applied=${applied} totalLearnings=${learnings.length}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
