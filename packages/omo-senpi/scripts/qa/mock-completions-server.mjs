#!/usr/bin/env node
// Offline openai-completions endpoint for the in-process-child lanes.
//
// An extension provider's `streamSimple` only serves the session senpi bootstrapped with it; a child
// request is rebuilt from the provider CONFIG, and senpi rejects a config without `baseUrl`, so an
// in-process child ALWAYS leaves through a real HTTP client. Pointing that client at 127.0.0.1 keeps
// the lane deterministic and network-free while exercising senpi's genuine request path, and the
// request body is the only place a child's prompt, tools, and applied reasoning level can be observed.
import { createServer } from "node:http"

const TOOL_CALL_ID_PREFIX = "mock-http-tool-"

export function startMockCompletionsServer({ steps, onRequest }) {
  // One step per request, exactly like a real agent loop: senpi calls back after executing each tool
  // result, so replaying the whole script on every call would spin forever.
  let cursor = 0
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      onRequest?.(body)
      const script = typeof steps === "function" ? steps(body) : steps
      const step = script[cursor]
      cursor += 1
      writeStream(response, step === undefined ? [{ type: "text", text: "mock script exhausted" }] : [step])
    })
  })
  server.listen(0, "127.0.0.1")
  // A listening socket is a live handle: without unref the senpi process never reaches a clean exit
  // and the lane's exit-code check fails on a timeout kill instead of the behavior it means to assert.
  server.unref()
  return {
    ready: new Promise((resolve) => {
      server.on("listening", () => resolve(`http://127.0.0.1:${server.address().port}`))
    }),
    close: () => server.close(),
  }
}

function writeStream(response, steps) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  const toolCalls = steps.filter((step) => step.type === "tool_call")
  const texts = steps.filter((step) => step.type === "text")
  send(response, chunk({ role: "assistant" }))
  for (const [index, step] of texts.entries()) {
    if (index === 0 || toolCalls.length === 0) send(response, chunk({ content: step.text }))
  }
  for (const [index, step] of toolCalls.entries()) {
    send(response, chunk({
      tool_calls: [{
        index,
        id: step.id ?? `${TOOL_CALL_ID_PREFIX}${index + 1}`,
        type: "function",
        function: { name: step.name, arguments: JSON.stringify(step.arguments ?? {}) },
      }],
    }))
  }
  send(response, chunk({}, toolCalls.length > 0 ? "tool_calls" : "stop"))
  response.write("data: [DONE]\n\n")
  response.end()
}

function chunk(delta, finishReason = null) {
  return {
    id: "mock-http-completion",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock-http",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function send(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}
