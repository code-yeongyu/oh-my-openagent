import fs from "node:fs"
import http from "node:http"

const logFile = process.env.FAKE_LLM_LOG
const requestedPort = Number(process.env.FAKE_OPENAI_PORT ?? 0)

let callCount = 0
let todoIssued = false

function append(line) {
  fs.appendFileSync(logFile, `${line}\n`)
  process.stdout.write(`${line}\n`)
}

function completedUsage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

function sendSse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  response.write("data: [DONE]\n\n")
  response.end()
}

function textEvents(index, text) {
  const responseID = `resp_${index}`
  const itemID = `msg_${index}`
  return [
    {
      type: "response.created",
      response: { id: responseID, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: itemID },
    },
    {
      type: "response.output_text.delta",
      item_id: itemID,
      output_index: 0,
      delta: text,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: itemID },
    },
    {
      type: "response.completed",
      response: { usage: completedUsage() },
    },
  ]
}

function toolCallEvents(index, name, callID, args) {
  const responseID = `resp_${index}`
  const functionID = `fc_${index}`
  const encodedArgs = JSON.stringify(args)
  return [
    {
      type: "response.created",
      response: { id: responseID, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: functionID,
        call_id: callID,
        name,
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: functionID,
      output_index: 0,
      delta: encodedArgs,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: functionID,
        call_id: callID,
        name,
        arguments: encodedArgs,
        status: "completed",
      },
    },
    {
      type: "response.completed",
      response: { usage: completedUsage() },
    },
  ]
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

function toolName(tool) {
  return tool?.name ?? tool?.function?.name ?? ""
}

function toolSchema(tool) {
  return tool?.parameters ?? tool?.function?.parameters ?? {}
}

function todoArguments(tool) {
  const schema = toolSchema(tool)
  const itemSchema = schema?.properties?.todos?.items ?? {}
  const itemProperties = itemSchema.properties ?? {}
  const todo = {
    content: "Keep this live continuation proof pending",
    status: "pending",
    priority: "high",
  }
  if (Object.hasOwn(itemProperties, "id")) {
    todo.id = "live-proof-1"
  }
  return { todos: [todo] }
}

function hasToolResult(input) {
  return input.includes('"type":"function_call_output"')
    || input.includes('"type": "function_call_output"')
    || input.includes('"type":"tool_result"')
    || input.includes('"type": "tool_result"')
    || input.includes('"role":"tool"')
    || input.includes('"role": "tool"')
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
  let body = {}
  try {
    body = JSON.parse(await readBody(request))
  } catch {
  }

  const input = JSON.stringify(body.input ?? body.messages ?? body)
  const tools = Array.isArray(body.tools) ? body.tools : []
  const names = tools.map(toolName)
  const isTitle = input.includes("Generate a title")
  const isProbe = input.includes("LIVE_TODO_CONTINUATION_PROBE")
  const isContinuation = input.includes("Incomplete tasks remain in your todo list")

  if (isTitle) {
    append(`call=${callCount} branch=title`)
    sendSse(response, textEvents(callCount, "live todo continuation probe"))
    return
  }

  if (isContinuation) {
    append(`call=${callCount} branch=continuation question_tool_present=${names.includes("question")} tools=${JSON.stringify(names)}`)
    sendSse(response, textEvents(callCount, "CONTINUATION_ACK"))
    return
  }

  if (isProbe && !hasToolResult(input) && !todoIssued) {
    const todoTool = tools.find((tool) => toolName(tool) === "todowrite")
      ?? tools.find((tool) => /todo/i.test(toolName(tool)))
    if (!todoTool) {
      append(`call=${callCount} branch=no-todo-tool tools=${JSON.stringify(names)}`)
      sendSse(response, textEvents(callCount, "NO_TODO_TOOL"))
      return
    }

    todoIssued = true
    const name = toolName(todoTool)
    const args = todoArguments(todoTool)
    append(`call=${callCount} branch=todo-tool name=${name} args=${JSON.stringify(args)} schema=${JSON.stringify(toolSchema(todoTool))}`)
    sendSse(response, toolCallEvents(callCount, name, `call_todo_${callCount}`, args))
    return
  }

  if (isProbe && hasToolResult(input)) {
    append(`call=${callCount} branch=initial-stop`)
    sendSse(response, textEvents(callCount, "INITIAL_TURN_STOP"))
    return
  }

  append(`call=${callCount} branch=default`)
  sendSse(response, textEvents(callCount, "DEFAULT_RESPONSE"))
})

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : requestedPort
  append(`START port=${port}`)
})

function shutdown() {
  append(`FINAL calls=${callCount} todo_issued=${todoIssued}`)
  server.close(() => process.exit(0))
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
