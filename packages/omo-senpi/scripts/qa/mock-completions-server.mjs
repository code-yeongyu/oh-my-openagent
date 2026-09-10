#!/usr/bin/env node
// Offline openai-completions endpoint for the in-process-child lanes.
//
// An extension provider's `streamSimple` only serves the session senpi bootstrapped with it; a child
// request is rebuilt from the provider CONFIG, and senpi rejects a config without `baseUrl`, so an
// in-process child ALWAYS leaves through a real HTTP client. Pointing that client at 127.0.0.1 keeps
// the lane deterministic and network-free while exercising senpi's genuine request path, and the
// request body is the only place a child's prompt, tools, and applied reasoning level can be observed.
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const TOOL_CALL_ID_PREFIX = "mock-http-tool-"

export function startMockCompletionsServer({ steps, onRequest, requestLogPath, classifyRequest }) {
  // One step per request, exactly like a real agent loop: senpi calls back after executing each tool
  // result, so replaying the whole script on every call would spin forever.
  let cursor = 0
  let arrivalOrder = 0
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      void handleRequest(request, response, chunks)
    })
  })

  async function handleRequest(_request, response, chunks) {
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    onRequest?.(body)
    const script = typeof steps === "function" ? steps(body) : steps
    const stepIndex = cursor
    const step = script[cursor]
    cursor += 1
    arrivalOrder += 1
    const lane = typeof classifyRequest === "function" ? classifyRequest(body) : undefined
    if (requestLogPath !== undefined) {
      appendFileSync(requestLogPath, `${JSON.stringify({
        arrivalOrder,
        lane,
        timestamp: new Date().toISOString(),
        stepIndex,
      })}\n`)
    }
    try {
      await waitForStep(step)
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }))
      return
    }
    if (step !== undefined && step.type === "error") {
      response.writeHead(step.status, { "content-type": "application/json" })
      response.end(JSON.stringify(step.body))
      return
    }
    writeStream(response, step === undefined ? [{ type: "text", text: "mock script exhausted" }] : [step])
  }

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

function waitForStep(step) {
  if (step === undefined) return Promise.resolve()
  const delayMs = typeof step.delayMs === "number" ? step.delayMs : 0
  const releaseWhen = typeof step.releaseWhen === "function" ? step.releaseWhen : undefined
  const timeoutMs = typeof step.releaseTimeoutMs === "number" ? step.releaseTimeoutMs : 60_000
  if (delayMs <= 0 && releaseWhen === undefined) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const deadline = start + timeoutMs
    const tick = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`mock step release timed out after ${timeoutMs}ms`))
        return
      }
      if (Date.now() - start < delayMs) {
        setTimeout(tick, Math.min(20, delayMs - (Date.now() - start)))
        return
      }
      if (releaseWhen !== undefined && !releaseWhen()) {
        setTimeout(tick, 20)
        return
      }
      resolve()
    }
    tick()
  })
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

async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "mock-http-"))
  const logPath = join(dir, "mock-requests.jsonl")
  let released = false
  const server = startMockCompletionsServer({
    steps: [
      { type: "text", text: "a" },
      { type: "text", text: "b", releaseWhen: () => released },
      { type: "text", text: "c" },
      { type: "text", text: "d", delayMs: 80 },
    ],
    requestLogPath: logPath,
    classifyRequest: (body) => body.lane ?? "parent",
  })
  try {
    const base = await server.ready
    const post = async (lane) => {
      const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lane }) })
      return { status: res.status, text: await res.text() }
    }
    const a = await post("parent")
    if (!a.text.includes("a")) throw new Error("self-test: first step")
    const held = post("judge")
    const c = await post("parent")
    if (!c.text.includes("c")) throw new Error("self-test: concurrent request must complete while another is held")
    released = true
    const b = await held
    if (!b.text.includes("b")) throw new Error("self-test: releaseWhen")
    const t0 = Date.now()
    const d = await post("parent")
    if (Date.now() - t0 < 50) throw new Error("self-test: delayMs")
    if (!d.text.includes("d")) throw new Error("self-test: delayed step")
    const rows = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    if (rows.length !== 4) throw new Error(`self-test: log length ${rows.length}`)
    if (rows[1].lane !== "judge" || rows[1].stepIndex !== 1) throw new Error("self-test: log classification")
    console.log("SELF-TEST OK")
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await runSelfTest()
}
