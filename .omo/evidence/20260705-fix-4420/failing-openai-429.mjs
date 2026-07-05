#!/usr/bin/env node
import http from "node:http"

const requestedPort = Number(process.env.FAILING_OPENAI_PORT ?? 0)

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  if (request.method === "POST") {
    await readBody(request)
    response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({
      error: {
        message: "context length exceeded from session-error-sse-proof",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    }))
    return
  }

  response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
})

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : requestedPort
  process.stdout.write(`failing-openai listening on ${port}\n`)
})

process.on("SIGTERM", () => server.close(() => process.exit(0)))
process.on("SIGINT", () => server.close(() => process.exit(0)))
