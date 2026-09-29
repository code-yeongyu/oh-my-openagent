import type { Plugin } from "@opencode/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { isRecord } from "@oh-my-opencode/utils"
import { log, replaceToolArgs } from "./shared"
import type { OhMyOpenCodeConfig } from "./config"
import type { ModelCacheState } from "./plugin-state"
import { createBashFileReadGuardHook } from "./hooks/bash-file-read-guard"
import { createCommentCheckerHooks } from "./hooks/comment-checker/hook"
import { createFsyncSkipWarningHook } from "./hooks/fsync-skip-warning/index"
import { createNonInteractiveEnvHook } from "./hooks/non-interactive-env/non-interactive-env-hook"
import { createTasksTodowriteDisablerHook } from "./hooks/tasks-todowrite-disabler/hook"
import { createWebFetchRedirectGuardHook } from "./hooks/webfetch-redirect-guard/hook"
import { createWriteExistingFileGuardHook } from "./hooks/write-existing-file-guard/hook"
import { createNotepadWriteGuardHook } from "./hooks/notepad-write-guard/index"
import { createPrometheusMdOnlyHook } from "./hooks/prometheus-md-only/hook"
import { createQuestionLabelTruncatorHook } from "./hooks/question-label-truncator/hook"
import { createRulesInjectorHook } from "./hooks/rules-injector/hook"
import { isV2HookEnabled } from "./v2-enabled"

type BeforeInput = { tool: string; sessionID: string; callID: string }
export type GuardFn = (
  input: { tool: string; sessionID: string; callID: string },
  output: Record<string, unknown>,
) => Promise<void>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function stripMcpPrefix(tool: string): string {
  return tool.replace(/^mcp_/i, "")
}

export async function registerToolGuardV2Hooks(
  ctx: Plugin.Context,
  args: { pluginConfig: OhMyOpenCodeConfig; modelCacheState: ModelCacheState },
): Promise<{
  fsyncAfter: GuardFn
  commentCheckerAfter: GuardFn | undefined
  webfetchAfter: GuardFn | undefined
  rulesAfter: GuardFn | undefined
  rulesDeleted: ((sessionID: string) => void) | undefined
}> {
  const { pluginConfig, modelCacheState } = args
  const enabled = (name: string): boolean => isV2HookEnabled(pluginConfig, name)
  // client is a stub object: factories only need ctx.directory plus a stable
  // WeakMap key for usage caches (live session reads fail soft to null).
  const v1ctx = { directory: ctx.location.directory, client: {} } as unknown as PluginInput
  // fsync timing state must be shared between its before/after halves.
  const fsync = enabled("fsync-skip-warning") ? createFsyncSkipWarningHook() : undefined
  const commentChecker = enabled("comment-checker") ? createCommentCheckerHooks() : undefined
  const webfetch = enabled("webfetch-redirect-guard")
    ? createWebFetchRedirectGuardHook(v1ctx)
    : undefined
  const guardFns: GuardFn[] = []
  const push = (name: string, fn: unknown): void => {
    if (!enabled(name) || typeof fn !== "function") return
    guardFns.push(fn as unknown as GuardFn)
  }
  push("write-existing-file-guard", createWriteExistingFileGuardHook(v1ctx)["tool.execute.before"])
  push("notepad-write-guard", createNotepadWriteGuardHook()["tool.execute.before"])
  push("question-label-truncator", createQuestionLabelTruncatorHook()["tool.execute.before"])
  push("prometheus-md-only", createPrometheusMdOnlyHook(v1ctx)["tool.execute.before"])
  push("non-interactive-env", createNonInteractiveEnvHook(v1ctx)["tool.execute.before"])
  push("tasks-todowrite-disabler", createTasksTodowriteDisablerHook(pluginConfig)["tool.execute.before"])
  push("bash-file-read-guard", createBashFileReadGuardHook()["tool.execute.before"])
  if (commentChecker) {
    push("comment-checker", commentChecker["tool.execute.before"])
  }
  if (webfetch) {
    push("webfetch-redirect-guard", webfetch["tool.execute.before"])
  }
  // Transcript hydration degrades to an empty set without a live client
  // (dedup fallback); file-path rule injection works unchanged.
  const rules = enabled("rules-injector")
    ? createRulesInjectorHook(v1ctx, modelCacheState)
    : undefined
  if (rules) {
    push("rules-injector", rules["tool.execute.before"])
  }
  if (fsync) {
    guardFns.push(fsync["tool.execute.before"] as unknown as GuardFn)
  }

  await ctx.tool.hook("execute.before", async (event) => {
    const input: BeforeInput = {
      tool: event.tool,
      sessionID: event.sessionID,
      callID: event.id,
    }
    const output: Record<string, unknown> = { args: asRecord(event.input) }

    if (/^mcp_/i.test(input.tool)) {
      const stripped = stripMcpPrefix(input.tool)
      log("[tool-execute-before] Stripped mcp_ prefix from tool name", {
        original: input.tool,
        resolved: stripped,
        sessionID: input.sessionID,
        callID: input.callID,
      })
      input.tool = stripped
    }

    const args = output.args
    if (input.tool.toLowerCase() === "bash" && isRecord(args) && typeof args.command === "string") {
      if (args.command.includes("\x00")) {
        replaceToolArgs(output as { args: Record<string, unknown> }, { command: args.command.replace(/\x00/g, "") })
        log("[tool-execute-before] Stripped null bytes from bash command", {
          sessionID: input.sessionID,
          callID: input.callID,
        })
      }
    }

    for (const guard of guardFns) {
      await guard(input, output)
    }

    event.tool = input.tool
    event.input = (output as { args: Record<string, unknown> }).args
  })

  return {
    fsyncAfter: (fsync?.["tool.execute.after"] ?? (async () => {})) as unknown as GuardFn,
    commentCheckerAfter: commentChecker?.["tool.execute.after"] as unknown as GuardFn | undefined,
    webfetchAfter: webfetch?.["tool.execute.after"] as unknown as GuardFn | undefined,
    rulesAfter: rules?.["tool.execute.after"] as unknown as GuardFn | undefined,
    rulesDeleted: rules?.event
      ? (sessionID: string) => {
        void rules.event({ event: { type: "session.deleted", properties: { sessionID } } })
      }
      : undefined,
  }
}
