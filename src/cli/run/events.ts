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

export function serializeError(error: unknown): string {
  if (!error) return "Unknown error"

  if (error instanceof Error) {
    const parts = [error.message]
    if (error.cause) {
      parts.push(`Cause: ${serializeError(error.cause)}`)
    }
    return parts.join(" | ")
  }

  if (typeof error === "string") {
    return error
  }

  if (typeof error === "object") {
    const obj = error as Record<string, unknown>

    const messagePaths = [
      obj.message,
      obj.error,
      (obj.data as Record<string, unknown>)?.message,
      (obj.data as Record<string, unknown>)?.error,
      (obj.error as Record<string, unknown>)?.message,
    ]

    for (const msg of messagePaths) {
      if (typeof msg === "string" && msg.length > 0) {
        return msg
      }
    }

    try {
      const json = JSON.stringify(error, null, 2)
      if (json !== "{}") {
        return json
      }
    } catch (_) {
      void _
    }
  }

  return String(error)
}

export interface EventState {
  mainSessionIdle: boolean
  mainSessionError: boolean
  lastError: string | null
  lastOutput: string
  lastPartText: string
  currentTool: string | null
  /** Set to true when the main session has produced meaningful work (text, tool call, or tool result) */
  hasReceivedMeaningfulWork: boolean
}

export function createEventState(): EventState {
  return {
    mainSessionIdle: false,
    mainSessionError: false,
    lastError: null,
    lastOutput: "",
    lastPartText: "",
    currentTool: null,
    hasReceivedMeaningfulWork: false,
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
      if (!payload?.type) {
        console.error(pc.dim(`[event] no type: ${JSON.stringify(event)}`))
        continue
      }

      logEventVerbose(ctx, payload)

      handleSessionError(ctx, payload, state)
      handleSessionIdle(ctx, payload, state)
      handleSessionStatus(ctx, payload, state)
      handleMessagePartUpdated(ctx, payload, state)
      handleMessageUpdated(ctx, payload, state)
      handleToolExecute(ctx, payload, state)
      handleToolResult(ctx, payload, state)
    } catch (err) {
      console.error(pc.red(`[event error] ${err}`))
    }
  }
}

function logEventVerbose(ctx: RunContext, payload: EventPayload): void {
  const props = payload.properties as Record<string, unknown> | undefined
  const info = props?.info as Record<string, unknown> | undefined
  const sessionID = props?.sessionID ?? info?.sessionID
  const isMainSession = sessionID === ctx.sessionID
  const sessionTag = isMainSession
    ? pc.green("[MAIN]")
    : sessionID
      ? pc.yellow(`[${String(sessionID).slice(0, 8)}]`)
      : pc.dim("[system]")

  switch (payload.type) {
    case "session.idle":
    case "session.status": {
      const status = (props?.status as { type?: string })?.type ?? "idle"
      console.error(pc.dim(`${sessionTag} ${payload.type}: ${status}`))
      break
    }

    case "message.part.updated": {
      const partProps = props as MessagePartUpdatedProps | undefined
      const part = partProps?.part
      if (part?.type === "tool-invocation") {
        const toolPart = part as { toolName?: string; state?: string }
        console.error(
          pc.dim(`${sessionTag} message.part (tool): ${toolPart.toolName} [${toolPart.state}]`)
        )
      } else if (part?.type === "text" && part.text) {
        const preview = part.text.slice(0, 80).replace(/\n/g, "\\n")
        console.error(
          pc.dim(`${sessionTag} message.part (text): "${preview}${part.text.length > 80 ? "..." : ""}"`)
        )
      }
      break
    }

    case "message.updated": {
      const msgProps = props as MessageUpdatedProps | undefined
      const role = msgProps?.info?.role ?? "unknown"
      const model = msgProps?.info?.modelID
      const agent = msgProps?.info?.agent
      const details = [role, agent, model].filter(Boolean).join(", ")
      console.error(pc.dim(`${sessionTag} message.updated (${details})`))
      break
    }

    case "tool.execute": {
      const toolProps = props as ToolExecuteProps | undefined
      const toolName = toolProps?.name ?? "unknown"
      const input = toolProps?.input ?? {}
      const inputStr = JSON.stringify(input).slice(0, 150)
      console.error(
        pc.cyan(`${sessionTag} TOOL.EXECUTE: ${pc.bold(toolName)}`)
      )
      console.error(pc.dim(`   input: ${inputStr}${inputStr.length >= 150 ? "..." : ""}`))
      break
    }

    case "tool.result": {
      const resultProps = props as ToolResultProps | undefined
      const output = resultProps?.output ?? ""
      const preview = output.slice(0, 200).replace(/\n/g, "\\n")
      console.error(
        pc.green(`${sessionTag} TOOL.RESULT: "${preview}${output.length > 200 ? "..." : ""}"`)
      )
      break
    }

    case "session.error": {
      const errorProps = props as SessionErrorProps | undefined
      const errorMsg = serializeError(errorProps?.error)
      console.error(pc.red(`${sessionTag} SESSION.ERROR: ${errorMsg}`))
      break
    }

    default:
      console.error(pc.dim(`${sessionTag} ${payload.type}`))
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

function handleSessionError(
  ctx: RunContext,
  payload: EventPayload,
  state: EventState
): void {
  if (payload.type !== "session.error") return

  const props = payload.properties as SessionErrorProps | undefined
  if (props?.sessionID === ctx.sessionID) {
    state.mainSessionError = true
    state.lastError = serializeError(props?.error)
    console.error(pc.red(`\n[session.error] ${state.lastError}`))
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
      state.hasReceivedMeaningfulWork = true
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

  state.hasReceivedMeaningfulWork = true
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

  state.hasReceivedMeaningfulWork = true
  process.stdout.write(`\n${pc.cyan(">")} ${pc.bold(toolName)}${inputPreview}\n`)
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
