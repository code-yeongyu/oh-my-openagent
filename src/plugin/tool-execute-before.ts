import type { PluginContext } from "./types"

import { getMainSessionID } from "../features/claude-code-session-state"
import { clearBoulderState } from "../features/boulder-state"
import { log } from "../shared"
import { resolveSessionAgent } from "./session-agent-resolver"
import { createAuditLoopGuard } from "./audit-loop-guard"
import {
  DEFAULT_AUDIT_LOOP_DURATION_MS,
  extractRawLoopArgs,
  parseLoopCommandArgs,
} from "../hooks/ralph-loop/command-args"

import type { CreatedHooks } from "../create-hooks"

const LOOP_COMMANDS = new Set(["ralph-loop", "ulw-loop", "audit-loop"])

function resolveSlashCommand(rawCommand: string | undefined): string | undefined {
  return rawCommand?.replace(/^\//, "").trim().split(/\s+/)[0]?.toLowerCase()
}

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks } = args
  const auditLoopGuard = createAuditLoopGuard(ctx.directory ?? process.cwd())

  return async (input, output): Promise<void> => {
    await hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output)
    await hooks.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
    await hooks.claudeCodeHooks?.["tool.execute.before"]?.(input, output)
    await hooks.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)
    await hooks.commentChecker?.["tool.execute.before"]?.(input, output)
    await hooks.directoryAgentsInjector?.["tool.execute.before"]?.(input, output)
    await hooks.directoryReadmeInjector?.["tool.execute.before"]?.(input, output)
    await hooks.rulesInjector?.["tool.execute.before"]?.(input, output)
    await hooks.tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output)
    await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
    await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
    await hooks.atlasHook?.["tool.execute.before"]?.(input, output)

    if (input.tool === "task") {
      const argsObject = output.args
      const category = typeof argsObject.category === "string" ? argsObject.category : undefined
      const subagentType = typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
      const sessionId = typeof argsObject.session_id === "string" ? argsObject.session_id : undefined

      if (category) {
        argsObject.subagent_type = "sisyphus-junior"
      } else if (!subagentType && sessionId) {
        const resolvedAgent = await resolveSessionAgent(ctx.client, sessionId)
        argsObject.subagent_type = resolvedAgent ?? "continue"
      }
    }

    if (hooks.ralphLoop && input.tool === "slashcommand") {
      const rawCommand = typeof output.args.command === "string" ? output.args.command : undefined
      const command = resolveSlashCommand(rawCommand)
      const sessionID = input.sessionID || getMainSessionID()

      if (command && LOOP_COMMANDS.has(command) && sessionID) {
        const mode =
          command === "audit-loop" ? "audit-loop" : command === "ulw-loop" ? "ulw" : "standard"
        const rawArgs = extractRawLoopArgs(rawCommand, command)
        const parsed = parseLoopCommandArgs(rawArgs, {
          defaultPrompt: "Complete the task as instructed",
          mode,
        })

        hooks.ralphLoop.startLoop(sessionID, parsed.prompt, {
          mode,
          ultrawork: mode !== "standard",
          maxIterations: parsed.maxIterations,
          completionPromise: parsed.completionPromise,
          completionDetectionEnabled: mode === "audit-loop" ? false : true,
          maxDurationMs:
            parsed.maxDurationMs ??
            (mode === "audit-loop" ? DEFAULT_AUDIT_LOOP_DURATION_MS : undefined),
        })
        if (mode === "audit-loop") {
          auditLoopGuard.resetSession(sessionID)
        }
      } else if (command === "cancel-ralph" && sessionID) {
        hooks.ralphLoop.cancelLoop(sessionID)
        auditLoopGuard.clearSession(sessionID)
      }
    }

    auditLoopGuard.enforce(input, output, hooks)

    if (input.tool === "slashcommand") {
      const rawCommand = typeof output.args.command === "string" ? output.args.command : undefined
      const command = resolveSlashCommand(rawCommand)
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "stop-continuation" && sessionID) {
        hooks.stopContinuationGuard?.stop(sessionID)
        hooks.todoContinuationEnforcer?.cancelAllCountdowns()
        hooks.ralphLoop?.cancelLoop(sessionID)
        auditLoopGuard.clearSession(sessionID)
        clearBoulderState(ctx.directory)
        log("[stop-continuation] All continuation mechanisms stopped", {
          sessionID,
        })
      }
    }
  }
}
