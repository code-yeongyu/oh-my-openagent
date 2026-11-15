import {
  type AuditRecord,
  type ComputerDisplay,
  type ComputerScreenshot,
  isReadOnlyComputerCall,
} from "@oh-my-opencode/senpi-desktop-protocol"
import type { ActionReport } from "@oh-my-opencode/senpi-desktop-sdk"
import {
  DesktopCallBudgetError,
  DesktopEngineRpcError,
  DesktopLaunchContextError,
  interpretChain,
  runComputerSteps,
  type StepProgram,
} from "@oh-my-opencode/senpi-desktop-service"
import type { ComputerHandle } from "./activation"
import { Check } from "typebox/value"
import { reportingService } from "./action-reports"
import { actionBranches, argumentsError } from "./action-schema"
import { ComputerActionBranches, ComputerActionShape, type ComputerToolParams, DEFAULT_TIMEOUT_SECONDS } from "./params"
import { oversizeArguments, oversizeResult } from "./payload-caps"
import { type ComputerHostContext, runSnapshot } from "./session"
import { computerToolDefinition } from "./tool-definition"
import { type ComputerFailure, computerFailure, launchContextFailure } from "./cua-errors"

/** One `desktop.control.acquire` confirmation request, carried to the host component (#9651 B5b). */
export interface ControlConfirmRequest {
  readonly context: ComputerHostContext
  readonly reason: string
  readonly signal: AbortSignal
  /** How long the call can still wait for the answer; the confirm must settle within it. */
  readonly budgetMs?: number
}

export interface ComputerToolDeps {
  readonly handle: ComputerHandle
  /** The host component's human confirm for the foreground-control grant; absent: never grants. */
  readonly confirmControl?: (request: ControlConfirmRequest) => Promise<boolean>
}

/** `details` of every `computer` result; `value` is what the eval-kernel `computer` facade returns. */
export interface ComputerToolDetails {
  readonly value?: unknown
  readonly readOnly?: boolean
  readonly screenshots?: readonly ComputerScreenshot[]
  readonly audit?: readonly AuditRecord[]
  /** The tool call these details belong to; every `audit` record carries it. */
  readonly toolCallId?: string
  /**
   * The SDK `ActionReport` of the call's last input action; absent when the call sent none. `legacy: true` when the
   * engine replied `null` (it does not advertise `action-report`).
   */
  readonly report?: ActionReport
  /** Every input action's report in send order, when the call sent more than one. */
  readonly reports?: readonly ActionReport[]
  /** The engine audit ids of every report, in send order; present with `report`. */
  readonly auditIds?: readonly string[]
  /** Mirrors the top-level `isError` so a code-mode marshal (which reads `details`) reports the failure. */
  readonly isError?: boolean
}

/** Structurally the agent's `AgentToolResult<ComputerToolDetails>`. */
export interface ComputerToolResult {
  isError?: boolean
  content: ComputerDisplay[]
  details: ComputerToolDetails
}

const BRANCHES = actionBranches(ComputerActionBranches)

/** The flat published arguments narrowed to one action's exact shape; `ComputerArgumentsError` otherwise. */
export function parseComputerParams(input: unknown): ComputerToolParams {
  if (Check(ComputerActionShape, input)) return input
  throw argumentsError(BRANCHES, input, "computer")
}

const SHOWN_ABOVE = "[shown above]"

/** The return value without repeating observe's AX tree when the call already displayed it verbatim. */
function stringifyReturn(value: unknown, shown: ReadonlySet<string>): string {
  if (typeof value === "string") return value
  const replacer = (key: string, field: unknown) =>
    key === "ax" && typeof field === "string" && shown.has(field) ? SHOWN_ABOVE : field
  return JSON.stringify(value, replacer, 2) ?? String(value)
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value))
}

function valueResult(value: unknown, fallback: string): ComputerToolResult {
  const text = value === undefined ? fallback : stringify(value)
  return { content: [{ type: "text", text }], details: { value } }
}

function failureResult(
  failure: ComputerFailure,
  text: string = failure.message,
  details: ComputerToolDetails = {},
  images: readonly ComputerDisplay[] = [],
): ComputerToolResult {
  return {
    content: [...images, { type: "text", text }],
    details: { ...details, value: failure, isError: true },
    isError: true,
  }
}

/** An input over the argument cap, refused before anything starts; `undefined` when it fits. */
export function oversizeArgumentsResult(input: unknown, stopHotkey: string): ComputerToolResult | undefined {
  const reason = oversizeArguments(input)
  return reason === undefined
    ? undefined
    : failureResult(computerFailure("COMPUTER_ARGUMENTS_TOO_LARGE", reason, stopHotkey))
}

function assertNever(value: never): never {
  throw new TypeError(`unhandled computer action ${JSON.stringify(value)}`)
}

