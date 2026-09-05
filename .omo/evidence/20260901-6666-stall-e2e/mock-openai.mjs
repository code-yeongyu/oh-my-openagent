// Mock v5: parent/child aware OpenAI-compatible server for the end-to-end
// stall-evidence harness.
//
//   Parent request (fresh session, no tool results yet, prompt contains
//   PARENTDELEGATE) -> emit a `task` tool call so OpenCode executes the
//   delegate-task tool from the source-loaded plugin.
//
//   Parent followup (history contains tool results) -> plain text + stop so
//   the parent turn completes normally.
//
//   Child request (any user message contains CHILDPROBE DELIVERABLE) ->
//   stream text chunks then end CLEANLY with `data: [DONE]` and NO
//   finish_reason -> OpenCode records finish="unknown" (deliverable present).
//
//   Child request (CHILDPROBE EMPTY) -> zero text chunks, same clean end ->
//   finish="unknown" with no deliverable.
import { createServer } from "node:http"

const PORT = Number(process.env.MOCK_PORT ?? 8790)

function chunk(choices) {
  return `data: ${JSON.stringify({ id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: "mock-model", choices })}\n\n`
}
const textChunk = (t) => chunk([{ index: 0, delta: { content: t }, finish_reason: null }])
const stopChunk = () => chunk([{ index: 0, delta: {}, finish_reason: "stop" }])
const DONE = "data: [DONE]\n\n"

function messages(body) { return Array.isArray(body?.messages) ? body.messages : [] }

function hasToolResult(body) {
  return messages(body).some((m) => m?.role === "tool" || Array.isArray(m?.content) && m.content.some?.((p) => p?.type === "tool_result"))
}

function allUserText(body) {
  return messages(body)
    .filter((m) => m?.role === "user")
    .map((m) => (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p?.text ?? "").join(" ") : ""))
    .join(" \n ")
    .toUpperCase()
}

function classify(body) {
  const t = allUserText(body)
  if (hasToolResult(body)) return "PARENT_FOLLOWUP"
  if (t.includes("PARENTDELEGATE")) return "PARENT_FIRST"
  if (t.includes("CHILDPROBE")) return t.includes("EMPTY") ? "CHILD_EMPTY" : "CHILD_DELIVERABLE"
  return "UNKNOWN" // anything else: fail loudly, never fabricate a scenario
}

function send(res, pieces, intervalMs = 40) {
  let i = 0
  const timer = setInterval(() => {
    if (i < pieces.length) { res.write(pieces[i]); i++; return }
    clearInterval(timer)
    res.end()
  }, intervalMs)
  res.on("close", () => clearInterval(timer))
}

function handleChat(body, res) {
  const kind = classify(body)
  console.log(`[mock] ${kind}`)

  if (kind === "UNKNOWN") {
    // Never fabricate a scenario from malformed input.
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "mock provider: unrecognized request shape", type: "server_error" } }))
    return
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })

  if (kind === "PARENT_FIRST") {
    const emptyMode = allUserText(body).includes("EMPTYMODE")
    const args = JSON.stringify({
      description: "child stall probe",
      prompt: emptyMode
        ? "CHILDPROBE EMPTY this subagent stream will be interrupted with no output"
        : "CHILDPROBE DELIVERABLE this subagent stream will be interrupted",
      subagent_type: "explore",
      run_in_background: false,
      load_skills: [],
    })
    send(res, [
      chunk([{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_probe_1", type: "function", function: { name: "task", arguments: "" } }] }, finish_reason: null }]),
      chunk([{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }]),
      chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
      DONE,
    ])
    return
  }

  if (kind === "PARENT_FOLLOWUP") {
    send(res, [textChunk("parent turn complete"), stopChunk(), DONE])
    return
  }

  // Child: interrupted stream. Clean [DONE], NEVER a finish_reason ->
  // OpenCode persists finish="unknown".
  const pieces = kind === "CHILD_EMPTY" ? [DONE] : [textChunk("child deliverable chunk-0 "), textChunk("chunk-1 "), DONE]
  send(res, pieces)
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404); res.end(); return
  }
  let raw = ""
  req.on("data", (c) => { raw += String(c) })
  req.on("end", () => {
    let body = {}
    try { body = JSON.parse(raw || "{}") } catch { /* ignore */ }
    handleChat(body, res)
  })
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-openai v5 (parent/child stall probe) on http://127.0.0.1:${PORT}`)
})
