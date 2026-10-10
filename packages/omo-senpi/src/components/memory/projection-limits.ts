import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import type { ExternalProjectionLimits } from "@oh-my-opencode/memory-core"

export function projectionLimits(settings: OmoMemorySettings, identity: string): ExternalProjectionLimits {
  const projection = { ...settings.projection, ...settings.agents[identity]?.projection }
  return { maxEntriesPerDirectory: projection.max_entries_per_directory, maxBytes: projection.max_bytes }
}