/** One `computer` tool call: activates the session (arming the stop chord) and runs `program` over the facade. */
export async function runComputer(
  deps: ComputerToolDeps,
  context: ComputerHostContext,
  request: { readonly toolCallId: string; readonly readOnly: boolean; readonly timeoutSeconds: number },
  program: StepProgram,
  signal: AbortSignal | undefined,
): Promise<ComputerToolResult> {
  const { handle } = deps
  await handle.activate(context)
  const settings = handle.settings()
  const snapshot = runSnapshot(settings, context, request.readOnly)
  const confirmControl = deps.confirmControl
  const reports: ActionReport[] = []
  const outcome = await runComputerSteps(
    {
      toolCallId: request.toolCallId,
      snapshot,
      timeoutMs: request.timeoutSeconds * 1000,
      ...(signal === undefined ? {} : { signal }),
    },
    {
      service: reportingService(handle.service, reports),
      ...(confirmControl === undefined
        ? {}
        : {
            confirmControl: (reason: string, callSignal: AbortSignal, budgetMs: number) =>
              confirmControl({ context, reason, signal: callSignal, budgetMs }),
          }),
    },
    program,
  )
  const details: ComputerToolDetails = {
    readOnly: request.readOnly,
    screenshots: outcome.screenshots,
    audit: outcome.audit,
    toolCallId: request.toolCallId,
    ...(reports.length === 0
      ? {}
      : { report: reports[reports.length - 1], auditIds: reports.flatMap((report) => report.auditIds) }),
    ...(reports.length > 1 ? { reports } : {}),
  }
  const tooLarge = oversizeResult(outcome.returnValue)
  if (tooLarge !== undefined) {
    const failure = computerFailure("COMPUTER_RESULT_TOO_LARGE", tooLarge, settings.stopHotkey)
    const images = outcome.displays.filter((part) => part.type === "image")
    return failureResult(failure, failure.message, details, images)
  }
  const content = [...outcome.displays]
  const shown = new Set(content.flatMap((part) => (part.type === "text" && part.text !== "" ? [part.text] : [])))
  if (outcome.returnValue !== undefined)
    content.push({ type: "text", text: stringifyReturn(outcome.returnValue, shown) })
  if (content.length === 0) content.push({ type: "text", text: "Done." })
  return { content, details: { value: outcome.returnValue, ...details } }
}

/**
 * The senpi `computer` tool: search-exposed, with the eval-kernel `computer` facade as its `kernelPrelude`.
 * Permission tiers are enforced only by the permission-system `tool_call` hook through
 * `computerPermissionParser`; `execute` evaluates no rule and shows no prompt of its own.
 */
export function createComputerTool(deps: ComputerToolDeps) {
  const { handle } = deps
  return {
    ...computerToolDefinition,
    async execute(
      toolCallId: string,
      input: Readonly<Record<string, unknown>>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      context: ComputerHostContext,
    ): Promise<ComputerToolResult> {
      const tooLarge = oversizeArgumentsResult(input, handle.settings().stopHotkey)
      if (tooLarge !== undefined) return tooLarge
      const params = parseComputerParams(input)
      switch (params.action) {
        case "call": {
          // Classifies (and rejects unknown or unchainable methods) before anything reaches the engine.
          const readOnly = isReadOnlyComputerCall(params.chain)
          const program: StepProgram = ({ desktop }) => interpretChain(desktop, params.chain)
          return permissionResult(
            runComputer(
              deps,
              context,
              { toolCallId, readOnly, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS },
              program,
              signal,
            ),
            handle,
          )
        }
        case "capabilities":
          // Like call, activation and capability-query permission failures are structured tool results.
          return permissionResult(
            (async () => {
              await handle.activate(context)
              return valueResult(await handle.service.capabilities(), "capabilities unavailable")
            })(),
            handle,
          )
        case "close":
          await handle.close()
          return valueResult(undefined, "Closed the desktop session.")
        default:
          return assertNever(params)
      }
    },
  }
}

// Engine failures returned as structured results, so the eval-kernel facade reads the code from `details.value`.
// StaleRef lets `computer.verify` tell a gone element from a failed read; its message names no code.
const STRUCTURED_ENGINE_CODES: ReadonlySet<string> = new Set([
  "PermissionDenied",
  "ControlRequired",
  "InputBusy",
  "Suspended",
  "StaleRef",
])

async function permissionResult(
  result: Promise<ComputerToolResult>,
  handle: ComputerHandle,
): Promise<ComputerToolResult> {
  try {
    return await result
  } catch (error) {
    if (error instanceof DesktopLaunchContextError) return failureResult(launchContextFailure(error), error.message)
    const stopHotkey = handle.settings().stopHotkey
    if (error instanceof DesktopCallBudgetError) {
      const failure = computerFailure(error.reason, error.message, stopHotkey)
      return failureResult(failure, JSON.stringify(failure, null, 2))
    }
    if (
      !(error instanceof DesktopEngineRpcError) ||
      error.data === null ||
      !("code" in error.data) ||
      !STRUCTURED_ENGINE_CODES.has(error.data.code)
    )
      throw error
    const failure = computerFailure(
      error.data.code,
      error.message,
      stopHotkey,
      error.data.permission,
      error.data.reason,
    )
    return failureResult(failure, JSON.stringify(failure, null, 2))
  }
}

export type ComputerTool = ReturnType<typeof createComputerTool>
