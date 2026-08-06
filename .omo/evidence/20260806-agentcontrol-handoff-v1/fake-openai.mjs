import http from "node:http"

const port = Number(process.env.FAKE_OPENAI_PORT ?? 0)
let sequence = 0

function usage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

function send(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
  res.write("data: [DONE]\n\n")
  res.end()
}

function textEvents(id, text) {
  const responseId = `resp_${id}`
  const itemId = `msg_${id}`
  return [
    { type: "response.created", response: { id: responseId, created_at: 0, model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.output_text.delta", item_id: itemId, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

function toolEvents(id, name, args) {
  const responseId = `resp_${id}`
  const itemId = `fc_${id}`
  const callId = `call_${id}`
  const encoded = JSON.stringify(args)
  return [
    { type: "response.created", response: { id: responseId, created_at: 0, model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: itemId, output_index: 0, delta: encoded },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name, arguments: encoded, status: "completed" } },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok")
    return
  }
  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404).end()
    return
  }
  sequence += 1
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  const input = JSON.stringify(body.input ?? body)
  const toolNames = new Set((body.tools ?? []).map((tool) => tool.name))

  if (input.includes('"type":"function_call_output"')) {
    send(res, textEvents(sequence, "QA_DONE"))
  } else if (toolNames.has("Report")) {
    send(res, toolEvents(sequence, "Report", { summary: "QA worker read handoff and completed", final: true }))
  } else if (input.includes("QA_INVALID_HANDOFF") && toolNames.has("Explore")) {
    send(res, toolEvents(sequence, "Explore", {
      name: "qa-invalid",
      prompt: "Inspect the QA marker.",
      handoff: ".omo/evidence/20260806-agentcontrol-handoff-v1/missing.md",
    }))
  } else if (input.includes("QA_VALID_EXPLORE") && toolNames.has("Explore")) {
    send(res, toolEvents(sequence, "Explore", {
      name: "qa-explore",
      prompt: "Read package.json and report its package name.",
      handoff: ".omo/evidence/20260806-agentcontrol-handoff-v1/explore-handoff.md",
      breadth: "quick",
    }))
  } else if (input.includes("QA_VALID_DISPATCH") && toolNames.has("Dispatch")) {
    send(res, toolEvents(sequence, "Dispatch", {
      template: "Report the item {item}.",
      items: ["alpha"],
      group: "qa-handoff",
      handoff: ".omo/evidence/20260806-agentcontrol-handoff-v1/dispatch-handoff.md",
    }))
  } else {
    send(res, textEvents(sequence, "QA_READY"))
  }
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  process.stdout.write(`PORT=${typeof address === "object" && address ? address.port : port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
