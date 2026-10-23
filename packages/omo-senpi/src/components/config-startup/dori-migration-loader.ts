// The legacy `gateway` -> `dori` rename runs once per machine, so it ships as the `#omo-dori-migration-runtime`
// sidecar instead of in the entry bundle. Startup imports it only when a config file the rename would rewrite still
// declares a `gateway` key; once migrated, that key is gone and later startups never load it.

import type { DoriSectionRename } from "@oh-my-opencode/omo-opencode/config-migration"

export type DoriSectionRenameLoader = () => Promise<DoriSectionRename>

export const DORI_MIGRATION_RUNTIME_ARTIFACT = "extensions/omo-dori-migration.js"

/**
 * A deliberately loose probe that may say yes wrongly (the sidecar then loads and renames nothing) but never says
 * no wrongly: any `gateway` substring, or any `\u` escape (JSON can spell a key's letters only that other way).
 */
export const mayDeclareLegacyGatewayKey = (text: string): boolean => text.includes("gateway") || text.includes("\\u")

/** Stands in for the rename when no config mentions the old section: the plan stays listed and is skipped. */
export const NO_DORI_SECTION_RENAME: DoriSectionRename = {
  shouldRun: () => false,
  transform: () => ({ diagnostics: [], document: {} }),
}

export const loadDoriSectionRename: DoriSectionRenameLoader = async () =>
  (await import("#omo-dori-migration-runtime")).doriSectionRename
