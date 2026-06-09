import type {
  PreToolUseInput,
  PreToolUseOutput,
  PermissionDecision,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, objectToSnakeCase, transformToolName, log } from "../../shared"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"
import { normalizeHookText } from "./hook-text"

export interface PreToolUseContext {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  cwd: string
  transcriptPath?: string
  toolUseId?: string
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions"
}

export interface PreToolUseResult {
  decision: PermissionDecision
  reason?: string
  modifiedInput?: Record<string, unknown>
  elapsedMs?: number
  hookName?: string
  toolName?: string
  inputLines?: string
  // Common output fields (Claude Code spec)
  continue?: boolean
  stopReason?: string
  suppressOutput?: boolean
  systemMessage?: string
}

function buildInputLines(toolInput: Record<string, unknown>): string {
  return Object.entries(toolInput)
    .slice(0, 3)
    .map(([key, val]) => {
      const valStr = String(val).slice(0, 40)
      return `  ${key}: ${valStr}${String(val).length > 40 ? "..." : ""}`
    })
    .join("\n")
}

export async function executePreToolUseHooks(
  ctx: PreToolUseContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<PreToolUseResult> {
  if (!config) {
    return { decision: "allow" }
  }

  const transformedToolName = transformToolName(ctx.toolName)
  const matchers = findMatchingHooks(config, "PreToolUse", transformedToolName)
  if (matchers.length === 0) {
    return { decision: "allow" }
  }

  const stdinData: PreToolUseInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode ?? "bypassPermissions",
    hook_event_name: "PreToolUse",
    tool_name: transformedToolName,
    tool_input: objectToSnakeCase(ctx.toolInput),
    tool_use_id: ctx.toolUseId,
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined
  const inputLines = buildInputLines(ctx.toolInput)
  let accumulatedModifiedInput: Record<string, unknown> | undefined
  const accumulatedCommonFields: {
    continue?: boolean
    stopReason?: string
    suppressOutput?: boolean
    systemMessage?: string
  } = {}

   for (const matcher of matchers) {
     if (!matcher.hooks || matcher.hooks.length === 0) continue
     for (const hook of matcher.hooks) {
       if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("PreToolUse", hookName, extendedConfig ?? null)) {
        log("PreToolUse hook command skipped (disabled by config)", { command: hookName, toolName: ctx.toolName })
        continue
      }

      if (!firstHookName) firstHookName = hookName

      const result = await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)

      if (result.exitCode === 2) {
        return {
          decision: "deny",
          reason: normalizeHookText(result.stderr) ?? normalizeHookText(result.stdout) ?? "Hook blocked the operation",
          modifiedInput: accumulatedModifiedInput,
          elapsedMs: Date.now() - startTime,
          hookName: firstHookName,
          toolName: transformedToolName,
          inputLines,
          ...accumulatedCommonFields,
        }
      }

      if (result.exitCode === 1) {
        return {
          decision: "ask",
          reason: normalizeHookText(result.stderr) ?? normalizeHookText(result.stdout),
          modifiedInput: accumulatedModifiedInput,
          elapsedMs: Date.now() - startTime,
          hookName: firstHookName,
          toolName: transformedToolName,
          inputLines,
          ...accumulatedCommonFields,
        }
      }

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout || "{}") as PreToolUseOutput

          // Handle deprecated decision/reason fields (Claude Code backward compat)
          let decision: PermissionDecision | undefined
          let reason: string | undefined
          let modifiedInput: Record<string, unknown> | undefined

          if (output.hookSpecificOutput?.permissionDecision) {
            decision = output.hookSpecificOutput.permissionDecision
            reason = normalizeHookText(output.hookSpecificOutput.permissionDecisionReason)
            modifiedInput = output.hookSpecificOutput.updatedInput
          } else if (output.decision) {
            // Map deprecated values: approve->allow, block->deny, ask->ask
            const legacyDecision = output.decision
            if (legacyDecision === "approve" || legacyDecision === "allow") {
              decision = "allow"
            } else if (legacyDecision === "block" || legacyDecision === "deny") {
              decision = "deny"
            } else if (legacyDecision === "ask") {
              decision = "ask"
            }
            reason = normalizeHookText(output.reason)
          }

          if (decision === "deny" || decision === "ask") {
            return {
              decision,
              reason,
              modifiedInput: modifiedInput ?? accumulatedModifiedInput,
              elapsedMs: Date.now() - startTime,
              hookName: firstHookName,
              toolName: transformedToolName,
              inputLines,
              continue: output.continue ?? accumulatedCommonFields.continue,
              stopReason: normalizeHookText(output.stopReason) ?? accumulatedCommonFields.stopReason,
              suppressOutput: output.suppressOutput ?? accumulatedCommonFields.suppressOutput,
              systemMessage: normalizeHookText(output.systemMessage) ?? accumulatedCommonFields.systemMessage,
            }
          }

          // "allow" — accumulate modifiedInput and common fields, continue to next hook
          if (modifiedInput) {
            accumulatedModifiedInput = { ...accumulatedModifiedInput, ...modifiedInput }
            Object.assign(stdinData.tool_input, objectToSnakeCase(modifiedInput))
          }
          if (output.continue !== undefined) accumulatedCommonFields.continue = output.continue
          if (output.stopReason !== undefined) accumulatedCommonFields.stopReason = normalizeHookText(output.stopReason)
          if (output.suppressOutput !== undefined) accumulatedCommonFields.suppressOutput = output.suppressOutput
          if (output.systemMessage !== undefined) accumulatedCommonFields.systemMessage = normalizeHookText(output.systemMessage)
        } catch (error) {
          if (!(error instanceof SyntaxError)) {
            throw error
          }
        }
      }
    }
  }

  return {
    decision: "allow" as const,
    ...(accumulatedModifiedInput ? { modifiedInput: accumulatedModifiedInput } : {}),
    ...(Object.keys(accumulatedCommonFields).length > 0 ? accumulatedCommonFields : {}),
  }
}
