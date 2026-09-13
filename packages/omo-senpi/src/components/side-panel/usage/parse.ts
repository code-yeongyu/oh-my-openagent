import { FIVE_HOUR_MS, WEEK_MS } from "../constants"
import { asArray, asRecord, optional } from "../guards"
import type { PanelUsageEntry, PanelUsageWindow } from "./types"

/**
 * Anthropic publishes its windows in `limits[]`. The older `five_hour` / `seven_day` pair is
 * read only when that array says nothing, so a payload that changes shape downgrades the
 * section to whatever it still understands instead of emptying it.
 */
export function parseClaudeUsage(payload: unknown, now: number): PanelUsageEntry {
  const data = asRecord(payload)
  const windows: PanelUsageWindow[] = []
  for (const item of asArray(data?.["limits"])) {
    const limit = asRecord(item)
    if (limit === undefined) continue
    const percent = limit["percent"]
    if (typeof percent !== "number") continue
    const kind = typeof limit["kind"] === "string" ? limit["kind"] : undefined
    const session = kind === "session"
    windows.push({
      label: claudeLabel(kind, limit),
      percent,
      windowMs: session ? FIVE_HOUR_MS : WEEK_MS,
      ...optional("resetsAt", parseInstant(limit["resets_at"])),
      ...(kind === "weekly_scoped" ? { scoped: true } : {}),
    })
  }
  if (windows.length === 0) {
    for (const [key, label, windowMs] of [
      ["five_hour", "5h", FIVE_HOUR_MS],
      ["seven_day", "7d", WEEK_MS],
    ] as const) {
      const entry = asRecord(data?.[key])
      const utilization = entry?.["utilization"]
      if (typeof utilization !== "number") continue
      windows.push({ label, percent: utilization, windowMs, ...optional("resetsAt", parseInstant(entry?.["resets_at"])) })
    }
  }
  return { windows, updatedAt: now }
}

/** Codex reports two windows keyed by their length in seconds, under `rate_limit`. */
export function parseCodexUsage(payload: unknown, now: number): PanelUsageEntry {
  const data = asRecord(payload)
  const rateLimit = asRecord(data?.["rate_limit"])
  const windows: PanelUsageWindow[] = []
  for (const key of ["primary_window", "secondary_window"] as const) {
    const window = asRecord(rateLimit?.[key])
    const percent = window?.["used_percent"]
    if (window === undefined || typeof percent !== "number") continue
    const seconds = window["limit_window_seconds"]
    const resetAt = window["reset_at"]
    windows.push({
      label: codexLabel(seconds),
      percent,
      ...(typeof seconds === "number" ? { windowMs: seconds * 1_000 } : {}),
      ...(typeof resetAt === "number" ? { resetsAt: resetAt * 1_000 } : {}),
    })
  }
  const plan = data?.["plan_type"]
  return { windows, updatedAt: now, ...(typeof plan === "string" && plan !== "" ? { plan } : {}) }
}

/**
 * The Codex account id lives in the access token's claims. Decoding it here is what keeps this
 * off any pi-ai internal export; a token that will not decode simply sends no account header.
 */
export function codexAccountId(token: string): string | undefined {
  const payload = token.split(".")[1]
  if (payload === undefined || payload === "") return undefined
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const claims = asRecord(JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))))
    const auth = asRecord(claims?.["https://api.openai.com/auth"])
    for (const key of ["chatgpt_account_id", "account_id"]) {
      const value = auth?.[key]
      if (typeof value === "string" && value !== "") return value
    }
  } catch {
    // A token we cannot read is still a token the endpoint may accept.
  }
  return undefined
}

/** A weekly limit can be scoped to one model, and that model's name is the only useful label. */
function claudeLabel(kind: string | undefined, limit: Record<string, unknown>): string {
  if (kind === "session") return "5h"
  if (kind === "weekly_all") return "7d"
  const scope = asRecord(asRecord(limit["scope"])?.["model"])
  const name = scope?.["display_name"]
  return typeof name === "string" && name !== "" ? name : "7d*"
}

function codexLabel(seconds: unknown): string {
  if (seconds === FIVE_HOUR_MS / 1_000) return "5h"
  if (seconds === WEEK_MS / 1_000) return "7d"
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "window"
  return `${Math.round(seconds / 3_600)}h`
}

function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}




