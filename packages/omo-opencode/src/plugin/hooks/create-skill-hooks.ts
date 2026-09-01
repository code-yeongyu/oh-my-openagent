import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { PluginContext } from "../types"

import { createAutoSlashCommandHook, createCategorySkillReminderHook } from "../../hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"

export type SkillHooks = {
  categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null
  autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null
}

export function createSkillHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
}): SkillHooks {
  const {
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  } = args

  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const categorySkillReminder = isHookEnabled("category-skill-reminder")
    ? safeHook("category-skill-reminder", () =>
        createCategorySkillReminderHook(ctx, availableSkills))
    : null

  const autoSlashCommand = isHookEnabled("auto-slash-command")
    ? safeHook("auto-slash-command", () =>
        createAutoSlashCommandHook({
          skills: mergedSkills,
          pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
          enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
          directory: ctx.directory,
        }))
    : null

  return { categorySkillReminder, autoSlashCommand }
}
