import {
  type AuditRecord,
  type ComputerCallStep,
  type ComputerDisplay,
  type ComputerScreenshot,
  type EngineMethod,
  isReadOnlyComputerCall,
} from "@oh-my-opencode/senpi-desktop-protocol"
import type { ActionReport } from "@oh-my-opencode/senpi-desktop-sdk"
import {
  type ComputerRunHost,
  type ComputerRunSandbox,
  DesktopEngineRpcError,
  DesktopLaunchContextError,
  type ExecuteTool,
  runComputerCode,
} from "@oh-my-opencode/senpi-desktop-service"
import type { ComputerHandle } from "./activation"
import { Check } from "typebox/value"
import { actionBranches, argumentsError } from "./action-schema"
import { ComputerActionBranches, ComputerActionShape, type ComputerToolParams, DEFAULT_TIMEOUT_SECONDS } from "./params"
import { type ComputerHostContext, runSnapshot } from "./session"
import { computerToolDefinition } from "./tool-definition"
import { computerFailure, launchContextFailure } from "./cua-errors"

/** One `desktop.control.acquire` confirmation request, carried to the host component (#9651 B5b). */
export interface ControlConfirmRequest {
  readonly context: ComputerHostContext
  readonly reason: string
  readonly signal: AbortSignal
  /** How long the run can still wait for the answer; the confirm must settle within it. */
  readonly budgetMs?: number
}

export interface ComputerToolDeps {
  readonly handle: ComputerHandle
  /** The host tool pipeline (`pi.executeTool`) behind `tool.<name>()` inside `run` code. */
  readonly executeTool: ExecuteTool
  /** The host component's human confirm for the foreground-control grant; absent: never grants. */
  readonly confirmControl?: (request: ControlConfirmRequest) => Promise<boolean>
}

