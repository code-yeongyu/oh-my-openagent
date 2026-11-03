// Test child for facts-applied-recovery.test.ts: a fresh engine process running the facts
// extractor's own session-start reconcile over an identity whose onboarding apply was interrupted.
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner } from "./facts-runner"

const root = process.argv[2]
if (root === undefined) process.exit(2)

const runner = new FactsExtractorRunner({
  identity: { id: "apply-agent", safeSlug: "apply-agent", paths: buildIdentityPaths(root, "apply-agent") },
  cwd: root,
  loadConfig: () => ({ config: {}, diagnostics: [], layers: [], sources: [] }),
  resolveModelRegistry: () => undefined,
  logger: { info() {}, warn: (message, fields) => { console.error(message, JSON.stringify(fields)) }, error() {} },
})
const result = await runner.reconcilePending()
process.exit(result.status === "empty" ? 0 : 1)
