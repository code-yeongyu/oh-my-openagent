import { afterEach, expect, test } from "bun:test"
import { createSemanticPromptDedupeKey } from "@oh-my-opencode/utils/prompt-async-gate/semantic-dedupe"
import { getPromptReservation, setPromptReservation } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { handedBackSyncSessions, syncSubagentSessions } from "../features/claude-code-session-state"
import { clearAllDelegatedChildSessionBootstrap, registerDelegatedChildSessionBootstrap } from "./delegated-child-session-bootstrap"
import { releaseAllPromptAsyncReservationsForTesting } from "./prompt-async-gate"
import { captureSyncChildPromptHold, registerSyncChildPromptExecution } from "./sync-child-prompt-hold"

const id = "sync-child-hold-test"
const model = { providerID: "fixture", modelID: "primary" }
const input = { path: { id }, body: { model, parts: [{ type: "text", text: "child prompt" }] } }
const cleanups: Array<() => void> = []

function setup(source = "call-omo-agent:sync", settled = true) {
  const abort = new AbortController()
  const dispose = registerSyncChildPromptExecution(id, abort.signal, input)
  cleanups.push(dispose)
  syncSubagentSessions.add(id)
  registerDelegatedChildSessionBootstrap({ sessionID: id, promptText: "child prompt" })
  const reservation = { source, dedupeKey: createSemanticPromptDedupeKey(input), reservedAt: Date.now(), token: Symbol(source), ...(settled ? { expiresAt: Date.now() + 2000 } : {}) }
  setPromptReservation(id, reservation)
  const lease = captureSyncChildPromptHold(id, model)
  return { abort, dispose, reservation, lease }
}

function terminal(modelID = "primary", text = "child prompt", error: unknown = { name: "APIError" }) {
  return { data: [
    { info: { id: "current-user", role: "user", time: { created: Date.now() + 1 } }, parts: [{ type: "text", text }] },
    { info: { role: "assistant", parentID: "current-user", providerID: "fixture", modelID, error }, parts: [] },
  ] }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  releaseAllPromptAsyncReservationsForTesting()
  clearAllDelegatedChildSessionBootstrap()
  syncSubagentSessions.delete(id)
  handedBackSyncSessions.delete(id)
})

test("only the settled exact owned hold is released after a current terminal failure", () => {
  const { lease } = setup()
  expect(lease?.isTerminalFailure(terminal())).toBe(true)
  expect(lease?.release("test:recovery")).toBe("released")
  expect(getPromptReservation(id)).toBeUndefined()
})

test.each(["user-prompt", "task:sync", "call-omo-agent:sync-other"])("a foreign owner %s cannot be captured", (source) => {
  setup(source)
  expect(captureSyncChildPromptHold(id, model)).toBeUndefined()
  expect(getPromptReservation(id)?.source).toBe(source)
})

test("in-flight and pre-dispatch holds remain intact until the original finalizer settles", () => {
  const { lease, reservation } = setup("call-omo-agent:sync", false)
  expect(lease?.release("test:recovery")).toBe("unsettled")
  expect(getPromptReservation(id)?.token).toBe(reservation.token)
  setPromptReservation(id, { ...reservation, expiresAt: Date.now() + 2000 })
  expect(lease?.release("test:recovery")).toBe("released")
})

test.each(["call-omo-agent:sync", "user-prompt", "model-fallback:replacement"])("a newer %s token is never released", (source) => {
  const { lease, reservation } = setup()
  const token = Symbol("new generation")
  setPromptReservation(id, { ...reservation, source, token })
  expect(lease?.release("test:recovery")).toBe("superseded")
  expect(getPromptReservation(id)?.token).toBe(token)
})

test.each(["abort", "dispose", "bootstrap", "handed-back", "membership"])("execution invalidation %s blocks the old recovery", (kind) => {
  const { lease, abort, dispose, reservation } = setup()
  if (kind === "abort") abort.abort()
  if (kind === "dispose") dispose()
  if (kind === "bootstrap") clearAllDelegatedChildSessionBootstrap()
  if (kind === "handed-back") handedBackSyncSessions.add(id)
  if (kind === "membership") syncSubagentSessions.delete(id)
  expect(lease?.isCurrent()).toBe(false)
  expect(lease?.release("test:recovery")).toBe("superseded")
  expect(getPromptReservation(id)?.token).toBe(reservation.token)
})

