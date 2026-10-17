// Fake DeepSeek Harness ACP server for tests. Speaks newline-delimited JSON-RPC
// over stdio and is controlled by argv[2]: "happy" | "permission" | "hang" | "error".
import { createInterface } from "node:readline"

const mode = process.argv[2] ?? "happy"

const rl = createInterface({ input: process.stdin })

let sessionCreated = false
let promptReceived = false

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

rl.on("line", (line) => {
  const message = JSON.parse(line)
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } })
    return
  }
  if (message.method === "session/new") {
    sessionCreated = true
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "dsh-test-session" } })
    return
  }
  if (message.method === "session/cancel") {
    send({ jsonrpc: "2.0", id: message.id, result: {} })
    return
  }
  if (message.method === "session/prompt") {
    promptReceived = true
    if (mode === "hang") {
      // never settle the prompt
      return
    }
    if (mode === "permission") {
      // ask for a permission and only settle the prompt after the answer arrives
      const permissionId = 77
      send({
        jsonrpc: "2.0",
        id: permissionId,
        method: "session/request_permission",
        params: {
          sessionId: "dsh-test-session",
          toolCall: { toolCallId: "tool-1", toolName: "bash" },
          options: [
            { optionId: "allow-once-1", kind: "allow_once", name: "Allow once" },
            { optionId: "reject-1", kind: "rejected", name: "Reject" },
          ],
        },
      })
      const answerWatcher = (answerLine) => {
        const answer = JSON.parse(answerLine)
        if (answer.id === permissionId) {
          rl.off("line", answerWatcher)
          const granted = answer.result.outcome.outcome === "selected"
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: { stopReason: granted ? "end_turn" : "refusal" },
          })
        }
      }
      rl.on("line", answerWatcher)
      return
    }
    if (mode === "error") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "model exploded" } })
      return
    }
    // happy: stream two chunks then settle
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "dsh-test-session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Task done. " } },
      },
    })
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "dsh-test-session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "All green." } },
      },
    })
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })
    // settle the whole child so the client's close path never fires mid-flight
    setTimeout(() => process.exit(0), 20)
  }
})

process.on("SIGTERM", () => {
  process.exit(0)
})
