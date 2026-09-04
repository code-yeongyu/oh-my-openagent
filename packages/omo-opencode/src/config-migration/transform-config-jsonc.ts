import { legacyMigrationHistory } from "./legacy-history"
import { copyRecord, isPlainRecord } from "./record-values"
import { OMO_SCHEMA_URL } from "./schema-url"
import type { ConfigMigrationTransformResult, TransformConfigJsoncSourcesInput } from "./transform-types"

function configDocument(input: TransformConfigJsoncSourcesInput): Record<string, unknown> {
  const configPaths = new Set(input.discovered
    .filter((source) => source.kind === "config-jsonc")
    .map((source) => source.path))
  for (const source of input.sources) {
    if (configPaths.has(source.path) && isPlainRecord(source.value)) return source.value
  }
  return {}
}

function recordAt(document: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
  const value = document[key]
  return isPlainRecord(value) ? copyRecord(value) : undefined
}

export function transformConfigJsoncSources(
  input: TransformConfigJsoncSourcesInput,
): ConfigMigrationTransformResult {
  const legacy = configDocument(input)
  const omo = recordAt(legacy, "[omo]")
  const senpi = recordAt(legacy, "[senpi]")
  const history = legacyMigrationHistory(input.discovered, input.sources)
  const diagnostics = omo !== undefined && senpi !== undefined
    ? ["conflict: [senpi] legacy [omo] kept [senpi]"]
    : []
  return {
    diagnostics,
    document: {
      $schema: OMO_SCHEMA_URL,
      ...(recordAt(legacy, "[opencode]") === undefined ? {} : { "[opencode]": recordAt(legacy, "[opencode]") }),
      ...(recordAt(legacy, "[codex]") === undefined ? {} : { "[codex]": recordAt(legacy, "[codex]") }),
      ...(senpi === undefined && omo === undefined ? {} : { "[senpi]": senpi ?? omo }),
      ...(Object.keys(history).length === 0 ? {} : { legacy_migrations: history }),
    },
  }
}
