// QA-only control surface over the real OMO task component. Loaded only in an isolated CLI.
import { appendFileSync } from "node:fs"
import { createTaskComponent } from "../../src/components/task/index.ts"

export default async function register(pi) {
  const tools = new Map()
  const receipt = (type, data = {}) => {
    if (process.env.QA_RECEIPT_PATH) appendFileSync(process.env.QA_RECEIPT_PATH, JSON.stringify({ type, ...data }) + "\n")
  }
  const logger = {
    info: () => undefined,
    warn: (message, details) => console.error(JSON.stringify({ level: "warn", message, details })),
    error: (message, details) => console.error(JSON.stringify({ level: "error", message, details })),
  }
  await createTaskComponent().register({
    ...pi,
    registerTool(tool) { tools.set(tool.name, tool); pi.registerTool(tool) },
  }, { logger, config: { getFlag: (name) => pi.getFlag(name) } })
  let runId
  pi.registerCommand("qa-start", { description: "Start the isolated QA DAG", handler: async () => {
    const result = await tools.get("workflow").execute("qa-start", { action: "start", definition: {
      key: "qa-selector", name: "QA selector witness", nodes: [
        { id: "done", prompt: "QA_NODE_DONE", subagent_type: "qa-worker", model: "omo-mock/mock-1" },
        { id: "live", prompt: "QA_NODE_LIVE", subagent_type: "qa-worker", model: "omo-mock/mock-1" },
        { id: "next", prompt: "QA_NODE_NEXT", subagent_type: "qa-worker", model: "omo-mock/mock-1", dependsOn: ["done", "live"] },
      ],
    } })
    runId = result.details.run_id
    receipt("qa.started", { runId })
  } })
  pi.registerCommand("qa-check", { description: "Record the QA DAG snapshot", handler: async (label) => {
    receipt("qa.check", { label, result: await tools.get("workflow").execute("qa-check", { action: "snapshot", run_id: runId }) })
  } })
  let veto = false
  pi.rpc.handle("qa.workflow", (data) => tools.get("workflow").execute("qa-workflow", data))
  pi.rpc.handle("qa.veto", () => { veto = true; return { armed: true } })
  pi.on("session_before_switch", () => {
    receipt("qa.before-switch")
    if (!veto) return
    veto = false
    return { cancel: true }
  })
  pi.on("session_start", (_event, ctx) => {
    receipt("qa.session", { id: ctx.sessionManager.getSessionId(), pid: process.pid })
    pi.rpc.emit("qa.session", { id: ctx.sessionManager.getSessionId(), pid: process.pid })
  })
  pi.on("session_shutdown", (event) => receipt("qa.shutdown", { reason: event.reason }))
}
