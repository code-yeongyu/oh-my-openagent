import { createServer } from "node:http"

const port = 46733

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(404).end()
    return
  }

  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => {
    body += chunk
  })
  request.on("end", () => {
    process.stdout.write(`OPENCLAW_EVENT ${body}\n`)
    response.writeHead(204).end()
  })
})

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`OPENCLAW_PROBE_LISTENING ${port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
