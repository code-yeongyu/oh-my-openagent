#!/usr/bin/env node
// Fake OpenAI-compatible provider reproducing issue #6637:
//   call 1  -> retryable 429 quota error, which starts the runtime-fallback flow
//   call 2+ -> accepted but never answered, so the session-timeout escalation
//              path runs for real against a silent provider.
import http from "node:http"
import fs from "node:fs"

const port = Number(process.env.FAKE_PORT ?? 0)
const logFile = process.env.FAKE_LOG ?? "/tmp/pr6669/qa/hanging-provider.log"
const heldResponses = []
let calls = 0

function logLine(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`
  fs.appendFileSync(logFile, line)
  process.stdout.write(line)
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  calls += 1
  const call = calls

  if (call === 1) {
    logLine(`QUOTA_429 call=${call} url=${req.url}`)
    res.writeHead(429, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: {
          message: "Rate limit exceeded: all accounts reached configured quota threshold (reset after 19h 24m 10s)",
          type: "rate_limit_exceeded",
          code: "rate_limit_exceeded",
        },
      }),
    )
    return
  }

  logLine(`HANG_REQUEST call=${call} url=${req.url}`)
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  heldResponses.push(res)
})

function shutdown() {
  logLine(`FINAL_CALLS ${calls}`)
  for (const held of heldResponses) {
    try { held.end() } catch {}
  }
  server.close(() => process.exit(0))
}

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  const boundPort = typeof address === "object" && address !== null ? address.port : port
  fs.writeFileSync("/tmp/pr6669/qa/hanging-provider.port", String(boundPort))
  logLine(`START port=${boundPort}`)
})

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
