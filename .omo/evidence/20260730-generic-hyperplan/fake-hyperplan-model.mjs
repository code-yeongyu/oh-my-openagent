#!/usr/bin/env node
import http from "node:http"
import fs from "node:fs"

const logPath = process.env.FAKE_HYPERPLAN_LOG
let calls = 0

function log(line) {
  fs.appendFileSync(logPath, `${line}\n`)
}

function containsType(value, type) {
  if (Array.isArray(value)) return value.some((entry) => containsType(entry, type))
  if (value === null || typeof value !== "object") return false
  if (value.type === type) return true
  return Object.values(value).some((entry) => containsType(entry, type))
}

function usage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

function send(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
  res.write("data: [DONE]\n\n")
  res.end()
}

function toolCall(id) {
  const responseId = `resp_${id}`
  const itemId = `fc_${id}`
  const args = JSON.stringify({ name: "hyperplan" })
  return [
    { type: "response.created", response: { id: responseId, model: "gpt-fake" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: itemId, call_id: `call_${id}`, name: "skill", arguments: "" },
    },
    { type: "response.function_call_arguments.delta", item_id: itemId, output_index: 0, delta: args },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: itemId,
        call_id: `call_${id}`,
        name: "skill",
        arguments: args,
        status: "completed",
      },
    },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

function text(id, value) {
  const responseId = `resp_${id}`
  const itemId = `msg_${id}`
  return [
    { type: "response.created", response: { id: responseId, model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.output_text.delta", item_id: itemId, output_index: 0, delta: value },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok")
    return
  }

  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404).end()
    return
  }

  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    calls += 1
    const body = Buffer.concat(chunks).toString("utf8")
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = {}
    }
    if (body.includes("Generate a title")) {
      log(`call=${calls} action=title`)
      send(res, text(calls, "hyperplan qa"))
      return
    }

    const hasSkillResult =
      body.includes("HARNESS BACKEND SELECTION") &&
      body.includes("references/traex.md") &&
      body.includes("send_input") &&
      body.includes("close_agent")

    if (!containsType(parsed.input, "function_call_output")) {
      log(`call=${calls} action=skill`)
      send(res, toolCall(calls))
      return
    }

    log(`call=${calls} action=verify markers=${hasSkillResult}`)
    send(res, text(calls, hasSkillResult ? "OPENCODE_HYPERPLAN_SKILL_OK" : "OPENCODE_HYPERPLAN_SKILL_MISMATCH"))
  })
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  process.stdout.write(`${address.port}\n`)
})

process.on("SIGTERM", () => server.close(() => process.exit(0)))
process.on("SIGINT", () => server.close(() => process.exit(0)))
