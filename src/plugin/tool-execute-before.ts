import type { CreatedHooks } from "../create-hooks"

import { getMainSessionID } from "../features/claude-code-session-state"
import { clearMissionState } from "../features/mission-state"
import { log } from "../shared"
import { resolveSessionAgent } from "./session-agent-resolver"
import type { PluginContext } from "./types"

// Module-level regex constants for the slashcommand branches. Precompiled
// once at module load (Task T1.6) so the regex template `.compile()` cost
// (~1us per literal in V8) is paid once instead of per handler invocation.
const LEADING_SLASH_RE = /^\//
const LOOP_COMMAND_RE = /^\/?(matrix-loop|ulw-loop)\s*/i
const QUOTED_STRING_RE = /^["'](.+?)["']/
const FLAG_SPLIT_RE = /\s+--/
const MAX_ITERATIONS_RE = /--max-iterations=(\d+)/i
const COMPLETION_PROMISE_RE = /--completion-promise=["']?([^"'\s]+)["']?/i

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks } = args

  // Cache the 15 fast-fail hook function references once at handler
  // creation. Without this, every invocation of the returned handler
  // resolves 16 optional-chain property lookups (`hooks.X?.["..."]?.(...)`)
  // which costs ~1.5us per call in V8. With caching, the per-call path
  // reads the bound reference directly.
  const qualityGateHook = hooks.qualityGate?.["tool.execute.before"]
  const commentCheckerHook = hooks.commentChecker?.["tool.execute.before"]
  const directoryAgentsInjectorHook = hooks.directoryAgentsInjector?.["tool.execute.before"]
  const directoryReadmeInjectorHook = hooks.directoryReadmeInjector?.["tool.execute.before"]
  const rulesInjectorHook = hooks.rulesInjector?.["tool.execute.before"]
  const secretLeakGuardHook = hooks.secretLeakGuard?.["tool.execute.before"]
  const envFileWriteGuardHook = hooks.envFileWriteGuard?.["tool.execute.before"]
  const writeExistingFileGuardHook = hooks.writeExistingFileGuard?.["tool.execute.before"]
  const tasksTodowriteDisablerHook = hooks.tasksTodowriteDisabler?.["tool.execute.before"]
  const prometheusMdOnlyHook = hooks.prometheusMdOnly?.["tool.execute.before"]
  const nonInteractiveEnvHook = hooks.nonInteractiveEnv?.["tool.execute.before"]
  const bashFileReadGuardHook = hooks.bashFileReadGuard?.["tool.execute.before"]
  const questionLabelTruncatorHook = hooks.questionLabelTruncator?.["tool.execute.before"]
  const sisyphusJuniorNotepadHook = hooks.sisyphusJuniorNotepad?.["tool.execute.before"]
  const atlasHookHook = hooks.atlasHook?.["tool.execute.before"]

  return async (input, output): Promise<void> => {
    // ---------------------------------------------------------------------
    // Fast-fail hooks (Task T1.1: 3-wave parallelization)
    //
    // The 15 hook calls below are grouped into 3 sequential waves based on
    // their mutation/throwing profile. See `hook-mutation-classification.md`
    // for the full analysis. Waves execute strictly in order (1 -> 2 -> 3);
    // within a wave, hooks run concurrently.
    //
    // Wave 1 (5 hooks): pure READ_ONLY — no mutation, no I/O, no throws.
    //   Safe to parallelize via Promise.all. Either no-op in tool.execute.before
    //   (directory*, rulesInjector) or only write to a private in-memory Map
    //   keyed by callID (qualityGate, commentChecker). No shared state with
    //   other hooks in the wave.
    await Promise.all([
      qualityGateHook?.(input, output),
      commentCheckerHook?.(input, output),
      directoryAgentsInjectorHook?.(input, output),
      directoryReadmeInjectorHook?.(input, output),
      rulesInjectorHook?.(input, output),
    ])

    // Wave 2 (5 hooks): fail-fast BLOCKING — each guard throws on a
    //   DIFFERENT condition for a DIFFERENT tool; no two guards fire on
    //   the same input. Use Promise.all (NOT allSettled): the first
    //   rejection short-circuits and propagates immediately. This is
    //   semantically what we want — a BLOCKING guard rejection aborts
    //   the request, and the caller never sees the other hooks' (would-be)
    //   rejections. Switching from allSettled to all also drops the
    //   per-call result-array allocation.
    //
    //   `prometheusMdOnly` is BOTH BLOCKING (Wave 2) AND MUTATOR (Wave 3).
    //   It runs here for the BLOCKING behavior, then again in Wave 3 for
    //   the output.args.prompt prepend. The first invocation never mutates
    //   the throw path (throws on BLOCKED_TOOLS usage).
    await Promise.all([
      secretLeakGuardHook?.(input, output),
      envFileWriteGuardHook?.(input, output),
      writeExistingFileGuardHook?.(input, output),
      tasksTodowriteDisablerHook?.(input, output),
      prometheusMdOnlyHook?.(input, output),
    ])

    // Wave 3 (5 hooks): MUTATOR — must run sequentially to preserve
    //   mutation order. Specifically:
    //   - 3 hooks CONCAT to output.args.prompt (prometheusMdOnly,
    //     sisyphusJuniorNotepad, atlasHook). Parallel writes would stomp
    //     each other (both read prompt from the same starting state).
    //   - nonInteractiveEnv REWRITES output.args.command (line 58) and
    //     REPLACES output.message; running it before other mutators is
    //     required so that downstream hooks see the rewritten command.
    //   - The order prometheusMdOnly -> sisyphusJuniorNotepad -> atlasHook
    //     is critical: atlasHook's prepended <system-reminder> must be
    //     the outermost (closest to the model), prometheusMdOnly's
    //     prepended PLANNING_CONSULT_WARNING the innermost (closest to the
    //     user prompt). Reversing the order would change semantics.
    // ---------------------------------------------------------------------
    // Task-tool agent resolution: start the network call NOW (before Wave 3)
    // so it runs in parallel with the mutator chain. The result is awaited
    // after Wave 3 completes, preserving the contract that the task tool
    // still receives a resolved `subagent_type` before the handler returns.
    // This is the T1.4 optimization: removes the 5s-timeout network call
    // from the synchronous wait chain.
    let resolvePromise: Promise<string | undefined> | undefined
    if (input.tool === "task") {
      const argsObject = output.args
      const category = typeof argsObject.category === "string" ? argsObject.category : undefined
      const subagentType = typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
      const sessionId = typeof argsObject.session_id === "string" ? argsObject.session_id : undefined

      if (category) {
        argsObject.subagent_type = "mouse"
      } else if (!subagentType && sessionId) {
        resolvePromise = resolveSessionAgent(ctx.client, sessionId)
      }
    }

    await nonInteractiveEnvHook?.(input, output)
    await bashFileReadGuardHook?.(input, output)
    await questionLabelTruncatorHook?.(input, output)
    await prometheusMdOnlyHook?.(input, output)
    await sisyphusJuniorNotepadHook?.(input, output)
    await atlasHookHook?.(input, output)

    if (resolvePromise) {
      const resolvedAgent = await resolvePromise
      output.args.subagent_type = resolvedAgent ?? "continue"
    }

    if (input.tool === "slashcommand") {
      const rawCommand = typeof output.args.command === "string" ? output.args.command : undefined
      const command = rawCommand?.replace(LEADING_SLASH_RE, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (hooks.matrixLoop) {
        if (command === "matrix-loop" && sessionID) {
          const rawArgs = rawCommand?.replace(LOOP_COMMAND_RE, "") || ""
          const taskMatch = rawArgs.match(QUOTED_STRING_RE)
          const prompt =
            taskMatch?.[1] ||
            rawArgs.split(FLAG_SPLIT_RE)[0]?.trim() ||
            "Complete the task as instructed"

          const maxIterMatch = rawArgs.match(MAX_ITERATIONS_RE)
          const promiseMatch = rawArgs.match(COMPLETION_PROMISE_RE)

          hooks.matrixLoop.startLoop(sessionID, prompt, {
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          })
        } else if (command === "cancel-loop" && sessionID) {
          hooks.matrixLoop.cancelLoop(sessionID)
        } else if (command === "ulw-loop" && sessionID) {
          const rawArgs = rawCommand?.replace(LOOP_COMMAND_RE, "") || ""
          const taskMatch = rawArgs.match(QUOTED_STRING_RE)
          const prompt =
            taskMatch?.[1] ||
            rawArgs.split(FLAG_SPLIT_RE)[0]?.trim() ||
            "Complete the task as instructed"

          const maxIterMatch = rawArgs.match(MAX_ITERATIONS_RE)
          const promiseMatch = rawArgs.match(COMPLETION_PROMISE_RE)

          hooks.matrixLoop.startLoop(sessionID, prompt, {
            ultrawork: true,
            maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
            completionPromise: promiseMatch?.[1],
          })
        }
      }

      if (command === "stop-continuation" && sessionID) {
        hooks.stopContinuationGuard?.stop(sessionID)
        hooks.todoContinuationEnforcer?.cancelAllCountdowns()
        hooks.matrixLoop?.cancelLoop(sessionID)
        clearMissionState(ctx.directory)
        log("[stop-continuation] All continuation mechanisms stopped", {
          sessionID,
        })
      }
    }
  }
}
