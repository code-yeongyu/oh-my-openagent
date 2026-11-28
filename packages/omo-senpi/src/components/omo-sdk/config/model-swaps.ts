import { readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"

import { resolveAgentHome } from "@oh-my-opencode/senpi-task/agent-home"
import { findDiskSessions } from "../../thread/address-book"
import { type JsonRecord, parseSessionLines } from "../../thread/session-facts"
import type { ConfigContext } from "."
import { isModelId } from "./allowlist"

/** A model swap; a model id that is missing or fails the SDK's model-id shape is `null`. */
export type ModelSwap = {
  readonly time: string | null
  readonly reason: "fallback" | "fallback-revert"
  readonly from: string | null
  readonly to: string | null
}

export type ModelSwaps = {
  /** The first `model_change` with no reason, else the first assistant turn's model. */
  readonly launchModel: string | null
  readonly currentModel: string | null
  readonly swaps: readonly ModelSwap[]
  readonly turnsPerModel: Readonly<Record<string, number>>
  /** The last model change was a fallback that has not been reverted. */
  readonly fallbackWindowOpen: boolean
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const shown = (model: string | null | undefined): string | null => (isModelId(model) ? model : null)

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const realPath = (path: string): string | undefined => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * A session record is read only from the agent dir's sessions tree: a path anywhere else answers as a missing record
 * does, so the call cannot tell a caller whether some other file exists or parse it.
 */
function resolveSessionFile(reference: string, context: ConfigContext): string | undefined {
  const agentDir = resolveAgentHome({ env: context.env, homeDir: context.env["HOME"] ?? homedir() })
  const sessions = join(agentDir, "sessions")
  const looksLikePath = reference.endsWith(".jsonl") || isAbsolute(reference) || /[\\/]/.test(reference)
  if (!looksLikePath) return findDiskSessions(sessions, reference, { id_only: true })[0]?.session_path
  const root = realPath(sessions)
  const path = realPath(resolve(context.cwd, reference))
  if (root === undefined || path === undefined || !isFile(path)) return undefined
  const inside = relative(root, path)
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside) ? path : undefined
}

/** The record of `reference` (a path or an id), else of the calling session; undefined when none is found. */
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
  if (entry["type"] !== "message") return undefined
  const message = entry["message"]
  if (typeof message !== "object" || message === null) return undefined
  const record = message as JsonRecord
  return record["role"] === "assistant" ? modelOf(record["provider"], record["model"]) : undefined
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
      if (isModelId(turnModel)) turnsPerModel[turnModel] = (turnsPerModel[turnModel] ?? 0) + 1
      launchModel ??= turnModel
      currentModel ??= turnModel
      continue
    }
    if (entry["type"] !== "model_change") continue
    const to = modelOf(entry["provider"], entry["modelId"])
    if (to === undefined) continue
    const reason = entry["reason"]
    if (reason === undefined && launchModel === null) launchModel = to
    currentModel = to
    lastChangeWasFallback = reason === "fallback"
    if (reason !== "fallback" && reason !== "fallback-revert") continue
    const time = text(entry["timestamp"])
    swaps.push({
      time: time !== undefined && ISO_TIME.test(time) ? time : null,
      reason,
      from: shown(modelOf(entry["originalProvider"], entry["originalModelId"])),
      to: shown(to),
    })
  }
  return {
    launchModel: shown(launchModel),
    currentModel: shown(currentModel),
    swaps,
    turnsPerModel,
    fallbackWindowOpen: lastChangeWasFallback,
  }
}
