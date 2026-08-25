import type {
  UserPromptSubmitInput,
  UserPromptSubmitOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, log } from "../../shared"
import { isRealUserTextPart } from "../../shared/internal-initiator-marker"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"
import { normalizeHookText } from "./hook-text"

const USER_PROMPT_SUBMIT_TAG_OPEN = "<user-prompt-submit-hook>"
const USER_PROMPT_SUBMIT_TAG_CLOSE = "</user-prompt-submit-hook>"

/**
 * Claude Code reads hook stdout as control output only when it starts with `{`
 * (`parseHookOutput`, hooks.ts). Anything else is plain text, which for
 * UserPromptSubmit becomes context. A control output reaches the model through
 * `hookSpecificOutput.additionalContext` and through nothing else, so injecting
 * the raw JSON puts fields such as `continue` and `systemMessage` in front of
 * the model as if the user had typed them.
 *
 * Returns undefined for stdout that is not a control output, which leaves the
 * caller injecting it verbatim. Claude Code instead reports malformed JSON as a
 * hook error, and falling back to the text matches the sibling handlers here.
 */
function parseControlOutput(
  stdout: string | undefined
): UserPromptSubmitOutput | undefined {
  if (stdout === undefined) {
    return undefined
  }
  const trimmed = stdout.trim()
  if (!trimmed.startsWith("{")) {
    return undefined
  }
  try {
    return JSON.parse(trimmed) as UserPromptSubmitOutput
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    return undefined
  }
}

function asHookContext(text: string): string {
  if (text.startsWith(USER_PROMPT_SUBMIT_TAG_OPEN)) {
    return text
  }
  return `${USER_PROMPT_SUBMIT_TAG_OPEN}\n${text}\n${USER_PROMPT_SUBMIT_TAG_CLOSE}`
}

export interface MessagePart {
  type: "text" | "tool_use" | "tool_result"
  text?: string
  [key: string]: unknown
}

export interface UserPromptSubmitContext {
  sessionId: string
  parentSessionId?: string
  prompt: string
  parts: MessagePart[]
  cwd: string
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions"
}

export interface UserPromptSubmitResult {
  block: boolean
  reason?: string
  modifiedParts: MessagePart[]
  messages: string[]
}

export async function executeUserPromptSubmitHooks(
  ctx: UserPromptSubmitContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<UserPromptSubmitResult> {
  const modifiedParts = ctx.parts
  const messages: string[] = []

  if (ctx.parentSessionId) {
    return { block: false, modifiedParts, messages }
  }

  const realUserTextParts = ctx.parts.filter(isRealUserTextPart)
  if (realUserTextParts.length === 0) {
    return { block: false, modifiedParts, messages }
  }

  // Check if hook tags are in the current user input only (not in injected context)
  // by checking only the text parts that were provided in this message
  const userInputText = realUserTextParts
    .map((p) => p.text ?? "")
    .join("\n")

  if (
    userInputText.includes(USER_PROMPT_SUBMIT_TAG_OPEN) &&
    userInputText.includes(USER_PROMPT_SUBMIT_TAG_CLOSE)
  ) {
    return { block: false, modifiedParts, messages }
  }

  if (!config) {
    return { block: false, modifiedParts, messages }
  }

  const matchers = findMatchingHooks(config, "UserPromptSubmit")
  if (matchers.length === 0) {
    return { block: false, modifiedParts, messages }
  }

  const stdinData: UserPromptSubmitInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode ?? "bypassPermissions",
    hook_event_name: "UserPromptSubmit",
    prompt: ctx.prompt,
    session: { id: ctx.sessionId },
    hook_source: "opencode-plugin",
  }

   for (const matcher of matchers) {
     if (!matcher.hooks || matcher.hooks.length === 0) continue
     for (const hook of matcher.hooks) {
       if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("UserPromptSubmit", hookName, extendedConfig ?? null)) {
        log("UserPromptSubmit hook command skipped (disabled by config)", { command: hookName })
        continue
      }

      const result = await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)

      const control = parseControlOutput(result.stdout)
      const injected = control
        ? normalizeHookText(control.hookSpecificOutput?.additionalContext)
        : normalizeHookText(result.stdout)
      if (injected !== undefined) {
        messages.push(asHookContext(injected))
      }

      // Both stop the prompt whatever the hook exited with, matching
      // processHookJSONOutput in Claude Code.
      if (control?.continue === false) {
        return {
          block: true,
          reason: normalizeHookText(control.stopReason) ?? normalizeHookText(result.stderr),
          modifiedParts,
          messages,
        }
      }

      if (control?.decision === "block") {
        return {
          block: true,
          reason: normalizeHookText(control.reason) ?? normalizeHookText(result.stderr),
          modifiedParts,
          messages,
        }
      }
    }
  }

  return { block: false, modifiedParts, messages }
}
