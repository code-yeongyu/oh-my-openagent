// A fake `devin acp`: NDJSON JSON-RPC over stdio implementing the ACP v1 subset the runner uses.
// Prompt text controls behavior: containing "SLOW" holds the turn open until session/cancel;
// containing "FAIL" returns a JSON-RPC error; anything else streams chunks then end_turn.
import { createInterface } from "node:readline"

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const respond = (id, result) => send({ jsonrpc: "2.0", id, result })
const respondError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })
const notify = (method, params) => send({ jsonrpc: "2.0", method, params })

let sessionId = "fake-acp-session"
let pendingPrompt = null
let cancelled = false

const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.method === undefined && msg.id !== undefined) return // response to our request: ignore
  if (msg.method !== undefined && msg.id === undefined) {
    // notification
    if (msg.method === "session/cancel") {
      cancelled = true
      if (pendingPrompt !== null) {
        const id = pendingPrompt
        pendingPrompt = null
        respond(id, { stopReason: "cancelled" })
      }
    }
    return
  }
  const { id, method, params } = msg
  switch (method) {
    case "initialize":
      respond(id, {
        protocolVersion: 1,
        agentInfo: { name: "fake-devin", version: "0.0.0" },
        agentCapabilities: { loadSession: true },
        authMethods: [],
      })
      return
    case "authenticate":
      respond(id, {})
      return
    case "session/new":
      respond(id, {
        sessionId,
        modes: { currentModeId: "accept-edits", availableModes: [{ id: "accept-edits", name: "Code" }] },
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "adaptive",
            options: [
              { value: "adaptive", name: "Adaptive" },
              { value: "swe-2-high", name: "SWE-2" },
            ],
          },
        ],
      })
      return
    case "session/load":
      respond(id, {
        modes: { currentModeId: "accept-edits" },
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "swe-2-high",
            options: [{ value: "swe-2-high", name: "SWE-2" }],
          },
        ],
      })
      return
    case "session/set_config_option":
      respond(id, { configOptions: params?.configOptions ?? [] })
      return
    case "session/close":
      respond(id, {})
      return
    case "session/prompt": {
      const text = params?.prompt?.[0]?.text ?? ""
      const sid = params?.sessionId ?? sessionId
      if (text.includes("FAIL")) {
        respondError(id, -32603, "prompt failed on purpose")
        return
      }
      if (text.includes("SLOW")) {
        pendingPrompt = id
        return // held until session/cancel
      }
      const chunks = text.includes("MULTI") ? ["Hello ", "world"] : ["PONG"]
      for (const chunk of chunks) {
        notify("session/update", {
          sessionId: sid,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: chunk },
          },
        })
      }
      notify("session/update", {
        sessionId: sid,
        update: {
          sessionUpdate: "usage_update",
          used: 42,
          _meta: { "cognition.ai/inputTokens": 30, "cognition.ai/outputTokens": 12 },
        },
      })
      respond(id, {
        stopReason: "end_turn",
        usage: { totalTokens: 42, inputTokens: 30, outputTokens: 12 },
      })
      return
    }
    default:
      respondError(id, -32601, `method not found: ${method}`)
  }
})
