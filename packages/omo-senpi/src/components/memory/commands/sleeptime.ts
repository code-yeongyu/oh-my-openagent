// /sleeptime -- display the resolved memory settings for the bound identity.
//
// Senpi has no Ink overlay equivalent, so this is a read-only view plus the
// config-file path to edit and the manual "reflect now" and "dream" hints
// (porting note 10).

import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { resolveAgentReflectionSettings } from "../reflection-settings"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"

export const SLEEPTIME_OVERRIDE_MARK = " [agent override]"

export interface ResolvedSleeptimeValue<T> {
  readonly value: T
  readonly overridden: boolean
}

export interface ResolvedSleeptimeSettings {
  readonly reflection: {
    readonly enabled: ResolvedSleeptimeValue<boolean>
    readonly stepCount: ResolvedSleeptimeValue<number>
    readonly onCompaction: ResolvedSleeptimeValue<boolean>
    readonly merge: ResolvedSleeptimeValue<string>
    readonly category: ResolvedSleeptimeValue<string>
    readonly timeoutMinutes: ResolvedSleeptimeValue<number>
    readonly sandbox: ResolvedSleeptimeValue<string>
  }
  readonly nudge: {
    readonly enabled: ResolvedSleeptimeValue<boolean>
    readonly everyUserTurns: ResolvedSleeptimeValue<number>
  }
  readonly facts: {
    readonly enabled: ResolvedSleeptimeValue<boolean>
    readonly debounceSettles: ResolvedSleeptimeValue<number>
  }
  readonly dream: {
    readonly enabled: ResolvedSleeptimeValue<boolean>
    readonly idleMinutes: ResolvedSleeptimeValue<number>
    readonly minHoursBetween: ResolvedSleeptimeValue<number>
    readonly shutdownLaunch: ResolvedSleeptimeValue<boolean>
    readonly autoSelectMax: ResolvedSleeptimeValue<number>
    readonly autoSelectMaxChars: ResolvedSleeptimeValue<number>
  }
  readonly people: {
    readonly enabled: ResolvedSleeptimeValue<boolean>
    readonly maxEntries: ResolvedSleeptimeValue<number>
    readonly maxEntryChars: ResolvedSleeptimeValue<number>
  }
  readonly soul: {
    readonly editNotice: ResolvedSleeptimeValue<boolean>
  }
}

function resolved<T>(value: T, overridden: boolean): ResolvedSleeptimeValue<T> {
  return { value, overridden }
}

export function resolveSleeptimeSettings(
  settings: OmoMemorySettings,
  agentId: string,
): ResolvedSleeptimeSettings {
  const agentOverride = settings.agents[agentId]
  const reflection = agentOverride?.reflection
  const nudge = agentOverride?.nudge
  const facts = agentOverride?.facts
  const dream = agentOverride?.dream
  const people = agentOverride?.people
  const soul = agentOverride?.soul
  const effectiveReflection = resolveAgentReflectionSettings(settings, agentId)

  return {
    reflection: {
      enabled: resolved(effectiveReflection.enabled, reflection?.enabled !== undefined),
      stepCount: resolved(
        effectiveReflection.trigger.step_count,
        reflection?.trigger?.step_count !== undefined,
      ),
      onCompaction: resolved(
        effectiveReflection.trigger.on_compaction,
        reflection?.trigger?.on_compaction !== undefined,
      ),
      merge: resolved(effectiveReflection.merge, reflection?.merge !== undefined),
      category: resolved(effectiveReflection.category, reflection?.category !== undefined),
      timeoutMinutes: resolved(
        effectiveReflection.timeout_minutes,
        reflection?.timeout_minutes !== undefined,
      ),
      sandbox: resolved(effectiveReflection.sandbox, reflection?.sandbox !== undefined),
    },
    nudge: {
      enabled: resolved(nudge?.enabled ?? settings.nudge.enabled, nudge?.enabled !== undefined),
      everyUserTurns: resolved(
        nudge?.every_user_turns ?? settings.nudge.every_user_turns,
        nudge?.every_user_turns !== undefined,
      ),
    },
    facts: {
      enabled: resolved(facts?.enabled ?? settings.facts.enabled, facts?.enabled !== undefined),
      debounceSettles: resolved(
        facts?.debounce_settles ?? settings.facts.debounce_settles,
        facts?.debounce_settles !== undefined,
      ),
    },
    dream: {
      enabled: resolved(dream?.enabled ?? settings.dream.enabled, dream?.enabled !== undefined),
      idleMinutes: resolved(dream?.idle_minutes ?? settings.dream.idle_minutes, dream?.idle_minutes !== undefined),
      minHoursBetween: resolved(
        dream?.min_hours_between ?? settings.dream.min_hours_between,
        dream?.min_hours_between !== undefined,
      ),
      shutdownLaunch: resolved(
        dream?.shutdown_launch ?? settings.dream.shutdown_launch,
        dream?.shutdown_launch !== undefined,
      ),
      autoSelectMax: resolved(
        dream?.auto_select_max ?? settings.dream.auto_select_max,
        dream?.auto_select_max !== undefined,
      ),
      autoSelectMaxChars: resolved(
        dream?.auto_select_max_chars ?? settings.dream.auto_select_max_chars,
        dream?.auto_select_max_chars !== undefined,
      ),
    },
    people: {
      enabled: resolved(people?.enabled ?? settings.people.enabled, people?.enabled !== undefined),
      maxEntries: resolved(people?.max_entries ?? settings.people.max_entries, people?.max_entries !== undefined),
      maxEntryChars: resolved(
        people?.max_entry_chars ?? settings.people.max_entry_chars,
        people?.max_entry_chars !== undefined,
      ),
    },
    soul: {
      editNotice: resolved(soul?.edit_notice ?? settings.soul.edit_notice, soul?.edit_notice !== undefined),
    },
  }
}

