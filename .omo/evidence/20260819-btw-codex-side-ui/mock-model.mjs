import { createServer } from "node:http"

const PORT = 46731
const TOKEN = "ALPHA-CONTEXT-42"
const BOUNDARY = "<omo-btw-boundary>"
const heldParents = []
let responseIndex = 0

function sendResponse(res, text) {
  responseIndex += 1
  const responseID = `resp-${responseIndex}`
  const messageID = `msg-${responseIndex}`
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
  const writeEvent = (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  writeEvent({
    type: "response.created",
    response: {
      id: responseID,
      object: "response",
      status: "in_progress",
    },
  })
  writeEvent({
    type: "response.output_item.added",
    output_index: 0,
    item: {
      type: "message",
      role: "assistant",
      id: messageID,
      status: "in_progress",
      content: [],
    },
  })
  writeEvent({
    type: "response.content_part.added",
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    part: {
      type: "output_text",
      text: "",
      annotations: [],
    },
  })
  writeEvent({
    type: "response.output_text.delta",
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    delta: text,
  })
  writeEvent({
    type: "response.output_text.done",
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    text,
  })
  writeEvent({
    type: "response.content_part.done",
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    part: {
      type: "output_text",
      text,
      annotations: [],
    },
  })
  writeEvent({
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      role: "assistant",
      id: messageID,
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  })
  writeEvent({
    type: "response.completed",
    response: {
      id: responseID,
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          id: messageID,
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    },
  })
  res.end()
}

function releaseParents() {
  while (heldParents.length > 0) {
    const parent = heldParents.shift()
    sendResponse(parent, "PARENT-CONTINUED")
    process.stdout.write("PARENT_RELEASED\n")
  }
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/responses")) {
    res.writeHead(404).end()
    return
  }

  let body = ""
  req.on("data", (chunk) => {
    body += chunk
  })
  req.on("end", () => {
    const hasToken = body.includes(TOKEN)
    const hasBoundary = body.includes(BOUNDARY)

    if (hasToken && hasBoundary) {
      process.stdout.write("SIDE_CONTEXT_OK\n")
      sendResponse(res, "SIDE-CONTEXT-PROOF")
      releaseParents()
      return
    }

    if (hasToken) {
      process.stdout.write("PARENT_HELD\n")
      heldParents.push(res)
      return
    }

    sendResponse(res, "GENERIC-QA-RESPONSE")
  })
})

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`MOCK_LISTENING ${PORT}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    releaseParents()
    server.close(() => process.exit(0))
  })
}

