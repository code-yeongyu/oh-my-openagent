import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import registerMockProvider from "./task-host-e2e-mock-provider.mjs"
import { childStartDiagnosis } from "./task-host-e2e-support.mjs"
import { recordMockEvent } from "./task-host-e2e-audit.mjs"
import { injectDaemonMockProvider } from "./task-host-e2e-sandbox.mjs"

export async function checkMockSessionIsolation(root) {
  const cwd = join(root, "mock-provider")
  mkdirSync(cwd)
  mkdirSync(join(cwd, ".omo"))
  const scriptPath = join(cwd, "mock-script.json")
  const steps = Array.from({ length: 25 }, (_, ordinal) => ({
    type: "tool_call", name: "eval", arguments: { ordinal },
  }))
  const save = (childSteps) => writeFileSync(scriptPath, JSON.stringify({
    parentSteps: [{ type: "text", text: "parent complete" }],
    childSteps: [...childSteps, { type: "text", text: "child complete" }],
  }))
  save(steps)
  let provider
  const handlers = new Map()
  registerMockProvider({
    registerProvider(_id, value) { provider = value },
    on(name, handler) { handlers.set(name, handler) },
  })
  const contexts = Array.from({ length: 8 }, () => ({
    cwd,
    messages: [{ role: "user", content: "You are running as an omo senpi-task child", timestamp: 0 }],
  }))
  const advance = async (context) => {
    const message = await provider.streamSimple({ id: "mock-1" }, context).result()
    context.messages.push(message)
    const call = message.content.find((part) => part.type === "toolCall")
    if (call) context.messages.push({
      role: "toolResult", toolCallId: call.id, toolName: call.name, content: [], isError: false,
    })
    return call
  }
  for (let ordinal = 0; ordinal < 25; ordinal++) {
    for (let child = 0; child < contexts.length; child++) {
      const call = await advance(contexts[child])
      if (call?.arguments.ordinal !== ordinal) {
        throw new Error(`mock session ${child}: expected ordinal ${ordinal}, received ${call?.arguments.ordinal}`)
      }
    }
  }
  // A new script (resume/revive) starts its own sequence without replaying the old script.
  save([{ type: "tool_call", name: "eval", arguments: { ordinal: 99 } }])
  for (const context of contexts) {
    if ((await advance(context))?.arguments.ordinal !== 99) {
      throw new Error("a changed mock script must start at its first step")
    }
  }
  await checkAbortEvidence(cwd, provider, handlers)
  const pluginRoot = join(root, "injected-provider")
  mkdirSync(pluginRoot)
  writeFileSync(join(pluginRoot, "daemon-launch-spec.json"), JSON.stringify({ core: { extensions: [] } }))
  injectDaemonMockProvider(pluginRoot, join(dirname(fileURLToPath(import.meta.url)), "task-host-e2e-mock-provider.mjs"))
  const injected = await import(pathToFileURL(join(pluginRoot, "omo-qa-mock-provider.ts")).href)
  let installedProvider
  injected.default({ registerProvider(_id, value) { installedProvider = value } })
  const installedReply = await installedProvider.streamSimple({ id: "mock-1" }, { cwd, messages: [] }).result()
  if (installedReply.stopReason !== "stop") throw new Error("the injected provider and its dependencies must load")
}

async function checkAbortEvidence(cwd, provider, handlers) {
  const controller = new AbortController()
  const context = { cwd, messages: [{ role: "user", content: "running as an omo senpi-task child" }] }
  const message = await provider.streamSimple({ id: "mock-1" }, context, { signal: controller.signal }).result()
  controller.abort("fixture-driver-stop")
  const path = join(cwd, ".omo", "task-host-mock-events.jsonl")
  const events = existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(JSON.parse) : []
  const callId = message.content[0].id
  if (!events.some((event) => event.type === "abort_signal" && event.callIds.includes(callId))) {
    throw new Error("mock abort signal must be captured with its exact tool-call identity")
  }
  handlers.get("agent_end")({
    aborted: true, abortSource: "system", willRetry: false, messages: [message],
  }, { cwd, sessionManager: { getSessionId: () => "fixture-child" } })
  const stateDir = join(cwd, ".omo", "senpi-task")
  mkdirSync(join(stateDir, "tasks"), { recursive: true })
  const sessionPath = join(cwd, "child.jsonl")
  writeFileSync(sessionPath, [
    { type: "session", id: "fixture-child" }, { type: "message", message },
  ].map(JSON.stringify).join("\n") + "\n")
  const record = {
    task_id: "st_failed", name: "failed-child", status: "error",
    host_session: { session_path: sessionPath }, error_message: 'RPC child turn ended with stopReason "toolUse"',
  }
  writeFileSync(join(stateDir, "tasks", "st_failed.json"), JSON.stringify(record))
  const captured = childStartDiagnosis({ cwd, stateDir }, [record]).failedRecords?.[0]
  if (captured?.record.task_id !== "st_failed" || captured.record.status !== "error" ||
    captured.agentEnd?.aborted !== true || captured.agentEnd.abortSource !== "system" ||
    captured.abortSignals.length !== 1 || captured.signalCoverage !== true || captured.driverTeardownStarted) {
    throw new Error("failed task evidence must retain identity, status, and its observed abort")
  }
  const unaborted = new AbortController()
  const next = await provider.streamSimple({ id: "mock-1" }, context, { signal: unaborted.signal }).result()
  handlers.get("agent_end")({
    aborted: false, willRetry: false, messages: [next],
  }, { cwd, sessionManager: { getSessionId: () => "fixture-unaborted" } })
  writeFileSync(sessionPath, [
    { type: "session", id: "fixture-unaborted" }, { type: "message", message: next },
  ].map(JSON.stringify).join("\n") + "\n")
  const absence = childStartDiagnosis({ cwd, stateDir }, [record]).failedRecords[0]
  if (absence.agentEnd?.aborted !== false || absence.abortSignals.length !== 0 ||
    !absence.signalCoverage || absence.driverTeardownStarted) {
    throw new Error("observed non-abort termination must remain distinct from missing signal coverage")
  }
  recordMockEvent(cwd, { type: "driver_teardown" })
  if (!childStartDiagnosis({ cwd, stateDir }, [record]).failedRecords[0].driverTeardownStarted) {
    throw new Error("the teardown boundary must be captured separately")
  }
}
