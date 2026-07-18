// Scripted fake senpi RPC child for senpi-task runner tests.
// Speaks the newline-delimited JSON RPC protocol on stdin/stdout.
// Behavior is driven by the incoming commands plus a few env flags:
//   FAKE_IGNORE_TERM=1   install a SIGTERM handler that ignores it (proves SIGKILL escalation)
//   FAKE_EMIT_UI=1       emit an extension_ui_request confirm at startup
//   FAKE_EMIT_MALFORMED=1 emit one malformed line then a valid event at startup
import { createInterface } from "node:readline"
import { kill } from "node:process"

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function respond(command, id, extra) {
  emit({ type: "response", command, id, success: true, ...(extra ?? {}) })
}

function assistantMessage(text) {
  return { role: "assistant", content: [{ type: "text", text }], stopReason: "endTurn" }
}

function completeTurn(text) {
  emit({ type: "message_end", message: assistantMessage(text) })
  emit({ type: "agent_end", willRetry: false, messages: [assistantMessage(text)] })
}

function handlePrompt(cmd) {
  const message = typeof cmd.message === "string" ? cmd.message : ""
  if (cmd.streamingBehavior === "followUp") {
    respond("prompt", cmd.id)
    emit({ type: "queue_update", steering: [], followUp: [message] })
    return
  }
  if (message.startsWith("delay:")) {
    const [, msRaw] = message.split(":")
    const ms = Number.parseInt(msRaw, 10)
    setTimeout(() => respond("prompt", cmd.id), Number.isFinite(ms) ? ms : 0)
    return
  }
  if (message.startsWith("crash:")) {
    const [, codeRaw, ...rest] = message.split(":")
    process.stderr.write(rest.join(":"))
    process.exit(Number.parseInt(codeRaw, 10))
    return
  }
  if (message.startsWith("exit:")) {
    respond("prompt", cmd.id)
    process.exit(Number.parseInt(message.slice("exit:".length), 10))
    return
  }
  if (message === "diesignal") {
    respond("prompt", cmd.id)
    emit({ type: "agent_start" })
    kill(process.pid, "SIGKILL")
    return
  }
  if (message.startsWith("finish:")) {
    respond("prompt", cmd.id)
    emit({ type: "agent_start" })
    completeTurn(message.slice("finish:".length))
    setTimeout(() => process.exit(0), 20)
    return
  }
  respond("prompt", cmd.id)
  emit({ type: "agent_start" })
  if (message === "hold") {
    return
  }
  completeTurn(message)
}

function handleSteer(cmd) {
  respond("steer", cmd.id)
  emit({ type: "queue_update", steering: [cmd.message], followUp: [] })
  if (cmd.message === "complete") {
    completeTurn("steered-complete")
  }
}

function handleCommand(cmd) {
  switch (cmd.type) {
    case "prompt":
      return handlePrompt(cmd)
    case "steer":
      return handleSteer(cmd)
    case "follow_up":
      respond("follow_up", cmd.id)
      return emit({ type: "queue_update", steering: [], followUp: [cmd.message] })
    case "abort":
      respond("abort", cmd.id)
      return emit({ type: "agent_end", willRetry: false, messages: [] })
    case "get_state":
      return respond("get_state", cmd.id, {
        data: {
          sessionId: "fake-session",
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          autoCompactionEnabled: false,
          messageCount: 1,
          pendingMessageCount: 0,
        },
      })
    default:
      return respond(cmd.type ?? "unknown", cmd.id)
  }
}

function handleLine(line) {
  const trimmed = line.trim()
  if (!trimmed) {
    return
  }
  const parsed = JSON.parse(trimmed)
  if (parsed.type === "extension_ui_response") {
    const outcome = parsed.confirmed === false ? "denied" : parsed.cancelled ? "cancelled" : "confirmed"
    emit({ type: "session_info_changed", name: `ui:${outcome}` })
    return
  }
  handleCommand(parsed)
}

if (process.env.FAKE_IGNORE_TERM === "1") {
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1_000)
  emit({ type: "session_info_changed", name: "ready" })
}

if (process.env.FAKE_EMIT_MALFORMED === "1") {
  process.stdout.write("this-is-not-json\n")
  emit({ type: "agent_start" })
}

if (process.env.FAKE_EMIT_UI === "1") {
  setTimeout(() => {
    emit({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "t", message: "m" })
  }, 5)
}

createInterface({ input: process.stdin }).on("line", handleLine)
