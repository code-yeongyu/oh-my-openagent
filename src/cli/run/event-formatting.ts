import pc from "picocolors"
import type {
  RunContext,
  EventPayload,
  MessageUpdatedProps,
  MessagePartUpdatedProps,
  ToolExecuteProps,
  ToolResultProps,
  SessionErrorProps,
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

function getSessionTag(ctx: RunContext, payload: EventPayload): string {
  const props = payload.properties as Record<string, unknown> | undefined
  const info = props?.info as Record<string, unknown> | undefined
  const sessionID = props?.sessionID ?? info?.sessionID
  const isMainSession = sessionID === ctx.sessionID
  if (isMainSession) return pc.green("[MAIN]")
  if (sessionID) return pc.yellow(`[${String(sessionID).slice(0, 8)}]`)
  return pc.dim("[system]")
}

export function logEventVerbose(ctx: RunContext, payload: EventPayload): void {
  const sessionTag = getSessionTag(ctx, payload)
  const props = payload.properties as Record<string, unknown> | undefined

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
        console.error(pc.dim(`${sessionTag} message.part (tool): ${toolPart.toolName} [${toolPart.state}]`))
      } else if (part?.type === "text" && part.text) {
        const preview = part.text.slice(0, 80).replace(/\n/g, "\\n")
        console.error(pc.dim(`${sessionTag} message.part (text): "${preview}${part.text.length > 80 ? "..." : ""}"`))
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
      let inputStr: string
      try {
        inputStr = JSON.stringify(input)
      } catch {
        try {
          inputStr = String(input)
        } catch {
          inputStr = "[unserializable]"
        }
      }
      const inputPreview = inputStr.slice(0, 150)
      console.error(pc.cyan(`${sessionTag} TOOL.EXECUTE: ${pc.bold(toolName)}`))
      console.error(pc.dim(`   input: ${inputPreview}${inputStr.length >= 150 ? "..." : ""}`))
      break
    }

    case "tool.result": {
      const resultProps = props as ToolResultProps | undefined
      const output = resultProps?.output ?? ""
      const preview = output.slice(0, 200).replace(/\n/g, "\\n")
      console.error(pc.green(`${sessionTag} TOOL.RESULT: "${preview}${output.length > 200 ? "..." : ""}"`))
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
