import { appendFileSync, existsSync, writeFileSync } from "node:fs"
import http from "node:http"

const scenario = process.env.QA_SCENARIO
const logPath = process.env.QA_PROVIDER_LOG
const portPath = process.env.QA_PROVIDER_PORT_FILE
const projectAgentPath = process.env.QA_PROJECT_AGENT_FILE
if (!scenario || !logPath || !portPath || !projectAgentPath) throw new Error("missing QA provider configuration")
if (scenario !== "accepted" && scenario !== "rejected") throw new Error(`invalid QA scenario: ${scenario}`)

let callCount = 0
let parentToolCallIssued = false
let childObserved = false

function usage() {
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
  response.end("data: [DONE]\n\n")
}

function responseCreated(id, model) {
  return { type: "response.created", response: { id: `resp_${id}`, created_at: Math.floor(Date.now() / 1000), model } }
}

function textEvents(id, text, model) {
  const itemId = `msg_${id}`
  return [
    responseCreated(id, model),
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.output_text.delta", item_id: itemId, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId } },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

function toolCallEvents(id, model) {
  const itemId = `fc_${id}`
  const callId = `team_create_${id}`
  const argumentsJson = JSON.stringify({
    inline_spec: {
      name: "qa-project-agent-team",
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus" },
        {
          kind: "subagent_type",
          name: "reviewer",
          subagent_type: "repository-reviewer",
          prompt: "QA_CHILD_TASK_MARKER: complete the assigned review.",
        },
      ],
    },
  })
  return [
    responseCreated(id, model),
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name: "team_create", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: itemId, output_index: 0, delta: argumentsJson },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name: "team_create", arguments: argumentsJson, status: "completed" } },
    { type: "response.completed", response: { usage: usage() } },
  ]
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function toolNames(body) {
  return Array.isArray(body.tools)
    ? body.tools.flatMap((tool) => typeof tool?.name === "string" ? [tool.name] : []).sort()
    : []
}

async function handleRequest(request, response) {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }
  if (request.method !== "POST" || !request.url?.includes("/responses")) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  callCount += 1
  const body = await readBody(request)
  const serialized = JSON.stringify(body)
  const input = JSON.stringify(body.input ?? body.messages ?? [])
  const model = typeof body.model === "string" ? body.model : "unknown-model"
  const hasToolResult = input.includes("function_call_output") || input.includes("tool_result")
  const isParent = input.includes("QA_TRIGGER_PROJECT_AGENT_TEAM")
  const isChild = serialized.includes("QA_PROJECT_AGENT_PROMPT_MARKER")
  let branch = "default"
  let projectAgentPresentBeforeTeamCreateResponse = false

  if (input.includes("Generate a title")) branch = "title"
  else if (isParent && !hasToolResult && !parentToolCallIssued) branch = "parent-team-create"
  else if (isParent) branch = "parent-complete"
  else if (isChild) branch = "project-agent-child"

  if (branch === "parent-team-create" && scenario === "accepted") {
    projectAgentPresentBeforeTeamCreateResponse = existsSync(projectAgentPath)
  }
  if (branch === "project-agent-child") childObserved = true

  appendFileSync(logPath, `${JSON.stringify({
    scenario,
    branch,
    model,
    hasProjectPromptMarker: serialized.includes("QA_PROJECT_AGENT_PROMPT_MARKER"),
    hasChildTaskMarker: serialized.includes("QA_CHILD_TASK_MARKER"),
    hasToolResult,
    reasoningEffort: body.reasoning?.effort ?? null,
    toolNames: toolNames(body),
    projectAgentPresentBeforeTeamCreateResponse,
  })}\n`)

  if (branch === "parent-team-create") {
    parentToolCallIssued = true
    sendEvents(response, toolCallEvents(callCount, model))
    return
  }
  if (branch === "project-agent-child") {
    sendEvents(response, textEvents(callCount, "QA_CHILD_DONE", model))
    return
  }
  if (branch === "parent-complete") {
    if (scenario === "accepted") {
      for (let attempt = 0; attempt < 100 && !childObserved; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    sendEvents(response, textEvents(callCount, "QA_PARENT_DONE", model))
    return
  }
  sendEvents(response, textEvents(callCount, branch === "title" ? "project agent QA" : "QA_DEFAULT", model))
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "local QA provider failure" }))
  })
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fake provider did not bind a TCP port")
  writeFileSync(portPath, String(address.port))
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
