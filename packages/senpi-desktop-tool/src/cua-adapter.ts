import { DesktopEngineRpcError, DesktopLaunchContextError } from "@oh-my-opencode/senpi-desktop-service"
import {
  actionsOf,
  type ComputerActionsInput,
  isReadOnlyActions,
  parseComputerActions,
  type ScreenshotBounds,
} from "./cua-actions"
import { computerActionsToolDefinition } from "./cua-definition"
import { ComputerArgumentsError } from "./action-schema"
import { computerFailure, launchContextFailure } from "./cua-errors"
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "./params"
import type { ComputerHostContext } from "./session"
import { type ActionsOutcome, runActions } from "./cua-steps"
import { type ComputerToolDeps, type ComputerToolResult, oversizeArgumentsResult, runComputer } from "./tool"

function isActionsOutcome(value: unknown): value is ActionsOutcome {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "steps"))
}

/**
 * The optional `computer_actions` tool (`computer.cuaAdapter`): gajae-code's OpenAI computer-use action schema
 * over the same desktop facade, session, stop path, and audit as the `computer` tool. It adds no input path.
 */
export function createComputerActionsTool(deps: ComputerToolDeps) {
  let bounds: ScreenshotBounds | null = null
  return {
    ...computerActionsToolDefinition,
    async execute(
      toolCallId: string,
      input: Readonly<Record<string, unknown>>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      context: ComputerHostContext,
    ): Promise<ComputerToolResult & { isError?: boolean }> {
      const stopHotkey = deps.handle.settings().stopHotkey
      const tooLarge = oversizeArgumentsResult(input, stopHotkey)
      if (tooLarge !== undefined) return tooLarge
      let params: ComputerActionsInput
      try {
        params = parseComputerActions(input)
      } catch (error) {
        if (!(error instanceof ComputerArgumentsError)) throw error
        const failure = computerFailure(error.code, error.reason, stopHotkey)
        return {
          content: [{ type: "text", text: failure.message }],
          details: { value: failure, isError: true },
          isError: true,
        }
      }
      const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
      const readOnly = isReadOnlyActions(params)
      const actions = actionsOf(params)
      const frame = bounds
      let result: ComputerToolResult
      try {
        result = await runComputer(
          deps,
          context,
          { toolCallId, readOnly, timeoutSeconds },
          (scope) => runActions(scope, actions, frame),
          signal,
        )
      } catch (error) {
        if (!(error instanceof Error)) throw error
        if (error instanceof DesktopLaunchContextError) {
          const failure = launchContextFailure(error)
          return {
            content: [{ type: "text", text: failure.message }],
            details: { value: failure, isError: true },
            isError: true,
          }
        }
        const data =
          error instanceof DesktopEngineRpcError && error.data !== null && "code" in error.data ? error.data : undefined
        const reason = data?.code ?? Reflect.get(error, "reason") ?? Reflect.get(error, "code") ?? error.name
        const failure = computerFailure(String(reason), error.message, stopHotkey, data?.permission, data?.reason)
        return {
          content: [{ type: "text", text: failure.message }],
          details: { value: failure, isError: true },
          isError: true,
        }
      }
      const outcome = result.details.value
      if (!isActionsOutcome(outcome)) return result
      bounds = outcome.bounds
      const images = result.content.filter((part) => part.type === "image")
      const failed = outcome.failedIndex === null ? undefined : outcome.steps[outcome.failedIndex]
      if (failed === undefined) {
        const text = `${outcome.steps.length} action(s) done: ${outcome.steps.map((step) => step.action).join(", ")}.`
        return { ...result, content: [...images, { type: "text", text }] }
      }
      const failure = computerFailure(
        failed.code ?? "Error",
        failed.message ?? "action failed",
        stopHotkey,
        failed.permission,
        failed.reason,
      )
      const text = `Action ${failed.index + 1} (${failed.action}) failed. ${
        failure.permission === undefined ? failure.message : JSON.stringify(failure)
      }`
      return {
        content: [...images, { type: "text", text }],
        details: { ...result.details, value: { ...outcome, failure }, isError: true },
        isError: true,
      }
    },
  }
}

export type ComputerActionsTool = ReturnType<typeof createComputerActionsTool>
