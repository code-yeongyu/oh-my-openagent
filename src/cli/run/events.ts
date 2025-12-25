import pc from "picocolors"
import type {
  RunContext,
  EventPayload,
  SessionIdleProps,
  SessionStatusProps,
  MessageUpdatedProps,
  MessagePartUpdatedProps,
  ToolExecuteProps,
  ToolResultProps,
} from "./types"

export interface EventState {
  mainSessionIdle: boolean
  lastOutput: string
  lastPartText: string
  currentTool: string | null
}

export function createEventState(): EventState {
  return {
    mainSessionIdle: false,
    lastOutput: "",
    lastPartText: "",
    currentTool: null,
  }
}

export async function processEvents(
  ctx: RunContext,
  stream: AsyncIterable<unknown>,
  state: EventState
): Promise<void> {
  for await (const event of stream) {
    if (ctx.abortController.signal.aborted) break

    try {
      const payload = event as EventPayload
      if (!payload?.type) continue

      handleSessionIdle(ctx, payload, state)
      handleSessionStatus(ctx, payload, state)
      handleMessagePartUpdated(ctx, payload, state)
      handleMessageUpdated(ctx, payload, state)
      handleToolExecute(ctx, payload, state)
      handleToolResult(ctx, payload, state)
    } catch {}
  }
}

function handleSessionIdle(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "session.idle") return

  const props = payload.properties as SessionIdleProps | undefined
  if (props?.sessionID === ctx.sessionID) {
    state.mainSessionIdle = true
  }
}

function handleSessionStatus(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "session.status") return

  const props = payload.properties as SessionStatusProps | undefined
  if (props?.sessionID === ctx.sessionID && props?.status?.type === "busy") {
    state.mainSessionIdle = false
  }
}

function handleMessagePartUpdated(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
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
    }
    state.lastPartText = part.text
  }
}

function handleMessageUpdated(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "message.updated") return

  const props = payload.properties as MessageUpdatedProps | undefined
  if (props?.info?.sessionID !== ctx.sessionID) return
  if (props?.info?.role !== "assistant") return

  const content = props.content
  if (!content || content === state.lastOutput) return

  if (state.lastPartText.length === 0) {
    const newContent = content.slice(state.lastOutput.length)
    if (newContent) {
      process.stdout.write(newContent)
    }
  }
  state.lastOutput = content
}

function handleToolExecute(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
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

  process.stdout.write(`\n${pc.cyan("⚡")} ${pc.bold(toolName)}${inputPreview}\n`)
}

function handleToolResult(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "tool.result") return

  const props = payload.properties as ToolResultProps | undefined
  if (props?.sessionID !== ctx.sessionID) return

  const output = props?.output || ""
  const maxLen = 200
  const preview = output.length > maxLen 
    ? output.slice(0, maxLen) + "..." 
    : output
  
  if (preview.trim()) {
    const lines = preview.split("\n").slice(0, 3)
    process.stdout.write(pc.dim(`   └─ ${lines.join("\n      ")}\n`))
  }

  state.currentTool = null
  state.lastPartText = ""
}