function mark(setting: ResolvedSleeptimeValue<unknown>): string {
  return setting.overridden ? SLEEPTIME_OVERRIDE_MARK : ""
}

export function registerSleeptimeCommand(pi: SenpiExtensionAPI, deps: MemoryCommandDeps): void {
  pi.registerCommand("sleeptime", {
    description: "Show the resolved sleeptime memory settings for this identity.",
    argumentHint: "",
    handler: async (_args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const { settings, configPath } = deps.loadSettings()
      const agentId = identity.identity
      const values = resolveSleeptimeSettings(settings, agentId)
      const { reflection, nudge, facts, dream, people, soul } = values

      const lines = [
        `# Sleeptime reflection: ${agentId}`,
        "",
        `Reflection: ${reflection.enabled.value ? "on" : "off"}${mark(reflection.enabled)}`,
        `Step trigger: ${reflection.stepCount.value > 0 ? `every ${reflection.stepCount.value} steps` : "off"}${mark(reflection.stepCount)}`,
        `On compaction: ${reflection.onCompaction.value ? "on" : "off"}${mark(reflection.onCompaction)}`,
        `Merge policy: ${reflection.merge.value}${mark(reflection.merge)}`,
        `Category: ${reflection.category.value}${mark(reflection.category)}`,
        `Timeout: ${reflection.timeoutMinutes.value} minutes${mark(reflection.timeoutMinutes)}`,
        `Sandbox: ${reflection.sandbox.value}${mark(reflection.sandbox)}`,
        "",
        `Nudge: ${nudge.enabled.value ? "on" : "off"}${mark(nudge.enabled)}`,
        `Nudge every: every ${nudge.everyUserTurns.value} turns${mark(nudge.everyUserTurns)}`,
        "",
        `Facts: ${facts.enabled.value ? "on" : "off"}${mark(facts.enabled)}`,
        `Facts debounce: debounce ${facts.debounceSettles.value} settles${mark(facts.debounceSettles)}`,
        "",
        `Dream: ${dream.enabled.value ? "on" : "off"}${mark(dream.enabled)}`,
        `Dream idle: idle ${dream.idleMinutes.value} minutes${mark(dream.idleMinutes)}`,
        `Dream spacing: min ${dream.minHoursBetween.value}h between${mark(dream.minHoursBetween)}`,
        `Dream shutdown: shutdown launch ${dream.shutdownLaunch.value ? "on" : "off"}${mark(dream.shutdownLaunch)}`,
        `Dream select: select max ${dream.autoSelectMax.value}${mark(dream.autoSelectMax)}`,
        `Dream select chars: max ${dream.autoSelectMaxChars.value} chars${mark(dream.autoSelectMaxChars)}`,
        "",
        `People: ${people.enabled.value ? "on" : "off"}${mark(people.enabled)}`,
        `People entries: max ${people.maxEntries.value} entries${mark(people.maxEntries)}`,
        `People chars: max ${people.maxEntryChars.value} chars${mark(people.maxEntryChars)}`,
        "",
        `Soul: edit notice ${soul.editNotice.value ? "on" : "off"}${mark(soul.editNotice)}`,
        "",
        `Edit ${configPath ?? "your omo config file"} under memory.reflection, or memory.agents.${agentId} for this identity only.`,
        "Reflect now: /reflect [--recent N | --conversation <ids>] [focus]",
        "Dream now: /dream [--auto|--recent N|--conversation <ids>] [focus]",
      ]
      return respond(ctx, lines.join("\n"))
    },
  })
}
