import pc from "picocolors"
import type { EventState } from "./event-state"
import { displayChars } from "./display-chars"
import {
  getDeltaMessageId,
  getInfoSessionId,
  getPartMessageId,
  getPartSessionId,
} from "./event-session-ids"
import { closeThinkBlockIfNeeded, ensureThinkBlockOpen } from "./event-think-block"
import { writeToolHeader, writeToolOutput } from "./event-tool-output"
import { renderAgentHeader, writePaddedText } from "./output-renderer"
import type { EventPayload, MessagePartDeltaProps, MessagePartUpdatedProps, MessageUpdatedProps, RunContext } from "./types"

function resolveRenderedBaseline(
  baselinesById: Record<string, string>,
  partKey: string,
  snapshotText: string,
): string {
  const ownBaseline = baselinesById[partKey]
  if (ownBaseline !== undefined) {
    return snapshotText.startsWith(ownBaseline) ? ownBaseline : ""
  }
  const anonymousBaseline = partKey === "" ? undefined : baselinesById[""]
  if (anonymousBaseline !== undefined && snapshotText.startsWith(anonymousBaseline)) {
    return anonymousBaseline
  }
  return ""
}

function renderCompletionMetaLine(state: EventState, messageID: string): void {
  if (state.completionMetaPrintedByMessageId[messageID]) return

  const startedAt = state.messageStartedAtById[messageID]
  const elapsedSec = startedAt ? ((Date.now() - startedAt) / 1000).toFixed(1) : "0.0"
  const agent = state.currentAgent ?? "assistant"
  const model = state.currentModel ?? "unknown-model"
  const variant = state.currentVariant ? ` (${state.currentVariant})` : ""

  process.stdout.write(pc.dim(`\n  ${displayChars.treeEnd} ${agent} · ${model}${variant} · ${elapsedSec}s  \n`))
  state.completionMetaPrintedByMessageId[messageID] = true
}

export function handleMessagePartUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.part.updated") return

  const props = payload.properties as MessagePartUpdatedProps | undefined
  const partSid = getPartSessionId(props)
  const infoSid = getInfoSessionId(props)
  if ((partSid ?? infoSid) !== ctx.sessionID) return

  const role = props?.info?.role
  const mappedRole = getPartMessageId(props)
    ? state.messageRoleById[getPartMessageId(props) ?? ""]
    : undefined
  if ((role ?? mappedRole) === "user") return

  const part = props?.part
  if (!part) return

  if (part.id && part.type) {
    state.partTypesById[part.id] = part.type
  }

  if (part.type === "reasoning") {
    ensureThinkBlockOpen(state)
    const reasoningText = part.text ?? ""
    const reasoningKey = part.id ?? ""
    const renderedReasoning = resolveRenderedBaseline(
      state.reasoningTextById,
      reasoningKey,
      reasoningText,
    )
    const newReasoning = reasoningText.slice(renderedReasoning.length)
    if (newReasoning) {
      const padded = writePaddedText(newReasoning, state.thinkingAtLineStart)
      process.stdout.write(pc.dim(padded.output))
      state.thinkingAtLineStart = padded.atLineStart
      state.mainSessionStarted = true
      state.hasReceivedMeaningfulWork = true
    }
    state.reasoningTextById[reasoningKey] = reasoningText
    state.lastReasoningText = reasoningText
    return
  }

  closeThinkBlockIfNeeded(state)

  if (part.type === "text" && part.text) {
    const textKey = part.id ?? ""
    const renderedText = resolveRenderedBaseline(state.partTextById, textKey, part.text)
    const newText = part.text.slice(renderedText.length)
    if (newText) {
      const padded = writePaddedText(newText, state.textAtLineStart)
      process.stdout.write(padded.output)
      state.textAtLineStart = padded.atLineStart
      state.mainSessionStarted = true
      state.hasReceivedMeaningfulWork = true
    }
    state.partTextById[textKey] = part.text
    state.lastPartText = part.text

    if (part.time?.end) {
      const messageID = part.messageID ?? state.currentMessageId
      if (messageID) {
        renderCompletionMetaLine(state, messageID)
      }
    }
  }

  if (part.type === "tool") {
    state.mainSessionStarted = true
    handleToolPart(part, state)
  }
}

