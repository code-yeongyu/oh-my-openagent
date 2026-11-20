import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { ENGINE_BEHAVIOURS, type EngineView } from "./engine"
import type { ModelSwaps } from "./model-swaps"

export const ROUTING_KEYS = ["model", "models", "fallback_models", "variant", "reasoning"] as const

const CURATED_AGENTS: readonly string[] = ["explore", "librarian", "plan-consultant", "plan-reviewer"]
const CURATED_AGENT_KEYS: readonly string[] = ["model", "models"]
const DEEP_CATEGORIES = ["deep-low", "deep-high"] as const
const UNSPECIFIED_CATEGORIES = ["unspecified-low", "unspecified-high"] as const
const BULK_ROUTING_ENTRIES = 3
const MODEL_KEYS = ["model", "models", "fallback_models"] as const

export type PolicyRule =
  | "quota_swap"
  | "curated_agent_model"
  | "deep_low_changed"
  | "deep_family"
  | "unspecified_openai"
  | "bulk_routing_rewrite"
  | "speculative_compaction"
  | "compaction_off_still_summarizes"
  | "speculative_fraction_no_effect"
  | "engine_fallback"

export type PolicyFinding = {
  readonly rule: PolicyRule
  readonly severity: "block" | "warn"
  readonly path: string
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type RoutingChange = {
  readonly kind: "categories" | "agents"
  readonly name: string
  readonly key: string
  readonly path: string
}

export type PolicyInput = {
  readonly edited: boolean
  readonly routingChanges: readonly RoutingChange[]
  readonly engineChanges: readonly string[]
  readonly config: OmoConfig
  readonly engine: EngineView
  readonly swaps?: ModelSwaps
}

type DeclaredModel = { readonly key: string; readonly model: string }

function declaredModels(entry: unknown): readonly DeclaredModel[] {
  if (typeof entry !== "object" || entry === null) return []
  const record = entry as Record<string, unknown>
  return MODEL_KEYS.flatMap((key) => {
    const value = record[key]
    const items = Array.isArray(value) ? value : [value]
    return items.flatMap((item): DeclaredModel[] => {
      if (typeof item === "string") return [{ key, model: item }]
      const model = typeof item === "object" && item !== null ? (item as Record<string, unknown>)["model"] : undefined
      return typeof model === "string" ? [{ key, model }] : []
    })
  })
}

const providerOf = (model: string): string | undefined => (model.includes("/") ? model.split("/")[0] : undefined)
const bareId = (model: string): string => model.slice(model.lastIndexOf("/") + 1)
const isGpt = (model: string): boolean => /^gpt/i.test(bareId(model))
const isDeepSeek = (model: string): boolean => /deepseek/i.test(model)
const isOpenAiProvider = (model: string): boolean => /^(openai|chatgpt)/i.test(providerOf(model) ?? "")

function behaviourDetails(
  behaviour: (typeof ENGINE_BEHAVIOURS)[keyof typeof ENGINE_BEHAVIOURS],
  engine: EngineView,
): Readonly<Record<string, unknown>> {
  return {
    engineIssue: behaviour.engineIssue,
    readAtEngineVersion: behaviour.readAtEngineVersion,
    ...(engine.installedEngineVersion === undefined
      ? {}
      : {
          installedEngineVersion: engine.installedEngineVersion,
          installedEngineDiffers: engine.installedEngineDiffers,
        }),
  }
}

function readAtNote(engine: EngineView): string {
  const base = `read at engine ${engine.readAtEngineVersion}`
  return engine.installedEngineDiffers === true
    ? `${base}; the installed engine is ${engine.installedEngineVersion}, so re-check this behaviour there`
    : base
}

function routingFindings(input: PolicyInput): PolicyFinding[] {
  const changes = input.routingChanges
  const findings: PolicyFinding[] = []
  const first = changes[0]
  if (first !== undefined && input.swaps?.fallbackWindowOpen === true)
    findings.push({
      rule: "quota_swap",
      severity: "block",
      path: first.path,
      message: `the session runs on a fallback model (${input.swaps.currentModel ?? "unknown"}) after a quota or overload answer; a routing edit now would re-route around a temporary limit`,
      next_action: "report the swap to the user and wait for the fallback to revert; do not re-route",
      details: { swaps: input.swaps.swaps },
    })
  for (const change of changes) {
    if (change.kind === "agents" && CURATED_AGENTS.includes(change.name) && CURATED_AGENT_KEYS.includes(change.key))
      findings.push({
        rule: "curated_agent_model",
        severity: "block",
        path: change.path,
        message: `${change.name} runs a curated model chain; changing it changes every spawn of that agent`,
        next_action: "leave the curated agent's chain alone unless the user asked for this exact change",
      })
    if (change.kind === "categories" && change.name === "deep-low")
      findings.push({
        rule: "deep_low_changed",
        severity: "block",
        path: change.path,
        message: "deep-low is the default deep lane; changing its routing moves most deep work",
        next_action: "ask the user before changing deep-low routing",
      })
  }
  const entries = [...new Set(changes.map((change) => `${change.kind}.${change.name}`))]
  if (entries.length >= BULK_ROUTING_ENTRIES)
    findings.push({
      rule: "bulk_routing_rewrite",
      severity: "block",
      path: entries[0] ?? "",
      message: `one edit set rewrites the routing of ${entries.length} categories or agents`,
      next_action: "change one or two entries the user named, then check again",
      details: { entries },
    })
  return findings
}

function configFindings(config: OmoConfig): PolicyFinding[] {
  const findings: PolicyFinding[] = []
  for (const name of DEEP_CATEGORIES)
    for (const { key, model } of declaredModels(config.categories?.[name]))
      if (!isGpt(model) && !isDeepSeek(model))
        findings.push({
          rule: "deep_family",
          severity: "warn",
          path: `categories.${name}.${key}`,
          message: `${name} routes to ${model}, which is neither a GPT nor a DeepSeek model`,
          next_action: `route ${name} to a GPT or DeepSeek model, or confirm the choice with the user`,
        })
  for (const name of UNSPECIFIED_CATEGORIES)
    for (const { key, model } of declaredModels(config.categories?.[name]))
      if (isGpt(model) || isOpenAiProvider(model))
        findings.push({
          rule: "unspecified_openai",
          severity: "block",
          path: `categories.${name}.${key}`,
          message: `${name} names the OpenAI model ${model} explicitly`,
          next_action: `remove ${model} from ${name} and keep its builtin chain`,
        })
  return findings
}

function compactionFindings(input: PolicyInput): PolicyFinding[] {
  const { engine } = input
  const findings: PolicyFinding[] = input.engineChanges
    .filter((key) => key.startsWith("compaction."))
    .map((key) => ({
      rule: "speculative_compaction" as const,
      severity: "block" as const,
      path: `engine:${key}`,
      message: `the edit changes the engine's compaction setting ${key}`,
      next_action: "leave the compaction settings as they are unless the user asked for this exact change",
    }))
  if (!engine.compaction.enabled && engine.compaction.speculativeEnabled)
    findings.push({
      rule: "compaction_off_still_summarizes",
      severity: "warn",
      path: "engine:compaction.enabled",
      message: `compaction.enabled is false but background summaries still run because speculativeEnabled is not false (${readAtNote(engine)})`,
      next_action: "set compaction.speculativeEnabled to false as well to stop background summaries",
      details: behaviourDetails(ENGINE_BEHAVIOURS.compactionOffStillSummarizes, engine),
    })
  if (input.engineChanges.includes("compaction.speculativeFraction"))
    findings.push({
      rule: "speculative_fraction_no_effect",
      severity: "warn",
      path: "engine:compaction.speculativeFraction",
      message: `compaction.speculativeFraction has no effect: the engine never reaches the fraction branch (${readAtNote(engine)})`,
      next_action: "drop the speculativeFraction edit; use speculativeEnabled to turn background summaries off",
      details: behaviourDetails(ENGINE_BEHAVIOURS.speculativeFractionNoEffect, engine),
    })
  return findings
}

function engineFallbackFinding(input: PolicyInput): PolicyFinding[] {
  const model = input.swaps?.currentModel
  if (input.edited || model === undefined || model === null || !input.engine.modelFallback) return []
  const bare = bareId(model)
  const chain = input.engine.fallbackChains[model] ?? input.engine.fallbackChains[bare]
  if (chain === undefined || chain.length === 0) return []
  return [
    {
      rule: "engine_fallback",
      severity: "warn",
      path: "engine:retry.modelFallback",
      message: `the session's model ${model} has an engine fallback chain (${chain.join(" -> ")}) and model fallback is on, so a quota or overload answer will swap it`,
      next_action: `to keep the model, set engine retry.modelFallback to false, set retry.fallbackChains.${bare} to [], or set retry.fallbackRevertPolicy to control when it swaps back`,
      details: { model, chain },
    },
  ]
}

export function policyFindings(input: PolicyInput): readonly PolicyFinding[] {
  return [
    ...routingFindings(input),
    ...configFindings(input.config),
    ...compactionFindings(input),
    ...engineFallbackFinding(input),
  ]
}
