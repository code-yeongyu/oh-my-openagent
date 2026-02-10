import pc from "picocolors"
import type {
  RunContext,
  EventPayload,
  SessionIdleProps,
  SessionStatusProps,
  SessionErrorProps,
  MessageUpdatedProps,
  MessagePartUpdatedProps,
  ToolExecuteProps,
  ToolResultProps,
} from "./types"
import type { EventState } from "./event-state"
import { serializeError } from "./event-formatting"

export function handleSessionIdle(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.idle") return

  const props = payload.properties as SessionIdleProps | undefined
  if (props?.sessionID === ctx.sessionID) {
    state.mainSessionIdle = true
  }
}

export function handleSessionStatus(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "session.status") return

  const props = payload.properties as SessionStatusProps | undefined
  if (props?.sessionID !== ctx.sessionID) return

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
  if (props?.sessionID === ctx.sessionID) {
    state.mainSessionError = true
    state.lastError = serializeError(props?.error)
    console.error(pc.red(`\n[session.error] ${state.lastError}`))
  }
}

export function handleMessagePartUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.part.updated") return

  const props = payload.properties as MessagePartUpdatedProps | undefined
  if (props?.info?.sessionID !== ctx.sessionID) return
  if (props?.info?.role !== "assistant") return

  const part = props.part
  if (!part) return

  if (part.type === "text" && part.text) {
    const newText = part.text.slice(state.lastPartText.length)
    if (newText) {
      process.stdout.write(newText)
      state.hasReceivedMeaningfulWork = true
    }
    state.lastPartText = part.text
  }
}

export function handleMessageUpdated(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "message.updated") return

  const props = payload.properties as MessageUpdatedProps | undefined
  if (props?.info?.sessionID !== ctx.sessionID) return
  if (props?.info?.role !== "assistant") return

  state.hasReceivedMeaningfulWork = true
  state.messageCount++
  state.lastPartText = ""
}

export function handleToolExecute(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.execute") return

  const props = payload.properties as ToolExecuteProps | undefined
  if (props?.sessionID !== ctx.sessionID) return

  const toolName = props?.name || "unknown"
  state.currentTool = toolName

  let inputPreview = ""
  if (props?.input) {
    const input = props.input
    if (input.command) {
      inputPreview = ` ${pc.dim(String(input.command).slice(0, 60))}`
    } else if (input.pattern) {
      inputPreview = ` ${pc.dim(String(input.pattern).slice(0, 40))}`
    } else if (input.filePath) {
      inputPreview = ` ${pc.dim(String(input.filePath))}`
    } else if (input.query) {
      inputPreview = ` ${pc.dim(String(input.query).slice(0, 40))}`
    }
  }

  state.hasReceivedMeaningfulWork = true
  process.stdout.write(`\n${pc.cyan(">")} ${pc.bold(toolName)}${inputPreview}\n`)
}

export function handleToolResult(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.result") return

  const props = payload.properties as ToolResultProps | undefined
  if (props?.sessionID !== ctx.sessionID) return

  const output = props?.output || ""
  const maxLen = 200
  const preview = output.length > maxLen ? output.slice(0, maxLen) + "..." : output

  if (preview.trim()) {
    const lines = preview.split("\n").slice(0, 3)
    process.stdout.write(pc.dim(`   └─ ${lines.join("\n      ")}\n`))
  }

  state.currentTool = null
  state.lastPartText = ""
}
