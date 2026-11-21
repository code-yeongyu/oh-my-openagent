import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import { resolveAgentHome } from "@oh-my-opencode/senpi-task/agent-home"
import { findDiskSessions } from "../../thread/address-book"
import { type JsonRecord, parseSessionLines } from "../../thread/session-facts"
import type { ConfigContext } from "."

export type ModelSwap = {
  readonly time: string
  readonly reason: "fallback" | "fallback-revert"
  readonly from: string
  readonly to: string
  readonly source?: string
  readonly duringTurn?: boolean
}

export type ModelSwaps = {
  readonly session: string
  /** The first `model_change` with no reason, else the first assistant turn's model. */
  readonly launchModel: string | null
  readonly currentModel: string | null
  readonly swaps: readonly ModelSwap[]
  readonly turnsPerModel: Readonly<Record<string, number>>
  /** The last model change was a fallback that has not been reverted. */
  readonly fallbackWindowOpen: boolean
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function resolveSessionFile(reference: string, context: ConfigContext): string | undefined {
  const looksLikePath = reference.endsWith(".jsonl") || isAbsolute(reference) || /[\\/]/.test(reference)
  if (looksLikePath) {
    const path = resolve(context.cwd, reference)
    return isFile(path) ? path : undefined
  }
  const agentDir = resolveAgentHome({ env: context.env, homeDir: context.env.HOME ?? homedir() })
  return findDiskSessions(join(agentDir, "sessions"), reference, { id_only: true })[0]?.session_path
}

export function sessionFileFor(reference: string | undefined, context: ConfigContext): string | undefined {
  const chosen = reference ?? context.currentSession()
  return chosen === undefined ? undefined : resolveSessionFile(chosen, context)
}

const modelOf = (provider: unknown, model: unknown): string | undefined => {
  const id = text(model)
  if (id === undefined) return undefined
  const owner = text(provider)
  return owner === undefined ? id : `${owner}/${id}`
}

function assistantModel(entry: JsonRecord): string | undefined {
  if (entry.type !== "message") return undefined
  const message = entry.message
  if (typeof message !== "object" || message === null) return undefined
  const record = message as JsonRecord
  return record.role === "assistant" ? modelOf(record.provider, record.model) : undefined
}

export function readModelSwaps(path: string): ModelSwaps {
  const entries = parseSessionLines(readFileSync(path, "utf-8"))
  let launchModel: string | null = null
  let currentModel: string | null = null
  let lastChangeWasFallback = false
  const swaps: ModelSwap[] = []
  const turnsPerModel: Record<string, number> = {}
  for (const entry of entries) {
    const turnModel = assistantModel(entry)
    if (turnModel !== undefined) {
      turnsPerModel[turnModel] = (turnsPerModel[turnModel] ?? 0) + 1
      launchModel ??= turnModel
      currentModel ??= turnModel
      continue
    }
    if (entry.type !== "model_change") continue
    const to = modelOf(entry.provider, entry.modelId)
    if (to === undefined) continue
    const reason = entry.reason
    if (reason === undefined && launchModel === null) launchModel = to
    currentModel = to
    lastChangeWasFallback = reason === "fallback"
    if (reason !== "fallback" && reason !== "fallback-revert") continue
    swaps.push({
      time: text(entry.timestamp) ?? "",
      reason,
      from: modelOf(entry.originalProvider, entry.originalModelId) ?? "",
      to,
      ...(text(entry.source) === undefined ? {} : { source: text(entry.source) }),
      ...(typeof entry.duringTurn === "boolean" ? { duringTurn: entry.duringTurn } : {}),
    })
  }
  return { session: path, launchModel, currentModel, swaps, turnsPerModel, fallbackWindowOpen: lastChangeWasFallback }
}