test("a wrong turn, failed model, successful assistant or newer user turn grants no terminal authority", () => {
  const { lease } = setup()
  expect(lease?.isTerminalFailure(terminal("other-model"))).toBe(false)
  expect(lease?.isTerminalFailure(terminal("primary", "other prompt"))).toBe(false)
  expect(lease?.isTerminalFailure(terminal("primary", "child prompt", null))).toBe(false)
  const newer = terminal()
  newer.data.push({ info: { role: "user" }, parts: [{ type: "text", text: "new turn" }] })
  expect(lease?.isTerminalFailure(newer)).toBe(false)
})

test("a concurrent invocation cannot borrow another execution's captured hold", () => {
  const { lease, reservation } = setup()
  cleanups.push(registerSyncChildPromptExecution(id, new AbortController().signal, input))
  expect(lease?.isCurrent()).toBe(false)
  expect(captureSyncChildPromptHold(id, model)).toBeUndefined()
  expect(lease?.release("test:recovery")).toBe("superseded")
  expect(getPromptReservation(id)?.token).toBe(reservation.token)
})

const recoveryInput = { body: { model: { providerID: "fixture", modelID: "backup" }, parts: [{ type: "text", text: "continue" }] } }
function recoveryReservation(source = "model-fallback:session.error", settled = true) {
  return { source, dedupeKey: createSemanticPromptDedupeKey(recoveryInput), token: Symbol("recovery"), reservedAt: Date.now(), ...(settled ? { expiresAt: Date.now() + 2000 } : {}) }
}

test.each(["model-fallback:session.error", "runtime-fallback:session.error"])("normal completion ends only the recorded settled %s recovery hold", (source) => {
  const { lease, dispose } = setup()
  const recovery = recoveryReservation(source)
  setPromptReservation(id, recovery)
  lease?.captureRecoveryHold(source, recoveryInput)?.()
  dispose(true)
  expect(getPromptReservation(id)).toBeUndefined()
})

test.each(["replacement", "in-flight", "abort", "exception", "foreign", "wrong-prompt", "concurrent"])("completion preserves the reservation for %s", (kind) => {
  const { lease, dispose, abort } = setup()
  const source = kind === "foreign" ? "user-prompt" : "model-fallback:session.error"
  const recovery = recoveryReservation(source, kind !== "in-flight")
  setPromptReservation(id, recovery)
  lease?.captureRecoveryHold(source, kind === "wrong-prompt" ? input : recoveryInput)?.()
  let expectedToken = recovery.token
  if (kind === "replacement") {
    expectedToken = Symbol("new recovery")
    setPromptReservation(id, { ...recovery, token: expectedToken })
  }
  if (kind === "abort") abort.abort()
  if (kind === "concurrent") cleanups.push(registerSyncChildPromptExecution(id, new AbortController().signal, input))
  dispose(kind !== "exception")
  expect(getPromptReservation(id)?.token).toBe(expectedToken)
})

test("normal completion retains the ordinary synchronous hold", () => {
  const { dispose, reservation } = setup()
  dispose(true)
  expect(getPromptReservation(id)?.token).toBe(reservation.token)
})


test("a same-source same-prompt token replaced while dispatch is awaited cannot be registered", () => {
  const { lease, dispose } = setup()
  const source = "model-fallback:session.error"
  const recovery = recoveryReservation(source, false)
  setPromptReservation(id, recovery)
  const confirm = lease?.captureRecoveryHold(source, recoveryInput)
  const replacement = { ...recoveryReservation(source), token: Symbol("same source replacement") }
  setPromptReservation(id, replacement)
  confirm?.()
  dispose(true)
  expect(getPromptReservation(id)?.token).toBe(replacement.token)
})

test("a captured pending recovery is registered only after its own finalizer settles", () => {
  const { lease, dispose } = setup()
  const source = "model-fallback:session.error"
  const recovery = recoveryReservation(source, false)
  setPromptReservation(id, recovery)
  const confirm = lease?.captureRecoveryHold(source, recoveryInput)
  setPromptReservation(id, { ...recovery, expiresAt: Date.now() + 2000 })
  confirm?.()
  dispose(true)
  expect(getPromptReservation(id)).toBeUndefined()
})
