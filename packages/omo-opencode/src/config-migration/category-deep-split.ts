import { canonicalizeLegacyCategoryNames } from "@oh-my-opencode/omo-config-core"

import type { ConfigMigrationTransformResult } from "./transform-types"

export const CATEGORY_DEEP_SPLIT_MIGRATION_ID = "2026-09-category-deep-split"

export function transformCategoryDeepSplit(document: unknown): ConfigMigrationTransformResult {
  const { document: canonicalized, renames } = canonicalizeLegacyCategoryNames(document)
  return {
    diagnostics: renames.map((rename) => rename.dropped
      ? `${rename.path} removed: ${rename.canonical} is already configured`
      : `${rename.path} renamed to ${rename.canonical}`),
    document: canonicalized,
  }
}
