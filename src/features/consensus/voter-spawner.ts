import type { PluginInput } from "@opencode-ai/plugin"
import type { ResolvedVoterCandidate, VoterPosition } from "./types"
import { isAmbiguousPostDispatchPromptFailure, log, normalizeSDKResponse } from "../../shared"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../hooks/shared/prompt-async-gate"
import { subagentSessions } from "../claude-code-session-state"

const DEFAULT_VOTER_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1_500
const STABILITY_REQUIRED_POLLS = 3
const DEFAULT_VOTER_REASONING_EFFORT = "high"

const VOTER_FRAMING = [
  "You are a single voter in a multi-model consensus panel. You are NOT an orchestrator.",
  "Give YOUR OWN direct position on the question below in this one response. Do not delegate, do not spawn agents, do not call tools, do not say you will research first or wait for others. You have no follow-up turn.",
  "State your position, your reasoning, a confidence level, and what would change your mind. Be decisive even under uncertainty: pick the best answer and own it.",
  "",
  "--- QUESTION ---",
  "",
].join("\n")

const VOTER_DISABLED_TOOLS: Record<string, boolean> = {
  task: false,
  call_omo_agent: false,
  question: false,
  background_output: false,
  background_cancel: false,
}

function buildVoterPrompt(prompt: string): string {
  return VOTER_FRAMING + prompt
}

type SpawnVoterArgs = {
  candidate: ResolvedVoterCandidate
  prompt: string
  parentSessionID: string
  parentDirectory: string | undefined
  voterTimeoutMs: number
  reasoningEffort?: string
}

type VoterPromptInput = {
  path: { id: string }
  body: {
    model: { providerID: string; modelID: string }
    variant?: string
    options?: { reasoningEffort: string }
    tools: Record<string, boolean>
    parts: Array<{ type: "text"; text: string }>
  }
  url: "/session/{id}/message"
}

export async function spawnVoter(ctx: PluginInput, args: SpawnVoterArgs): Promise<VoterPosition> {
  const { candidate, prompt, parentSessionID, parentDirectory, voterTimeoutMs, reasoningEffort } = args
  const startedAt = Date.now()
  const { providerID, modelID } = candidate
  const effort = reasoningEffort ?? DEFAULT_VOTER_REASONING_EFFORT
  const baseResult: VoterPosition = {
    lineage: candidate.lineage,
    model: modelID,
    providerID,
    variant: candidate.variant,
    status: "error",
    text: "",
    durationMs: 0,
  }

  let sessionID: string | undefined
  try {
    const createResult = await ctx.client.session.create({
      body: {
        parentID: parentSessionID,
        title: `consensus voter (${candidate.lineage})`,
      },
      query: parentDirectory ? { directory: parentDirectory } : undefined,
    })
    if (createResult.error || !createResult.data?.id) {
      return { ...baseResult, errorMessage: `session.create failed: ${String(createResult.error ?? "unknown")}`, durationMs: Date.now() - startedAt }
    }
    sessionID = createResult.data.id
    subagentSessions.add(sessionID)

    const promptInput: VoterPromptInput = {
      path: { id: sessionID },
      body: {
        model: { providerID, modelID },
        ...(candidate.variant ? { variant: candidate.variant } : {}),
        ...(effort ? { options: { reasoningEffort: effort } } : {}),
        tools: VOTER_DISABLED_TOOLS,
        parts: [{ type: "text", text: buildVoterPrompt(prompt) }],
      },
      url: "/session/{id}/message",
    }

    const dispatchResult = await dispatchInternalPrompt<VoterPromptInput>({
      mode: "sync",
      client: ctx.client,
      sessionID,
      source: "consensus:voter",
      settleMs: 0,
      queueBehavior: "defer",
      input: promptInput,
    })
    const promptMayHaveBeenAccepted = dispatchResult.status === "failed"
      && isAmbiguousPostDispatchPromptFailure(dispatchResult)
    if (dispatchResult.status === "failed" && !promptMayHaveBeenAccepted) {
      throw dispatchResult.error
    }
    if (!promptMayHaveBeenAccepted && !isInternalPromptDispatchAccepted(dispatchResult)) {
      throw new Error(`consensus voter prompt skipped by gate: ${dispatchResult.status}`)
    }

    const text = await waitForResult(ctx, sessionID, voterTimeoutMs)
    return { ...baseResult, status: "ok", text, durationMs: Date.now() - startedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout = message.includes("timeout") || message.includes("timed out")
    return {
      ...baseResult,
      status: isTimeout ? "timeout" : "error",
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    if (sessionID) {
      subagentSessions.delete(sessionID)
    }
  }
}

async function waitForResult(ctx: PluginInput, sessionID: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastMsgCount = 0
  let stablePolls = 0
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    const statusResult = await ctx.client.session.status()
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[sessionID]
    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0
      lastMsgCount = 0
      continue
    }
    const messagesResult = await ctx.client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(messagesResult, [] as Array<unknown>, { preferResponseOnMissingData: true })
    if (messages.length > 0 && messages.length === lastMsgCount) {
      stablePolls++
      if (stablePolls >= STABILITY_REQUIRED_POLLS) return extractAssistantText(messages)
    } else {
      stablePolls = 0
      lastMsgCount = messages.length
    }
  }
  log(`[consensus] voter timeout for session=${sessionID} after ${timeoutMs}ms`)
  throw new Error(`voter timed out after ${timeoutMs}ms`)
}

export function extractAssistantText(messages: ReadonlyArray<unknown>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!isAssistantMessage(msg)) continue
    const text = msg.parts.filter(isTextPart).map(part => part.text).join("\n").trim()
    if (text) return text
  }
  return ""
}

type AssistantMessageWithParts = {
  readonly info?: { readonly role?: string }
  readonly parts: ReadonlyArray<unknown>
}

type TextPart = {
  readonly type: "text"
  readonly text: string
}

function isAssistantMessage(value: unknown): value is AssistantMessageWithParts {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.parts)) return false
  if (!isRecord(value.info)) return false
  return value.info.role === "assistant"
}

function isTextPart(value: unknown): value is TextPart {
  return isRecord(value) && value.type === "text" && typeof value.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const VOTER_SPAWNER_DEFAULTS = {
  DEFAULT_VOTER_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  STABILITY_REQUIRED_POLLS,
  DEFAULT_VOTER_REASONING_EFFORT,
} as const
