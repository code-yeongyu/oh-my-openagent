import http from "node:http"
import { appendFileSync } from "node:fs"
import { sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

const port = Number(process.env.QA_FAKE_PORT)
const logPath = process.env.QA_FAKE_LOG
const failReasoning = process.env.QA_FAIL_REASONING
const taskProbe = process.env.QA_TASK_PROBE === "1"
const callOmoProbe = process.env.QA_CALL_OMO_PROBE === "1"
let callCount = 0

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok")
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  callCount++
  appendFileSync(logPath, `${JSON.stringify(body)}\n`)

  const input = JSON.stringify(body.input ?? body.messages ?? body)
  const hasToolResult = input.includes('"type":"function_call_output"')
    || input.includes('"type":"tool_result"')
    || input.includes('"role":"tool"')
  if (taskProbe && input.includes("PRIMARY_RUNG_TASK_PROBE") && !hasToolResult) {
    sendSse(response, toolCallEvents(callCount, "task", `call_task_${callCount}`, {
      category: "quick",
      description: "primary rung options probe",
      prompt: "PRIMARY_RUNG_CHILD: reply exactly CHILD_PRIMARY_OPTIONS_OK",
      load_skills: [],
      run_in_background: false,
    }))
    return
  }
  if (taskProbe && input.includes("PRIMARY_RUNG_CHILD")) {
    sendSse(response, textEvents(callCount, "CHILD_PRIMARY_OPTIONS_OK"))
    return
  }
  if (taskProbe && input.includes("PRIMARY_RUNG_TASK_PROBE") && hasToolResult) {
    sendSse(response, textEvents(callCount, "PARENT_TASK_PROBE_OK"))
    return
  }
  if (callOmoProbe && input.includes("CALL_OMO_AGENT_PROBE") && !hasToolResult) {
    sendSse(response, toolCallEvents(callCount, "call_omo_agent", `call_omo_${callCount}`, {
      description: "canonical category chain probe",
      prompt: "CALL_OMO_CHILD: reply exactly CALL_OMO_CHILD_OK",
      subagent_type: "explore",
      run_in_background: false,
    }))
    return
  }
  if (callOmoProbe && input.includes("CALL_OMO_AGENT_PROBE") && hasToolResult) {
    sendSse(response, textEvents(callCount, "PARENT_CALL_OMO_PROBE_OK"))
    return
  }
  if (callOmoProbe && input.includes("CALL_OMO_CHILD") && body.model !== "gpt-5.6-sol-primary") {
    sendSse(response, textEvents(callCount, "CALL_OMO_CHILD_OK"))
    return
  }

  if (body.model === "primary" || body.model === "gpt-5.6-sol-primary" || (failReasoning && body.reasoning?.effort === failReasoning)) {
    response.writeHead(429, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_error" } }))
    return
  }

  sendSse(response, textEvents(1, "REAL_OPENCODE_FALLBACK_OK"))
})

server.listen(port, "127.0.0.1", () => console.log(`qa-fake-openai listening on ${port}`))
