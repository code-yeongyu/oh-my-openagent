import { join } from "node:path"

import { readFileSync } from "../fs/resilient"
import { PERSONA_ASSET_FILENAMES, type PersonaAssetKind } from "./manifest"

// The persona markdown ships beside the bundle, but the tree it lives in is mutable while the
// process runs: a global install replaces it in place and the omob launcher rebuilds and prunes
// runtime dirs. Reading each asset at most once per process pins every later child launch to the
// tree the process started from, so a swap, prune or rename cannot turn the next launch into an
// ENOENT. A failed read is never cached, so a repaired tree recovers without a restart.
const contentByPath = new Map<string, string>()

export function loadPersonaAsset(assetsDir: string, kind: PersonaAssetKind): string {
  const path = join(assetsDir, PERSONA_ASSET_FILENAMES[kind])
  const cached = contentByPath.get(path)
  if (cached !== undefined) return cached
  const content = readFileSync(path, "utf8")
  contentByPath.set(path, content)
  return content
}
