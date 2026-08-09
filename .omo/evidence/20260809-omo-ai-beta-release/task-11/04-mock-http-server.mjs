#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import { startMockCompletionsServer } from "../../../../packages/omo-senpi/scripts/qa/mock-completions-server.mjs"

const capturePath = process.env.OMO_TASK11_HTTP_CAPTURE
if (!capturePath) throw new Error("OMO_TASK11_HTTP_CAPTURE is required")

const server = startMockCompletionsServer({
  steps: [
    {
      type: "tool_call",
      name: "bash",
      arguments: {
        command: "command -v omo-agent-toolkit && omo-agent-toolkit ulw-loop status --session-id task11-isolated --json",
      },
    },
    { type: "text", text: "mock-provider session complete" },
  ],
  onRequest(body) {
    appendFileSync(capturePath, `${JSON.stringify(body)}\n`)
  },
})

const baseUrl = await server.ready
process.stdout.write(`${baseUrl}\n`)
const keepAlive = setInterval(() => {}, 60_000)
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    clearInterval(keepAlive)
    server.close()
    process.exit(0)
  })
}
