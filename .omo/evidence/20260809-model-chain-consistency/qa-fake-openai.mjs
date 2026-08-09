import http from "node:http"
import { appendFileSync } from "node:fs"
import { sendSse, textEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const port = Number(process.env.QA_FAKE_PORT)
const logPath = process.env.QA_FAKE_LOG

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok")
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  appendFileSync(logPath, `${JSON.stringify(body)}\n`)

  if (body.model === "primary") {
    response.writeHead(429, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_error" } }))
    return
  }

  sendSse(response, textEvents(1, "REAL_OPENCODE_FALLBACK_OK"))
})

server.listen(port, "127.0.0.1", () => console.log(`qa-fake-openai listening on ${port}`))
