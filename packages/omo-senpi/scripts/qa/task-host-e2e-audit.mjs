import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const signalRequests = new WeakMap()
const auditPath = (cwd) => join(cwd, ".omo", "task-host-mock-events.jsonl")

export function recordMockEvent(cwd, event) {
  const entry = { at: new Date().toISOString(), ...event }
  appendFileSync(auditPath(cwd), JSON.stringify(entry) + "\n")
  return entry
}

export function observeMockSignal(cwd, callId, signal) {
  recordMockEvent(cwd, {
    type: "model_request", callId, signalPresent: !!signal, aborted: signal?.aborted ?? null,
  })
  if (!signal) return
  let requests = signalRequests.get(signal)
  if (!requests) {
    requests = new Map()
    signalRequests.set(signal, requests)
    signal.addEventListener("abort", () => {
      for (const [root, callIds] of requests) {
        recordMockEvent(root, { type: "abort_signal", callIds, reason: String(signal.reason ?? "") })
      }
    }, { once: true })
  }
  const ids = requests.get(cwd) ?? []
  ids.push(callId)
  requests.set(cwd, ids)
}

function rows(path) {
  return path && existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse) : []
}

export function failedChildEvidence(sandbox, records) {
  return records.filter((record) => ["error", "lost", "cancelled"].includes(record.status)).map((record) => {
    const transcript = rows(record.host_session?.session_path)
    const sessionId = transcript.find((entry) => entry.type === "session")?.id
    const callIds = new Set(transcript.flatMap((entry) =>
      entry.message?.role === "assistant" && Array.isArray(entry.message.content)
        ? entry.message.content.filter((part) => part.type === "toolCall").map((part) => part.id) : []))
    const events = rows(auditPath(sandbox.cwd))
    const requests = events.filter((event) => event.type === "model_request" && callIds.has(event.callId))
    const stored = JSON.parse(readFileSync(join(sandbox.stateDir, "tasks", `${record.task_id}.json`), "utf8"))
    return {
      capturedAt: new Date().toISOString(),
      record,
      storeStableDuringCapture: JSON.stringify(stored) === JSON.stringify(record),
      terminalEntry: transcript.findLast((entry) => entry.message?.role === "assistant"),
      agentEnd: events.findLast((event) => event.type === "agent_end" && event.sessionId === sessionId) ?? null,
      signalCoverage: requests.length > 0 && requests.every((event) => event.signalPresent),
      abortedAtRequest: requests.some((event) => event.aborted === true),
      abortSignals: events.filter((event) => event.type === "abort_signal" && event.callIds.some((id) => callIds.has(id))),
      shutdownEvents: events.filter((event) => event.type === "session_shutdown" &&
        [sessionId, record.parent_session_id].includes(event.sessionId)),
      driverTeardownStarted: events.some((event) => event.type === "driver_teardown"),
    }
  })
}