/** `details` of every `computer` result; `value` is what the eval-kernel `computer` facade returns. */
export interface ComputerToolDetails {
  readonly value?: unknown
  readonly readOnly?: boolean
  readonly screenshots?: readonly ComputerScreenshot[]
  readonly audit?: readonly AuditRecord[]
  /** Where the run executed: `quickjs` only for model-written `run` code under `computer.run_sandbox: "quickjs"`. */
  readonly sandbox?: ComputerRunSandbox
  /**
   * The SDK `ActionReport` of the run's last input action; absent when the run sent none. `legacy: true` when the
   * engine replied `null` (it does not advertise `action-report`).
   */
  readonly report?: ActionReport
  /** Every input action's report in send order, when the run sent more than one. */
  readonly reports?: readonly ActionReport[]
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

/** `desktop.<root>(...)` and at most one handle hop; every name was validated against the tier tables first. */
function renderCallChain(chain: readonly ComputerCallStep[]): string {
  const call = (step: ComputerCallStep) => `${step.method}(...${JSON.stringify(step.args ?? [])})`
  const [root, hop] = chain
  if (root === undefined) throw new TypeError("renderCallChain: empty chain")
  return hop === undefined
    ? `return await desktop.${call(root)};`
    : `return await (await desktop.${call(root)}).${call(hop)};`
}

const SHOWN_ABOVE = "[shown above]"

/** The return value without repeating observe's AX tree when the run already displayed it verbatim. */
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

/** Engine methods whose reply is `null` or an `ActionReport` (`ax.typeText`: the reply's `report` member). */
const EXEC_REPLY_METHODS: ReadonlySet<EngineMethod> = new Set<EngineMethod>([
  "click",
  "moveMouse",
  "drag",
  "scroll",
  "typeText",
  "keyChord",
  "holdKeys",
  "holdMouse",
  "raiseWindow",
  "menus.select",
  "clipboard.write",
  "ax.perform",
  "ax.setValue",
  "ax.focus",
  "ax.click",
  "ax.typeText",
])

/** The SDK report of an engine that replied `null`: sent, unverified, never safe to resend (SDK `legacyReport`). */
const LEGACY_REPORT: ActionReport = {
  disposition: { delivery: "delivered_unverified", retry: "unsafe" },
  delivered: null,
  effect: "unverifiable",
  route: null,
  hit: null,
  focusRestoration: "not_confirmed",
  openedSurfaces: [],
  nextCall: null,
  note: null,
  warning: null,
  auditIds: [],
  timings: null,
  legacy: true,
}

/** An engine `ActionReport` as the wire carries it: the four required members, the rest optional. */
type EngineReport = Pick<ActionReport, "disposition" | "effect" | "focusRestoration" | "auditIds"> &
  Partial<Pick<ActionReport, "delivered" | "route" | "openedSurfaces" | "nextCall" | "note" | "warning">> & {
    readonly hit?: { readonly role: NonNullable<ActionReport["hit"]>["role"]; readonly label?: string | null } | null
  }

/**
 * An exec reply in the SDK's `ActionReport` shape, member for member as the SDK maps it. Nothing has checked the
 * reply yet: `reportingService` sits under the run facade and records each reply as the engine sent it, before the
 * facade validates it (`expectResult` with `isExecResult`). A malformed reply is recorded here and only then fails
 * that check, and even a reply that passes it carries `effect`, `route` and `focusRestoration` checked only as strings,
 * not as members of the SDK's unions.
 */
function actionReportOf(reply: unknown): ActionReport {
  if (reply === null || reply === undefined) return LEGACY_REPORT
  const report = reply as EngineReport
  return {
    disposition: report.disposition,
    delivered: report.delivered ?? null,
    effect: report.effect,
    route: report.route ?? null,
    hit: report.hit == null ? null : { role: report.hit.role, label: report.hit.label ?? null },
    focusRestoration: report.focusRestoration,
    openedSurfaces: report.openedSurfaces ?? [],
    nextCall: report.nextCall ?? null,
    note: report.note ?? null,
    warning: report.warning ?? null,
    auditIds: report.auditIds,
    timings: null,
    legacy: false,
  }
}

/** The run's engine channel, recording the report of every input action it carries. */
function reportingService(service: ComputerHandle["service"], reports: ActionReport[]): ComputerRunHost["service"] {
  return {
    call: async (method, params, options) => {
      const reply = await service.call(method, params, options)
      if (EXEC_REPLY_METHODS.has(method)) {
        reports.push(actionReportOf(method === "ax.typeText" ? Reflect.get(Object(reply), "report") : reply))
      }
      return reply
    },
    onAudit: (listener) => service.onAudit(listener),
    revokeControl: () => service.revokeControl(),
    reportError: (error) => service.reportError(error),
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unhandled computer action ${JSON.stringify(value)}`)
}

/** A `computer` run: activates the session (arming the stop chord) and runs `code` through the desktop facade. */
export async function runComputer(
  deps: ComputerToolDeps,
  context: ComputerHostContext,
  request: {
    readonly code: string
    readonly readOnly: boolean
    readonly timeoutSeconds: number
    /** `host` for code the host built (call chains, the CUA batch), which stays on vm whatever the setting. */
    readonly origin: "host" | "model"
  },
  signal: AbortSignal | undefined,
): Promise<ComputerToolResult> {
  const { handle, executeTool } = deps
  await handle.activate(context)
  const settings = handle.settings()
  const snapshot = runSnapshot(settings, context, request.readOnly)
  const timeoutMs = request.timeoutSeconds * 1000
  const confirmControl = deps.confirmControl
  const reports: ActionReport[] = []
  const outcome = await runComputerCode(
    {
      code: request.code,
      snapshot,
      timeoutMs,
      sandbox: settings.runSandbox,
      origin: request.origin,
      ...(signal === undefined ? {} : { signal }),
    },
    {
      service: reportingService(handle.service, reports),
      executeTool,
      ...(confirmControl === undefined
        ? {}
        : {
            confirmControl: (reason: string, runSignal: AbortSignal, budgetMs: number) =>
              confirmControl({ context, reason, signal: runSignal, budgetMs }),
          }),
    },
  )
  const content = [...outcome.displays]
  const shown = new Set(content.flatMap((part) => (part.type === "text" && part.text !== "" ? [part.text] : [])))
  if (outcome.returnValue !== undefined)
    content.push({ type: "text", text: stringifyReturn(outcome.returnValue, shown) })
  if (content.length === 0) content.push({ type: "text", text: "Done." })
  return {
    content,
    details: {
      value: outcome.returnValue,
      readOnly: request.readOnly,
      screenshots: outcome.screenshots,
      audit: outcome.audit,
      sandbox: outcome.sandbox,
      ...(reports.length === 0 ? {} : { report: reports[reports.length - 1] }),
      ...(reports.length > 1 ? { reports } : {}),
    },
  }
}

/**
 * The senpi `computer` tool: search-exposed, with the eval-kernel `computer` facade as its `kernelPrelude`.
 * Permission tiers are enforced only by the permission-system `tool_call` hook through
 * `computerPermissionParser`; `execute` evaluates no rule and shows no prompt of its own.
 */
export function createComputerTool(deps: ComputerToolDeps) {
  const { handle } = deps
  const run = (
    context: ComputerHostContext,
    request: Parameters<typeof runComputer>[2],
    signal: AbortSignal | undefined,
  ) => runComputer(deps, context, request, signal)

  return {
    ...computerToolDefinition,
    async execute(
      _toolCallId: string,
      input: Readonly<Record<string, unknown>>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      context: ComputerHostContext,
    ): Promise<ComputerToolResult> {
      const params = parseComputerParams(input)
      switch (params.action) {
        case "call": {
          // Classifies (and rejects unknown or unchainable methods) before anything reaches the engine.
          const readOnly = isReadOnlyComputerCall(params.chain)
          const code = renderCallChain(params.chain)
          return permissionResult(
            run(context, { code, readOnly, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, origin: "host" }, signal),
            handle,
          )
        }
        case "run": {
          const timeoutSeconds = params.timeout ?? DEFAULT_TIMEOUT_SECONDS
          return permissionResult(
            run(
              context,
              { code: params.code, readOnly: params.read_only === true, timeoutSeconds, origin: "model" },
              signal,
            ),
            handle,
          )
        }
        case "capabilities":
          // Like call/run, activation and capability-query permission failures are structured tool results.
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
    if (error instanceof DesktopLaunchContextError) {
      const failure = launchContextFailure(error)
      return {
        content: [{ type: "text", text: error.message }],
        details: { value: failure, isError: true },
        isError: true,
      }
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
      handle.settings().stopHotkey,
      error.data.permission,
      error.data.reason,
    )
    return {
      content: [{ type: "text", text: JSON.stringify(failure, null, 2) }],
      details: { value: failure, isError: true },
      isError: true,
    }
  }
}

export type ComputerTool = ReturnType<typeof createComputerTool>
