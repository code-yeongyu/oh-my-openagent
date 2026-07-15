import { appendFileSync, writeFileSync } from "node:fs"
import http from "node:http"

const logPath = process.env.QA_PROVIDER_LOG
const portPath = process.env.QA_PROVIDER_PORT_FILE
let callCount = 0
let parentToolCallIssued = false
let childRequestObserved = false

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function completedUsage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

function sendEvents(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`)
  response.write("data: [DONE]\n\n")
  response.end()
}

function textEvents(id, text, model) {
  const responseId = `resp_${id}`
  const itemId = `msg_${id}`
  return [
    { type: "response.created", response: { id: responseId, created_at: Math.floor(Date.now() / 1000), model } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.output_text.delta", item_id: itemId, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.completed", response: { usage: completedUsage() } },
  ]
}

function toolCallEvents(id, name, callId, args, model) {
  const responseId = `resp_${id}`
  const functionId = `fc_${id}`
  const argumentsJson = JSON.stringify(args)
  return [
    { type: "response.created", response: { id: responseId, created_at: Math.floor(Date.now() / 1000), model } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: functionId, call_id: callId, name, arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: functionId,
      output_index: 0,
      delta: argumentsJson,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: functionId,
        call_id: callId,
        name,
        arguments: argumentsJson,
        status: "completed",
      },
    },
    { type: "response.completed", response: { usage: completedUsage() } },
  ]
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

function toolNames(body) {
  if (!Array.isArray(body.tools)) return []
  return body.tools.flatMap((tool) => typeof tool?.name === "string" ? [tool.name] : [])
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  if (request.method !== "POST" || !request.url?.includes("/responses")) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  callCount += 1
  const raw = await requestBody(request)
  const body = JSON.parse(raw)
  const serialized = JSON.stringify(body)
  const inputSerialized = JSON.stringify(body.input ?? body.messages ?? [])
  const model = typeof body.model === "string" ? body.model : "unknown-model"
  const hasToolResult = inputSerialized.includes("function_call_output") || inputSerialized.includes("tool_result")
  const isTitle = inputSerialized.includes("Generate a title")
  const isChild = serialized.includes("QA_PROJECT_AGENT_PROMPT_MARKER") || serialized.includes("QA_CHILD_TASK")
  let branch = "default"
  if (isTitle) branch = "title"
  else if (inputSerialized.includes("QA_TRIGGER_PROJECT_AGENT_TEAM") && !hasToolResult && !parentToolCallIssued) {
    branch = "parent-team-create"
  } else if (inputSerialized.includes("QA_TRIGGER_PROJECT_AGENT_TEAM")) branch = "parent-complete"
  else if (isChild) branch = "project-agent-child"

  appendFileSync(logPath, `${JSON.stringify({
    call: callCount,
    branch,
    model,
    hasProjectPrompt: serialized.includes("QA_PROJECT_AGENT_PROMPT_MARKER"),
    hasChildTask: serialized.includes("QA_CHILD_TASK"),
    tools: toolNames(body),
  })}\n`)

  if (branch === "parent-team-create") {
    parentToolCallIssued = true
    sendEvents(response, toolCallEvents(callCount, "team_create", `team_create_${callCount}`, {
      inline_spec: {
        name: "qa-project-agent-team",
        leadAgentId: "lead",
        members: [
          { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
          {
            kind: "subagent_type",
            name: "reviewer",
            subagent_type: "repository-reviewer",
            worktreePath: "./member-worktree",
            prompt: "QA_CHILD_TASK: reply exactly QA_CHILD_DONE",
          },
        ],
      },
    }, model))
    return
  }
  if (branch === "project-agent-child") {
    childRequestObserved = true
    sendEvents(response, textEvents(callCount, "QA_CHILD_DONE", model))
    return
  }
  if (branch === "title") {
    sendEvents(response, textEvents(callCount, "project agent team qa", model))
    return
  }
  if (branch === "parent-complete") {
    for (let attempt = 0; attempt < 100 && !childRequestObserved; attempt += 1) await sleep(100)
    sendEvents(response, textEvents(callCount, "QA_PARENT_DONE", model))
    return
  }
  sendEvents(response, textEvents(callCount, `QA_DEFAULT_${callCount}`, model))
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fake provider did not bind a TCP port")
  writeFileSync(portPath, String(address.port))
  process.stdout.write(`fake provider listening on ${address.port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
