#!/usr/bin/env node
import http from "node:http"
import fs from "node:fs"

const port = Number(process.env.FAKE_PROVIDER_PORT)
const logPath = process.env.FAKE_PROVIDER_LOG

function log(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

function sendText(response, id, text) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const events = [
    { type: "response.created", response: { id, object: "response", status: "in_progress", model: "fallback", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { id: `${id}-msg`, type: "message", role: "assistant", status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: `${id}-msg`, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", item_id: `${id}-msg`, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", item_id: `${id}-msg`, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: `${id}-msg`, output_index: 0, content_index: 0, part: { type: "output_text", text, annotations: [] } },
    { type: "response.output_item.done", output_index: 0, item: { id: `${id}-msg`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
    { type: "response.completed", response: { id, object: "response", status: "completed", model: "fallback", output: [{ id: `${id}-msg`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.write("data: [DONE]\n\n")
  response.end()
}

function sendChatText(response, id, text) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const created = Math.floor(Date.now() / 1000)
  const chunks = [
    { id, object: "chat.completion.chunk", created, model: "fallback", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", created, model: "fallback", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
    { id, object: "chat.completion.chunk", created, model: "fallback", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ]
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.write("data: [DONE]\n\n")
  response.end()
}

let fallbackRequestCount = 0

const server = http.createServer(async (request, response) => {
  log(`HTTP method=${request.method} path=${request.url}`)
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok")
    return
  }
  const isResponses = request.url?.includes("/responses")
  const isChatCompletions = request.url?.includes("/chat/completions")
  if (request.method !== "POST" || (!isResponses && !isChatCompletions)) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  const raw = await readBody(request)
  let body = {}
  try { body = JSON.parse(raw) } catch {}
  const model = String(body.model ?? "unknown")
  log(`REQUEST model=${model}`)

  if (model === "primary") {
    let recorded = false
    const recordAbort = () => {
      if (recorded) return
      recorded = true
      log("PRIMARY_CONNECTION_CLOSED")
    }
    request.on("aborted", recordAbort)
    request.on("close", () => {
      if (!response.writableEnded) recordAbort()
    })
    response.on("close", () => {
      if (!response.writableEnded) recordAbort()
    })
    return
  }

  if (model === "fallback") {
    fallbackRequestCount += 1
    if (fallbackRequestCount > 1) {
      log("FALLBACK_HANGING_FOR_USER_ABORT")
      return
    }
    const id = `resp-${Date.now()}`
    if (isChatCompletions) sendChatText(response, id, "QA_FALLBACK_OK")
    else sendText(response, id, "QA_FALLBACK_OK")
    log("FALLBACK_RESPONSE_SENT")
    return
  }

  response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `unexpected model ${model}` }))
})

server.listen(port, "127.0.0.1", () => log(`READY port=${port}`))
process.on("SIGTERM", () => server.close(() => process.exit(0)))
process.on("SIGINT", () => server.close(() => process.exit(0)))
