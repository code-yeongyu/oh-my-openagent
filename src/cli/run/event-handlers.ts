import pc from "picocolors"
import type {
  RunContext,
  EventPayload,
  SessionIdleProps,
  SessionStatusProps,
  SessionErrorProps,
  MessageUpdatedProps,
  MessagePartUpdatedProps,
  MessagePartDeltaProps,
  ToolExecuteProps,
  ToolResultProps,
  TuiToastShowProps,
} from "./types"
import type { EventState } from "./event-state"
import { serializeError } from "./event-formatting"
import { formatToolHeader } from "./tool-input-preview"
import { displayChars } from "./display-chars"
import {
  closeThinkBlock,
  openThinkBlock,
  renderAgentHeader,
  writePaddedText,
} from "./output-renderer"

function getSessionId(props?: { sessionID?: string; sessionId?: string }): string | undefined {
  return props?.sessionID ?? props?.sessionId
}

function getInfoSessionId(props?: {
  info?: { sessionID?: string; sessionId?: string }
}): string | undefined {
  return props?.info?.sessionID ?? props?.info?.sessionId
}

function getPartSessionId(props?: {
  part?: { sessionID?: string; sessionId?: string }
}): string | undefined {
  return props?.part?.sessionID ?? props?.part?.sessionId
}

function getPartMessageId(props?: {
  part?: { messageID?: string }
}): string | undefined {
  return props?.part?.messageID
}

function getDeltaMessageId(props?: {
  messageID?: string
}): string | undefined {
  return props?.messageID
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

export function handleSessionIdle(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.idle") return

  const props = payload.properties as SessionIdleProps | undefined
  if (getSessionId(props) === ctx.sessionID) {
    state.mainSessionIdle = true
  }
}

export function handleSessionStatus(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.status") return

  const props = payload.properties as SessionStatusProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  if (props?.status?.type === "busy") {
    state.mainSessionIdle = false
  } else if (props?.status?.type === "idle") {
    state.mainSessionIdle = true
  } else if (props?.status?.type === "retry") {
    state.mainSessionIdle = false
  }
}

export function handleSessionError(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.error") return

  const props = payload.properties as SessionErrorProps | undefined
  if (getSessionId(props) === ctx.sessionID) {
    state.mainSessionError = true
    state.lastError = serializeError(props?.error)
    console.error(pc.red(`\n[session.error] ${state.lastError}`))
  }
}

export function handleMessagePartUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.part.updated") return

  const props = payload.properties as MessagePartUpdatedProps | undefined
  // Current OpenCode puts sessionID inside part; legacy puts it in info
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
    const newText = reasoningText.slice(state.lastReasoningText.length)
    if (newText) {
      const padded = writePaddedText(newText, state.thinkingAtLineStart)
      process.stdout.write(pc.dim(padded.output))
      state.thinkingAtLineStart = padded.atLineStart
      state.hasReceivedMeaningfulWork = true
    }
    state.lastReasoningText = reasoningText
    return
  }

  closeThinkBlockIfNeeded(state)

  if (part.type === "text" && part.text) {
    const newText = part.text.slice(state.lastPartText.length)
    if (newText) {
      const padded = writePaddedText(newText, state.textAtLineStart)
      process.stdout.write(padded.output)
      state.textAtLineStart = padded.atLineStart
      state.hasReceivedMeaningfulWork = true
    }
    state.lastPartText = part.text

    if (part.time?.end) {
      const messageID = part.messageID ?? state.currentMessageId
      if (messageID) {
        renderCompletionMetaLine(state, messageID)
      }
    }
  }

  if (part.type === "tool") {
    handleToolPart(ctx, part, state)
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
    state.lastReasoningText += delta
    state.hasReceivedMeaningfulWork = true
    return
  }

  closeThinkBlockIfNeeded(state)

  const padded = writePaddedText(delta, state.textAtLineStart)
  process.stdout.write(padded.output)
  state.textAtLineStart = padded.atLineStart
  state.lastPartText += delta
  state.hasReceivedMeaningfulWork = true
}

function handleToolPart(
  _ctx: RunContext,
  part: NonNullable<MessagePartUpdatedProps["part"]>,
  state: EventState,
): void {
  const toolName = part.tool || part.name || "unknown"
  const status = part.state?.status

  if (status === "running") {
    if (state.currentTool !== null) return
    state.currentTool = toolName
    const header = formatToolHeader(toolName, part.state?.input ?? {})
    const suffix = header.description ? ` ${pc.dim(header.description)}` : ""
    state.hasReceivedMeaningfulWork = true
    process.stdout.write(`\n  ${pc.cyan(header.icon)} ${pc.bold(header.title)}${suffix}  \n`)
  }

  if (status === "completed" || status === "error") {
    if (state.currentTool === null) return
    const output = part.state?.output || ""
    if (output.trim()) {
      process.stdout.write(pc.dim(`  ${displayChars.treeEnd} output  \n`))
      const padded = writePaddedText(output, true)
      process.stdout.write(pc.dim(padded.output + (padded.atLineStart ? "" : "  ")))
      process.stdout.write("\n")
    }
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

  if (props?.info?.role !== "assistant") return

  const isNewMessage = !messageID || messageID !== state.currentMessageId
  if (isNewMessage) {
    state.currentMessageId = messageID
    state.hasReceivedMeaningfulWork = true
    state.messageCount++
    state.lastPartText = ""
    state.lastReasoningText = ""
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

export function handleToolExecute(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.execute") return

  const props = payload.properties as ToolExecuteProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  closeThinkBlockIfNeeded(state)

  if (state.currentTool !== null) return

  const toolName = props?.name || "unknown"
  state.currentTool = toolName
  const header = formatToolHeader(toolName, props?.input ?? {})
  const suffix = header.description ? ` ${pc.dim(header.description)}` : ""

  state.hasReceivedMeaningfulWork = true
  process.stdout.write(`\n  ${pc.cyan(header.icon)} ${pc.bold(header.title)}${suffix}  \n`)
}

export function handleToolResult(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.result") return

  const props = payload.properties as ToolResultProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  closeThinkBlockIfNeeded(state)

  if (state.currentTool === null) return

  const output = props?.output || ""
  if (output.trim()) {
    process.stdout.write(pc.dim(`  ${displayChars.treeEnd} output  \n`))
    const padded = writePaddedText(output, true)
    process.stdout.write(pc.dim(padded.output + (padded.atLineStart ? "" : "  ")))
    process.stdout.write("\n")
  }

  state.currentTool = null
  state.lastPartText = ""
  state.textAtLineStart = true
}

export function handleTuiToast(_ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tui.toast.show") return

  const props = payload.properties as TuiToastShowProps | undefined
  const variant = props?.variant ?? "info"

  if (variant === "error") {
    const title = props?.title ? `${props.title}: ` : ""
    const message = props?.message?.trim()
    if (message) {
      state.mainSessionError = true
      state.lastError = `${title}${message}`
    }
  }
}

function ensureThinkBlockOpen(state: EventState): void {
  if (state.inThinkBlock) return
  openThinkBlock()
  state.inThinkBlock = true
  state.hasPrintedThinkingLine = false
  state.thinkingAtLineStart = false
}

function closeThinkBlockIfNeeded(state: EventState): void {
  if (!state.inThinkBlock) return
  closeThinkBlock()
  state.inThinkBlock = false
  state.lastThinkingLineWidth = 0
  state.lastThinkingSummary = ""
  state.thinkingAtLineStart = false
}
