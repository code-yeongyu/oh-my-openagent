import { createServer } from "node:http"
import { appendFileSync, writeFileSync } from "node:fs"

const portFile = process.argv[2]
const logFile = process.argv[3]
if (!portFile || !logFile) throw new Error("usage: standalone-parity-fixture-server <port-file> <log-file>")

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const body = await readBody(request)
  appendFileSync(logFile, `${JSON.stringify({ method: request.method, path: url.pathname, body: parseJson(body) })}\n`)
  if (url.pathname === "/mcp" || url.pathname === "/docs-mcp") {
    handleMcp(url.pathname, body, response)
    return
  }
  if (url.pathname === "/health") {
    sendJson(response, { status: "ok" })
    return
  }
  if (url.pathname === "/api/v1/system/status") {
    sendJson(response, { result: { user: "default" } })
    return
  }
  if (url.pathname === "/api/v1/content/read") {
    sendJson(response, { result: "QA_PROFILE" })
    return
  }
  if (url.pathname === "/api/v1/fs/ls") {
    const uri = url.searchParams.get("uri")
    sendJson(response, { result: uri === "viking://user" ? [{ name: "default", isDir: true }] : [] })
    return
  }
  if (/^\/api\/v1\/sessions\/[^/]+\/context$/u.test(url.pathname)) {
    sendJson(response, { result: { latest_archive_overview: "QA_RESUME_CONTEXT" } })
    return
  }
  if (url.pathname === "/api/v1/search/search") {
    sendJson(response, {
      result: {
        rendered: "QA_RECALLED_CONTEXT",
        entries: [{ uri: "viking://user/default/memories/qa.md", category: "memory", text: "QA_RECALLED_CONTEXT" }],
        stats: { used_tokens: 4 },
      },
    })
    return
  }
  if (/^\/api\/v1\/sessions\/[^/]+(?:\/messages(?:\/batch)?|\/commit)?$/u.test(url.pathname)) {
    sendJson(response, { result: { accepted: true, pending_tokens: 0 } })
    return
  }
  sendJson(response, { error: { message: "not found" } }, 404)
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("fixture server address unavailable")
  writeFileSync(portFile, String(address.port))
})

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

function handleMcp(pathname, body, response) {
  const request = parseJson(body)
  if (request === null || typeof request !== "object") {
    sendJson(response, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400)
    return
  }
  const id = request.id ?? null
  if (request.method === "initialize") {
    sendMcp(response, { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "parity-fixture", version: "1" } } })
    return
  }
  if (request.method === "notifications/initialized") {
    response.writeHead(202).end()
    return
  }
  if (request.method === "tools/list") {
    const tools = pathname === "/docs-mcp"
      ? [{ name: "echo", description: "Echo fixture text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }]
      : [{ name: "health", description: "Check fixture health", inputSchema: { type: "object", properties: {} } }]
    sendMcp(response, { jsonrpc: "2.0", id, result: { tools } })
    return
  }
  if (request.method === "tools/call") {
    const text = pathname === "/docs-mcp" ? `HTTP_ECHO:${request.params?.arguments?.text ?? ""}` : "OPENVIKING_HEALTH_OK"
    sendMcp(response, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } })
    return
  }
  sendMcp(response, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } })
}

function sendMcp(response, payload) {
  response.setHeader("Mcp-Session-Id", "standalone-parity-qa")
  sendJson(response, payload)
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(payload))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
