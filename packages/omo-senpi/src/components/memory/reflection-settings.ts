import {
  OmoMemorySettingsSchema,
  type OmoMemoryReflection,
  type OmoMemorySettings,
} from "@oh-my-opencode/omo-config-core"

export function resolveMemorySettings(
  settings: OmoMemorySettings | undefined,
): OmoMemorySettings {
  return settings ?? OmoMemorySettingsSchema.parse({})
}

export function resolveAgentReflectionSettings(
  settings: OmoMemorySettings | undefined,
  agentId: string,
): OmoMemoryReflection {
  const resolved = resolveMemorySettings(settings)
  const base = resolved.reflection
  const override = resolved.agents[agentId]?.reflection
  return {
    ...base,
    ...override,
    trigger: {
      ...base.trigger,
      ...override?.trigger,
    },
  }
}