export function handleMessagePartDelta(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.part.delta") return

  const props = payload.properties as MessagePartDeltaProps | undefined
  const sessionID = props?.sessionID ?? props?.sessionId
  if (sessionID !== ctx.sessionID) return

  const role = getDeltaMessageId(props)
    ? state.messageRoleById[getDeltaMessageId(props) ?? ""]
    : undefined
  if (role === "user") return

  if (props?.field !== "text") return

  const partType = props?.partID ? state.partTypesById[props.partID] : undefined

  const delta = props.delta ?? ""
  if (!delta) return

  if (partType === "reasoning") {
    ensureThinkBlockOpen(state)
    const padded = writePaddedText(delta, state.thinkingAtLineStart)
    process.stdout.write(pc.dim(padded.output))
    state.thinkingAtLineStart = padded.atLineStart
    const reasoningKey = props?.partID ?? ""
    state.reasoningTextById[reasoningKey] = (state.reasoningTextById[reasoningKey] ?? "") + delta
    state.lastReasoningText += delta
    state.mainSessionStarted = true
    state.hasReceivedMeaningfulWork = true
    return
  }

  closeThinkBlockIfNeeded(state)

  const padded = writePaddedText(delta, state.textAtLineStart)
  process.stdout.write(padded.output)
  state.textAtLineStart = padded.atLineStart
  const textKey = props?.partID ?? ""
  state.partTextById[textKey] = (state.partTextById[textKey] ?? "") + delta
  state.lastPartText += delta
  state.mainSessionStarted = true
  state.hasReceivedMeaningfulWork = true
}

function handleToolPart(part: NonNullable<MessagePartUpdatedProps["part"]>, state: EventState): void {
  const toolName = part.tool || part.name || "unknown"
  const status = part.state?.status

  if (status === "running") {
    if (state.currentTool !== null) return
    state.currentTool = toolName
    state.hasReceivedMeaningfulWork = true
    writeToolHeader(toolName, part.state?.input ?? {})
  }

  if (status === "completed" || status === "error") {
    if (state.currentTool === null) return
    writeToolOutput(part.state?.output || "")
    state.currentTool = null
    state.lastPartText = ""
    state.textAtLineStart = true
  }
}

export function handleMessageUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.updated") return

  const props = payload.properties as MessageUpdatedProps | undefined
  if (getInfoSessionId(props) !== ctx.sessionID) return

  state.currentMessageRole = props?.info?.role ?? null

  const messageID = props?.info?.id ?? null
  const role = props?.info?.role
  if (messageID && role) {
    state.messageRoleById[messageID] = role
  }
  if (messageID) {
    state.mainSessionStarted = true
  }

  if (props?.info?.role !== "assistant") return

  const isNewMessage = !messageID || messageID !== state.currentMessageId
  if (isNewMessage) {
    state.currentMessageId = messageID
    state.mainSessionStarted = true
    state.hasReceivedMeaningfulWork = true
    state.messageCount++
    state.lastPartText = ""
    state.lastReasoningText = ""
    state.partTextById = {}
    state.reasoningTextById = {}
    state.hasPrintedThinkingLine = false
    state.lastThinkingSummary = ""
    state.textAtLineStart = true
    state.thinkingAtLineStart = false
    closeThinkBlockIfNeeded(state)
    if (messageID) {
      state.messageStartedAtById[messageID] = Date.now()
      state.completionMetaPrintedByMessageId[messageID] = false
    }
  }

  const agent = props?.info?.agent ?? null
  const model = props?.info?.modelID ?? null
  const variant = props?.info?.variant ?? null
  if (agent !== state.currentAgent || model !== state.currentModel || variant !== state.currentVariant) {
    state.currentAgent = agent
    state.currentModel = model
    state.currentVariant = variant
    renderAgentHeader(agent, model, variant, state.agentColorsByName)
  }
}
