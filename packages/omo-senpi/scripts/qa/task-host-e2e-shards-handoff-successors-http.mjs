import { appendFileSync, existsSync, watch } from "node:fs"
import { createServer } from "node:http"
import { dirname } from "node:path"

let toolSequence = 0

function send(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function chunk(delta, finishReason = null) {
  return {
    id: "t14-successor-http",
    object: "chat.completion.chunk",
    created: 0,
    model: "mock-http",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

function waitForRelease(path, timeoutMs = 600_000) {
  if (path === undefined || existsSync(path)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (!existsSync(path)) return
      clearTimeout(timer)
      watcher.close()
      resolve()
    }
    const watcher = watch(dirname(path), finish)
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`release missing: ${path}`))
    }, timeoutMs)
    watcher.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    finish()
  })
}

function toolDelta(step) {
  return {
    tool_calls: [{
      index: 0,
      id: step.id ?? `t14-tool-${++toolSequence}`,
      type: "function",
      function: {
        name: step.name,
        arguments: JSON.stringify(step.arguments ?? {}),
      },
    }],
  }
}

async function streamStep(response, step) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  send(response, chunk({ role: "assistant" }))
  if (step.type === "text" || step.type === "stream_tool") {
    send(response, chunk({ content: step.text }))
    await waitForRelease(step.releasePath)
  }
  const tool = step.type === "tool_call" ? step : step.type === "stream_tool" ? step.tool : undefined
  if (tool !== undefined) send(response, chunk(toolDelta(tool)))
  send(response, chunk({}, tool === undefined ? "stop" : "tool_calls"))
  response.write("data: [DONE]\n\n")
  response.end()
}

export function startRoutedCompletionsServer({ route, requestLogPath, classify }) {
  let arrivalOrder = 0
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      void (async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        const lane = classify(body)
        appendFileSync(requestLogPath, `${JSON.stringify({
          arrivalOrder: ++arrivalOrder,
          lane,
          timestamp: new Date().toISOString(),
        })}\n`)
        try {
          await streamStep(response, route(body))
        } catch (error) {
          if (response.headersSent) response.destroy(error)
          else response.writeHead(500).end(JSON.stringify({ error: String(error) }))
        }
      })()
    })
  })
  server.listen(0, "127.0.0.1")
  server.unref()
  return {
    ready: new Promise((resolve) => {
      server.on("listening", () => resolve(`http://127.0.0.1:${server.address().port}`))
    }),
    close: () => server.close(),
  }
}
