import type { AgentToolResult, AgentToolUpdateCallback, Theme, ToolDefinition, ToolRenderResultOptions } from "@code-yeongyu/senpi"
import type { Message } from "@oh-my-opencode/team-core/types"
import { Type, type Static } from "typebox"

import type { ToolProgressDetails } from "../../progress"
import type { WaitRegistration } from "../../team/messaging/wait-registry"
import { clampWaitTimeout, toolResult } from "../control"
import { linesComponent } from "../task/renderers"
import type { LeadTeamToolDeps } from "./types"

export const TeamWaitParams = Type.Object({
  from: Type.Optional(Type.String({ description: "Only receive from this member." })),
  timeout_ms: Type.Optional(Type.Number({ description: "Bounded wait timeout in milliseconds." })),
  team_run_id: Type.Optional(Type.String({ description: "Team run id when this session leads more than one team." })),
})

export type TeamWaitInput = Static<typeof TeamWaitParams>

type WaitingProgress = ToolProgressDetails["progress"] & { readonly maxWaitMs: number }

export type TeamWaitDetails =
  | { readonly kind: "waiting"; readonly progress: WaitingProgress }
  | { readonly kind: "message"; readonly message_id: string; readonly from: string; readonly body: string }
  | { readonly kind: "timeout"; readonly timeout_ms: number }
  | { readonly kind: "invalid_arguments"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly team_run_id: string }

export class TeamWaitAbortedError extends Error {
  constructor() {
    super("team_wait aborted")
    this.name = "TeamWaitAbortedError"
  }
}

export async function runTeamWait(
  deps: LeadTeamToolDeps,
  input: TeamWaitInput,
  signal: AbortSignal | undefined,
  onUpdate?: AgentToolUpdateCallback<TeamWaitDetails>,
): Promise<AgentToolResult<TeamWaitDetails>> {
  const resolved = await deps.resolveTeamRunId(input.team_run_id)
  if (!resolved.ok) {
    return toolResult(resolved.reason, { kind: "invalid_arguments", reason: resolved.reason })
  }

  const poller = deps.resolveLeadPoller(resolved.teamRunId)
  if (poller === undefined) {
    return toolResult(`No lead poller is active for team ${resolved.teamRunId}.`, {
      kind: "unavailable",
      team_run_id: resolved.teamRunId,
    })
  }

  const timeoutMs = clampWaitTimeout(input.timeout_ms, deps.waitBounds)
  const activity = `waiting for team message${input.from === undefined ? "" : ` from ${input.from}`}`
  onUpdate?.(toolResult(activity, { kind: "waiting", progress: { activity, startedAt: Date.now(), maxWaitMs: timeoutMs } }))
  const filter = input.from === undefined ? {} : { from: input.from }
  const registration = deps.registry.register(resolved.teamRunId, filter)
  try {
    const delivered = deps.deliveryJournal?.takeOldestUnreported(resolved.teamRunId, filter)
    if (delivered !== undefined) {
      registration.cancel()
      await poller.suppressDelivered?.(delivered.messageId)
      return toolResult(formatMessageText(delivered), {
        kind: "message",
        message_id: delivered.messageId,
        from: delivered.from,
        body: delivered.body,
      })
    }
    await poller.pollOnce(filter)
    const outcome = await waitForMessage(registration, timeoutMs, signal)
    switch (outcome.kind) {
      case "timeout":
        return toolResult(
          `No team message arrived within ${timeoutMs}ms. Check task_output for a committed team_message_waited recovery event.`,
          { kind: "timeout", timeout_ms: timeoutMs },
        )
      case "message":
        return toolResult(formatMessageText(outcome.message), {
          kind: "message",
          message_id: outcome.message.messageId,
          from: outcome.message.from,
          body: outcome.message.body,
        })
      default:
        return assertNever(outcome)
    }
  } finally {
    registration.cancel()
  }
}

export function createTeamWaitTool(
  deps: LeadTeamToolDeps,
): ToolDefinition {
  return {
    name: "team_wait",
    label: "Team Wait",
    description: "Wait for the next durable message to the current team lead, optionally filtered by sender.",
    parameters: TeamWaitParams,
    execute: (_toolCallId: string, params: TeamWaitInput, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<TeamWaitDetails> | undefined) => runTeamWait(deps, params, signal, onUpdate),
    renderResult: (result, options, theme) => renderTeamWaitResult(result, options, theme),
  }
}

type TeamWaitRenderTheme = Pick<Theme, "fg">

type WaitRenderComponent = {
  render(width: number): string[]
  invalidate(): void
}

function renderTeamWaitResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: TeamWaitRenderTheme,
): WaitRenderComponent {
  const text = options.isPartial && isWaitingDetails(result.details)
    ? result.details.progress.activity
    : result.content[0]?.type === "text" ? result.content[0].text : "team_wait"
  return linesComponent([theme.fg("toolTitle", text)])
}

function isWaitingDetails(details: unknown): details is Extract<TeamWaitDetails, { readonly kind: "waiting" }> {
  return typeof details === "object" && details !== null && "kind" in details && details.kind === "waiting"
}

type WaitOutcome =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "timeout" }

async function waitForMessage(
  registration: WaitRegistration<Message>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<WaitOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  const timeout = new Promise<WaitOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
  })
  const abort = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return
    abortListener = () => reject(signal.reason ?? new TeamWaitAbortedError())
    if (signal.aborted) abortListener()
    else signal.addEventListener("abort", abortListener, { once: true })
  })

  try {
    return await Promise.race([
      registration.promise.then((message): WaitOutcome => ({ kind: "message", message })),
      timeout,
      abort,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (signal !== undefined && abortListener !== undefined) signal.removeEventListener("abort", abortListener)
  }
}

const MESSAGE_BODY_TEXT_MAX = 4_000

// The wait result is the ONLY model-visible copy of the body (tool details never reach the model),
// so the text must carry it; oversized bodies are bounded with a pointer to the structured details.
function formatMessageText(message: Message): string {
  const header = `Message from ${message.from} (id: ${message.messageId}):`
  const summary = message.summary === undefined ? "" : `\nsummary: ${message.summary}`
  const body = message.body.length <= MESSAGE_BODY_TEXT_MAX
    ? message.body
    : `${message.body.slice(0, MESSAGE_BODY_TEXT_MAX)}\n...[truncated, full body in details]`
  return `${header}${summary}\n${body}`
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected team_wait outcome: ${JSON.stringify(value)}`)
}
