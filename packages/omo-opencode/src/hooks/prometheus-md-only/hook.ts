import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, BLOCKED_TOOLS, PATCH_TOOLS, PLANNING_CONSULT_WARNING, PLANNING_CONTEXT_OPEN, PROMETHEUS_WORKFLOW_REMINDER } from "./constants"
import { log } from "../../shared/logger"
import { replaceToolArgs } from "../../shared/replace-tool-args"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { getAgentFromSession } from "./agent-resolution"
import { isPrometheusAgent } from "./agent-matcher"
import { isAllowedFile } from "./path-policy"

const TASK_TOOLS = ["task", "call_omo_agent"]

// opencode's patch parser matches these headers with no trailing space and trims the rest
// (`*** Add File:src/x` is a valid header), so the guard matches the same grammar (omo#11367).
const PATCH_PATH_HEADER = /^\s*\*\*\* (?:Add File|Update File|Delete File|Move to):(.*)$/

/**
 * Every path an apply_patch body touches (added, updated, deleted and move targets), or undefined
 * when no patch body is found, which the caller treats as blocked.
 */
function patchedPaths(args: Record<string, unknown>): string[] | undefined {
  const patch = [args.patchText, args.input, args.patch].find((value): value is string => typeof value === "string")
  if (patch === undefined) return undefined
  const paths: string[] = []
  for (const line of patch.split(/\r?\n/)) {
    const match = PATCH_PATH_HEADER.exec(line)
    if (match) paths.push((match[1] ?? "").trim())
  }
  return paths
}

/** The file a write/edit-class call targets plus a hashline `rename` destination, or undefined. */
function writeTargets(args: Record<string, unknown>): string[] | undefined {
  const filePath = [args.filePath, args.file_path, args.path, args.file].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  )
  if (filePath === undefined) return undefined
  return typeof args.rename === "string" && args.rename.length > 0 ? [filePath, args.rename] : [filePath]
}

function blockedWriteError(path: string): Error {
  return new Error(
    `[${HOOK_NAME}] Prometheus is a planning agent. File operations restricted to .omo/*.md plan files only. ` +
    `Do NOT route this change through a subagent either - delegated implementation is still implementation. ` +
    `Record the intended change as a todo in the plan; implementation starts only when the user runs /ulw-execute. ` +
    `Attempted to modify: ${path}.`
  )
}

export function createPrometheusMdOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isPrometheusAgent(agentName)) {
        return
      }

      const toolName = input.tool

      // Inject planning-only warning for task tools called by Prometheus
       if (TASK_TOOLS.includes(toolName)) {
         const prompt = output.args.prompt as string | undefined
         if (prompt && !prompt.includes(PLANNING_CONTEXT_OPEN)) {
           replaceToolArgs(output, { prompt: PLANNING_CONSULT_WARNING + prompt })
          log(`[${HOOK_NAME}] Injected planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      const isPatchTool = PATCH_TOOLS.includes(toolName)
      if (!isPatchTool && !BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      // Fail closed: a file-writing call whose target this guard cannot read is blocked, never let through.
      const targets = isPatchTool ? patchedPaths(output.args) : writeTargets(output.args)
      const blockedPath =
        targets === undefined ? "(unrecognized file argument)" : targets.find((path) => !isAllowedFile(path, ctx.directory))
      if (blockedPath !== undefined) {
        log(`[${HOOK_NAME}] Blocked: Prometheus can only write to .omo/*.md`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath: blockedPath,
          agent: agentName,
        })
        throw blockedWriteError(blockedPath)
      }
      if (isPatchTool || targets === undefined) {
        return
      }
      const filePath = targets[0] ?? ""

      const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/")
      if (normalizedPath.includes(".omo/plans/") || normalizedPath.includes(".omo\\plans\\")) {
        log(`[${HOOK_NAME}] Injecting workflow reminder for plan write`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        output.message = (output.message || "") + PROMETHEUS_WORKFLOW_REMINDER
      }

      log(`[${HOOK_NAME}] Allowed: .omo/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
