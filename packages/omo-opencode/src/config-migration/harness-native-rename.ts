import { canonicalizeLegacyHarnessBlocks } from "@oh-my-opencode/omo-config-core"

import type { ConfigMigrationTransformResult } from "./transform-types"

export const HARNESS_NATIVE_RENAME_MIGRATION_ID = "2026-09-harness-native-rename"

export function transformHarnessNativeRename(document: unknown): ConfigMigrationTransformResult {
  const { document: canonicalized, renames } = canonicalizeLegacyHarnessBlocks(document)
  return {
    diagnostics: renames.map((rename) => rename.dropped
      ? `${rename.path} removed: ${rename.canonical} is already configured`
      : `${rename.path} renamed to ${rename.canonical}`),
    document: canonicalized,
  }
}
