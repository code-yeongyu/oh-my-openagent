// Retained synthetic generation seam for lead TUI/Desktop QA. No entry/activity injection.
import { createServer } from "node:http"

const report = process.argv[2]
const turns = new Map()
let cursor = 0
function stepFor(body) {
  const messages = JSON.stringify(body.messages)
  const mechanics = body.messages?.map((message) => JSON.stringify(message)).find((message) => message.includes("MEMORY_DIR=") && message.includes("TRANSCRIPT_PATH="))
  let step = { type: "text", text: "Synthetic reflection QA is ready. Use /reflect to run a real reflection." }
  if (mechanics !== undefined) {
    const count = turns.get(mechanics) ?? 0
    turns.set(mechanics, count + 1)
    const name = `reference/retained-recap-${turns.size}.md`
    step = count === 0 ? { type: "tool_call", name: "bash", arguments: {
      command: `mkdir -p reference && printf '%s\\n' '---' 'description: Retained synthetic reflection' '---' 'RECAP_GIT_SENTINEL' > ${name} && git add ${name} && git commit -m 'qa: retained synthetic reflection'`,
    } } : { type: "text", text: report.replaceAll("reference/recap.md", name) }
  } else if (messages.includes("Generate a short")) step = { type: "text", text: "Reflection recap QA" }
  return step
}
const server = createServer((request, response) => {
  const chunks = []
  request.on("data", (chunk) => chunks.push(chunk))
  request.on("end", () => {
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) }
    catch (error) { response.writeHead(400).end(); return }
    const step = stepFor(body)
    const chunk = (delta, finish_reason = null) => ({ id: `retained-${++cursor}`, object: "chat.completion.chunk", created: 0, model: "mock-1", choices: [{ index: 0, delta, finish_reason }] })
    const send = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`)
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    send(chunk({ role: "assistant" }))
    send(chunk(step.type === "text" ? { content: step.text } : { tool_calls: [{ index: 0, id: `retained-tool-${cursor}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.arguments) } }] }))
    send(chunk({}, step.type === "text" ? "stop" : "tool_calls"))
    response.end("data: [DONE]\n\n")
  })
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
process.send?.({ baseUrl })
// The provider is deliberately retained until the manifest's explicit cleanup command.
process.on("SIGTERM", () => { server.close(); process.exit(0) })
process.on("SIGINT", () => { server.close(); process.exit(0) })
await new Promise(() => {})
