import { sep } from "node:path"

import { canonicalUltraworkDirectiveRelativePath } from "../packages/omo-codex/plugin/scripts/canonical-ultrawork-directive.mjs"

// The cache installer materializes the canonical ultrawork directive into the plugin root only when
// the published payload carries it, and sync-skills.mjs then reads it. lazycodex-ai@5.0.0-beta.43
// shipped that path while oh-my-openagent@5.0.0-beta.43 did not, so the second payload died at
// `npm run sync:skills` with ENOENT while passing this verifier.
export function requiredCodexInstallPaths() {
  return [canonicalUltraworkDirectiveRelativePath.split(sep).join("/")]
}

export function findMissingPayloadPaths(packedPaths, requiredPaths) {
  const packed = new Set(packedPaths)
  return requiredPaths.filter((requiredPath) => !packed.has(requiredPath))
}
