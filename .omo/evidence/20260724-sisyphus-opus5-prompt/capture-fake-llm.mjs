#!/usr/bin/env node
// Fake OpenAI Responses endpoint that CAPTURES each request body to disk,
// then streams a minimal text completion. Used to prove which system prompt
// opencode actually sent for a given model.
import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const captureDir = process.env.CAPTURE_DIR
if (!captureDir) {
  process.stderr.write("CAPTURE_DIR required\n")
  process.exit(1)
}
fs.mkdirSync(captureDir, { recursive: true })

let callCount = 0

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sseTextResponse(res, id, text) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const respId = `resp_${id}`
  const itemId = `msg_${id}`
  const events = [
    { type: "response.created", response: { id: respId, object: "response", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { id: itemId, type: "message", role: "assistant", content: [] } },
    { type: "response.content_part.added", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
    { type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", item_id: itemId, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text } },
    { type: "response.output_item.done", output_index: 0, item: { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] } },
    {
      type: "response.completed",
      response: {
        id: respId,
        object: "response",
        status: "completed",
        output: [{ id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
  ]
  for (const ev of events) {
    res.write(`event: ${ev.type}\n`)
    res.write(`data: ${JSON.stringify(ev)}\n\n`)
  }
  res.end()
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok")
    return
  }
  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }
  callCount++
  const raw = await readBody(req)
  let model = "unknown"
  try {
    model = JSON.parse(raw).model ?? "unknown"
  } catch {}
  const file = path.join(captureDir, `call-${String(callCount).padStart(2, "0")}-${model.replaceAll("/", "_")}.json`)
  fs.writeFileSync(file, raw)
  process.stdout.write(`captured call ${callCount} model=${model} -> ${file}\n`)
  sseTextResponse(res, callCount, `FAKE_OK ${callCount}`)
})

server.listen(Number(process.env.FAKE_PORT ?? 0), "127.0.0.1", () => {
  const addr = server.address()
  process.stdout.write(`capture-fake-llm listening on ${typeof addr === "object" && addr ? addr.port : "?"}\n`)
})
