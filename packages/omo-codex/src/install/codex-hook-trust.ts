import { isPlainRecord } from "./codex-cache-fs"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { TrustedHookState } from "./types"

const EVENT_LABELS = new Map<string, string>([
  ["PreToolUse", "pre_tool_use"],
  ["PermissionRequest", "permission_request"],
  ["PostToolUse", "post_tool_use"],
  ["PreCompact", "pre_compact"],
  ["PostCompact", "post_compact"],
  ["SessionStart", "session_start"],
  ["UserPromptSubmit", "user_prompt_submit"],
  ["SubagentStart", "subagent_start"],
  ["SubagentStop", "subagent_stop"],
  ["Stop", "stop"],
])

export async function trustedHookStatesForPlugin(input: {
  readonly marketplaceName: string
  readonly pluginName: string
  readonly pluginRoot: string
}): Promise<readonly TrustedHookState[]> {
  const manifestPath = join(input.pluginRoot, ".codex-plugin", "plugin.json")
  if (!(await exists(manifestPath))) return []
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(manifest) || typeof manifest.hooks !== "string") return []

  const hooksPath = join(input.pluginRoot, manifest.hooks)
  if (!(await exists(hooksPath))) return []
  const parsed: unknown = JSON.parse(await readFile(hooksPath, "utf8"))
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks)) return []

  const keySource = `${input.pluginName}@${input.marketplaceName}:${stripDotSlash(manifest.hooks)}`
  const states: TrustedHookState[] = []
  for (const [eventName, groups] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(groups)) continue
    const eventLabel = EVENT_LABELS.get(eventName)
    if (eventLabel === undefined) continue
    for (const [groupIndex, group] of groups.entries()) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) continue
      for (const [handlerIndex, handler] of group.hooks.entries()) {
        if (!isPlainRecord(handler) || handler.type !== "command") continue
        if (handler.async === true) continue
        if (typeof handler.command !== "string" || handler.command.trim() === "") continue
        const key = `${keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`
        states.push({ key, trustedHash: commandHookHash(eventLabel, group.matcher, handler) })
      }
    }
  }
  return states
}

function commandHookHash(eventName: string, matcher: unknown, handler: Record<string, unknown>): string {
  const timeout = Math.max(Number(handler.timeout ?? 600), 1)
  const normalizedHandler: Record<string, unknown> = {
    type: "command",
    command: handler.command,
    timeout,
    async: false,
  }
  if (typeof handler.statusMessage === "string") normalizedHandler.statusMessage = handler.statusMessage

  const identity: Record<string, unknown> = { event_name: eventName, hooks: [normalizedHandler] }
  if (typeof matcher === "string") identity.matcher = matcher
  const canonical = JSON.stringify(canonicalJson(identity))
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isPlainRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalJson(value[key])
  }
  return result
}

function stripDotSlash(value: string): string {
  return value.startsWith("./") ? value.slice(2) : value
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8")
    return true
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
