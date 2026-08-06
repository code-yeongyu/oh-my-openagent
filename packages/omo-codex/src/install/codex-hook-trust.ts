import { isPlainRecord } from "./codex-cache-fs"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { CodexInstallPlatform, TrustedHookState } from "./types"

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
  readonly platform?: CodexInstallPlatform
  readonly pluginName: string
  readonly pluginRoot: string
}): Promise<readonly TrustedHookState[]> {
  const manifestPath = join(input.pluginRoot, ".codex-plugin", "plugin.json")
  if (!(await exists(manifestPath))) return []
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isPlainRecord(manifest)) return []

  const states: TrustedHookState[] = []
  for (const hookPath of hookManifestPaths(manifest.hooks)) {
    const hooksPath = join(input.pluginRoot, hookPath)
    if (!(await exists(hooksPath))) continue
    const parsed: unknown = JSON.parse(await readFile(hooksPath, "utf8"))
    if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks)) continue
    states.push(
      ...trustedHookStatesForHooksFile({
        keySource: `${input.pluginName}@${input.marketplaceName}:${hookPath}`,
        hooks: parsed.hooks,
        platform: input.platform ?? process.platform,
      }),
    )
  }
  return states
}

function hookManifestPaths(value: unknown): readonly string[] {
  if (typeof value === "string" && value.trim() !== "") return [stripDotSlash(value)]
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === "string" && item.trim() !== "").map(stripDotSlash)
}

function trustedHookStatesForHooksFile(input: {
  readonly keySource: string
  readonly hooks: Record<string, unknown>
  readonly platform: CodexInstallPlatform
}): readonly TrustedHookState[] {
  const states: TrustedHookState[] = []
  for (const [eventName, groups] of Object.entries(input.hooks)) {
    if (!Array.isArray(groups)) continue
    const eventLabel = EVENT_LABELS.get(eventName)
    if (eventLabel === undefined) continue
    for (const [groupIndex, group] of groups.entries()) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) continue
      for (const [handlerIndex, handler] of group.hooks.entries()) {
        if (!isPlainRecord(handler) || handler.type !== "command") continue
        if (handler.async === true) continue
        const command = commandForPlatform(handler, input.platform)
        if (command === undefined || command.trim() === "") continue
        const key = `${input.keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`
        states.push({ key, trustedHash: commandHookHash(eventLabel, group.matcher, handler, command) })
      }
    }
  }
  return states
}

function commandForPlatform(handler: Record<string, unknown>, platform: CodexInstallPlatform): string | undefined {
  if (typeof handler.command !== "string") return undefined
  if (platform === "win32" && typeof handler.commandWindows === "string") return handler.commandWindows
  return handler.command
}

function commandHookHash(
  eventName: string,
  matcher: unknown,
  handler: Record<string, unknown>,
  command: string,
): string {
  const timeout = Math.max(Number(handler.timeout ?? 600), 1)
  const normalizedHandler: Record<string, unknown> = {
    type: "command",
    command,
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
