import http from "node:http"
import { sendSse, textEvents, toolCallEvents } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"

let calls = 0
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok")
    return
  }
  if (req.method !== "POST" || !req.url?.includes("/responses")) {
    res.writeHead(404).end()
    return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  const body = JSON.parse(raw)
  const input = Array.isArray(body.input) ? body.input : []
  const hasToolResult = input.some((item) => item?.type === "function_call_output" || item?.type === "tool_result" || item?.role === "tool")
  calls += 1
  console.log(JSON.stringify({
    call: calls,
    hasCategoryProbe: raw.includes("CATEGORY_ROUTE_PROBE"),
    hasTeamProbe: raw.includes("TEAM_CATEGORY_ROUTE_PROBE"),
    hasChild: raw.includes("CATEGORY_CHILD_PROBE"),
    hasTargetSkill: raw.includes("PROBE_WORKER_ONLY_SKILL_CONTENT"),
    hasJuniorSkill: raw.includes("JUNIOR_ONLY_SKILL_CONTENT"),
    hasToolResult,
  }))
  if (hasToolResult) console.log(JSON.stringify(input.filter((item) => item?.type === "function_call_output" || item?.type === "tool_result" || item?.role === "tool")))
  if (raw.includes("Generate a title")) {
    sendSse(res, textEvents(calls, "category route probe"))
  } else if (raw.includes("CATEGORY_TEAM_CHILD_PROBE")) {
    sendSse(res, textEvents(calls, "TEAM_CHILD_DONE"))
  } else if (raw.includes("CATEGORY_CHILD_PROBE")) {
    sendSse(res, textEvents(calls, "CHILD_DONE"))
  } else if (raw.includes("TEAM_CATEGORY_ROUTE_PROBE") && !hasToolResult) {
    sendSse(res, toolCallEvents(calls, "team_create", `call_team_category_${calls}`, {
      inline_spec: {
        name: "category-route-team",
        lead: {
          name: "lead",
          kind: "subagent_type",
          subagent_type: "sisyphus",
        },
        members: [{
          name: "worker",
          kind: "category",
          category: "quick",
          prompt: "CATEGORY_TEAM_CHILD_PROBE: reply TEAM_CHILD_DONE",
        }],
      },
    }))
  } else if (raw.includes("CATEGORY_ROUTE_PROBE") && !hasToolResult) {
    sendSse(res, toolCallEvents(calls, "task", `call_category_${calls}`, {
      description: "Probe category route",
      prompt: "CATEGORY_CHILD_PROBE: reply CHILD_DONE",
      category: "quick",
      run_in_background: false,
      load_skills: ["probe-worker-only", "junior-only"],
    }))
  } else {
    sendSse(res, textEvents(calls, "PARENT_DONE"))
  }
})

server.listen(0, "127.0.0.1", () => console.log(`PORT=${server.address().port}`))
process.on("SIGTERM", () => server.close(() => process.exit(0)))
