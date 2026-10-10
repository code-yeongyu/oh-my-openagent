import fs from "node:fs"
import http from "node:http"

const requestedPort = Number(process.env.FAKE_OPENAI_PORT ?? 0)
const observationFile = process.env.WAKE_OBSERVATION_FILE
const countsFile = process.env.FAKE_COUNTS_FILE
const logFile = process.env.FAKE_SERVER_LOG

const largeErrorLength = 513_039
const errorPrefix = "Forbidden: Selected provider is forbidden. "
const errorTail = "[UNIQUE_PROVIDER_ERROR_TAIL]"
const largeError = `${errorPrefix}${"x".repeat(largeErrorLength - errorPrefix.length - errorTail.length)}${errorTail}`

const counts = {
  title: 0,
  parentToolCall: 0,
  parentAfterTool: 0,
  childError: 0,
  wake: 0,
  default: 0,
}
let callCount = 0
let parentToolCallIssued = false

function completedUsage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

function sendSse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

function textEvents(text) {
  const id = `resp_${callCount}`
  const item = `msg_${callCount}`
  return [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: item } },
    { type: "response.output_text.delta", item_id: item, output_index: 0, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: item } },
    { type: "response.completed", response: { usage: completedUsage() } },
  ]
}

function toolCallEvents(name, callId, args) {
  const id = `resp_${callCount}`
  const item = `fc_${callCount}`
  const argumentsText = JSON.stringify(args)
  return [
    { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: item, call_id: callId, name, arguments: "" },
    },
    { type: "response.function_call_arguments.delta", item_id: item, output_index: 0, delta: argumentsText },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "function_call", id: item, call_id: callId, name, arguments: argumentsText, status: "completed" },
    },
    { type: "response.completed", response: { usage: completedUsage() } },
  ]
}

function appendSanitizedLog(entry) {
  if (!logFile) return
  fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`)
}

function writeJson(file, value) {
  if (!file) return
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
    return output
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output)
  }
  return output
}

function hasToolResult(text) {
  return text.includes('"type":"function_call_output"')
    || text.includes('"type":"tool_result"')
    || text.includes('"role":"tool"')
}

function inspectNotification(value) {
  const errorLine = value.split("\n").find((line) => line.includes("[ERROR] - ") || line.startsWith("- Error: ") || line.startsWith("**Error:** ")) ?? ""
  const delimiters = ["[ERROR] - ", "- Error: ", "**Error:** "]
  const delimiter = delimiters.find((item) => errorLine.includes(item)) ?? ""
  const renderedError = delimiter ? errorLine.slice(errorLine.indexOf(delimiter) + delimiter.length) : ""
  const markerMatch = renderedError.match(/\[truncated from (\d+) characters\]/)
  const kinds = []
  if (value.includes("[BACKGROUND TASK RETRY")) kinds.push("retry")
  if (value.includes("[ALL BACKGROUND TASKS FINISHED")) kinds.push("all-finished")
  if (value.includes("[BACKGROUND TASK FAILED]")) kinds.push("single-failed")
  if (kinds.length === 0) kinds.push("other")

  return {
    kinds,
    notificationLength: value.length,
    renderedErrorLength: renderedError.length,
    renderedErrorPrefix: renderedError.slice(0, 80),
    hasExpectedPrefix: renderedError.startsWith(errorPrefix),
    hasTruncationMarker: markerMatch !== null,
    markerOriginalLength: markerMatch ? Number(markerMatch[1]) : null,
    hasTailSentinel: renderedError.includes(errorTail),
  }
}

function observeWake(body, rawLength) {
  const wakeCandidates = collectStrings(body)
    .filter((value) => value.includes("[ALL BACKGROUND TASKS") || value.includes("[BACKGROUND TASK"))
  const boundedNotifications = wakeCandidates
    .filter((value) => value.includes(errorPrefix) && value.includes("[truncated from "))
    .map(inspectNotification)
  const selectedNotification = boundedNotifications.find((value) => value.kinds.includes("all-finished"))
    ?? boundedNotifications[0]
    ?? inspectNotification("")

  return {
    requestBodyLength: rawLength,
    candidateStringCount: wakeCandidates.length,
    boundedNotificationCount: boundedNotifications.length,
    notificationKinds: [...new Set(boundedNotifications.flatMap((value) => value.kinds))],
    boundedNotifications,
    wakeTextLength: selectedNotification.notificationLength,
    renderedErrorLength: selectedNotification.renderedErrorLength,
    renderedErrorPrefix: selectedNotification.renderedErrorPrefix,
    hasExpectedPrefix: selectedNotification.hasExpectedPrefix,
    hasTruncationMarker: selectedNotification.hasTruncationMarker,
    markerOriginalLength: selectedNotification.markerOriginalLength,
    hasTailSentinel: selectedNotification.hasTailSentinel,
    requestContainsTailSentinel: JSON.stringify(body).includes(errorTail),
    fullErrorWasNotPersisted: !JSON.stringify(body).includes(errorTail),
  }
}

function recordBranch(branch, rawLength) {
  counts[branch] += 1
  appendSanitizedLog({ timestamp: new Date().toISOString(), call: callCount, branch, requestBodyLength: rawLength })
  writeJson(countsFile, counts)
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "not found" } }))
    return
  }

  callCount += 1
  const raw = await readBody(req)
  let body = {}
  try {
    body = JSON.parse(raw)
  } catch {
  }
  const inputText = JSON.stringify(body.input ?? body.messages ?? body)
  const isWake = inputText.includes("[ALL BACKGROUND TASKS") || inputText.includes("[BACKGROUND TASK")
  const isParent = inputText.includes("TRUNCATION_PROBE_PARENT")
  const isChild = inputText.includes("TRUNCATION_CHILD_TASK") && !isParent
  const isTitle = inputText.includes("Generate a title")

  if (isWake) {
    recordBranch("wake", raw.length)
    writeJson(observationFile, observeWake(body, raw.length))
    sendSse(res, textEvents("WAKE_ACK"))
    return
  }

  if (isTitle) {
    recordBranch("title", raw.length)
    sendSse(res, textEvents("background error truncation QA"))
    return
  }

  if (isChild) {
    recordBranch("childError", raw.length)
    res.writeHead(400, { "content-type": "application/json" })
    res.end(JSON.stringify({
      error: {
        message: largeError,
        type: "invalid_request_error",
        code: "qa_huge_provider_error",
      },
    }))
    return
  }

  if (isParent && !parentToolCallIssued) {
    parentToolCallIssued = true
    recordBranch("parentToolCall", raw.length)
    sendSse(res, toolCallEvents("task", `call_task_${callCount}`, {
      description: "Trigger bounded provider error",
      prompt: "TRUNCATION_CHILD_TASK: provoke the deterministic provider failure and return nothing else",
      subagent_type: "explore",
      run_in_background: true,
      load_skills: [],
    }))
    return
  }

  if (isParent && hasToolResult(inputText)) {
    recordBranch("parentAfterTool", raw.length)
    sendSse(res, textEvents("PARENT_IDLE_READY"))
    return
  }

  recordBranch("default", raw.length)
  sendSse(res, textEvents("DEFAULT_ACK"))
})

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : requestedPort
  writeJson(countsFile, counts)
  process.stdout.write(`fake-openai-error listening on ${port}\n`)
})

function stop() {
  writeJson(countsFile, counts)
  server.close(() => process.exit(0))
}

process.on("SIGTERM", stop)
process.on("SIGINT", stop)
