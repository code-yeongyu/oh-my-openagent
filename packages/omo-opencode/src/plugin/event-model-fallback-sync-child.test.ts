import { afterEach, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { createSemanticPromptDedupeKey } from "@oh-my-opencode/utils/prompt-async-gate/semantic-dedupe"
import { getPromptReservation, setPromptReservation } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { syncSubagentSessions } from "../features/claude-code-session-state"
import { clearAllDelegatedChildSessionBootstrap, registerDelegatedChildSessionBootstrap } from "../shared/delegated-child-session-bootstrap"
import { registerSyncChildPromptExecution } from "../shared/sync-child-prompt-hold"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createModelFallbackContinuationController } from "./event-model-fallback-state"
import type { PluginEventContext } from "./event-types"

const id = "sync-child-controller-test"
const model = { providerID: "fixture", modelID: "primary" }
const input = { path: { id }, body: { model, parts: [{ type: "text", text: "child prompt" }] } }
const cleanups: Array<() => void> = []

function fixture(abort: () => Promise<unknown>, stopped = () => false) {
  const signal = new AbortController()
  cleanups.push(registerSyncChildPromptExecution(id, signal.signal, input))
  syncSubagentSessions.add(id)
  registerDelegatedChildSessionBootstrap({ sessionID: id, promptText: "child prompt" })
  const reservation = { source: "call-omo-agent:sync", dedupeKey: createSemanticPromptDedupeKey(input), token: Symbol("original"), reservedAt: Date.now(), expiresAt: Date.now() + 2000 }
  setPromptReservation(id, reservation)
  const prompts: unknown[] = []
  const ctx = unsafeTestValue<PluginEventContext>({ directory: "/test", client: { session: {
    abort,
    status: async () => ({ data: {} }),
    messages: async () => ({ data: [
      { info: { id: "user", role: "user", time: { created: Date.now() + 1 } }, parts: input.body.parts },
      { info: { role: "assistant", parentID: "user", ...model, time: { created: Date.now(), completed: Date.now() }, error: { name: "APIError" } }, parts: [] },
    ] }),
    promptAsync: async (prompt: unknown) => { prompts.push(prompt); return {} },
  } } })
  const controller = createModelFallbackContinuationController({
    pluginConfig: {}, pluginContext: ctx, lastKnownModelBySession: new Map(),
    continuationsInFlight: new Set(), lastDispatchedContinuationKeys: new Map(),
    resolveSyncChildFallback: () => ({ providerID: "fixture", modelID: "backup" }),
    isSessionStopped: stopped,
  })
  const run = () => controller.autoContinueAfterFallback(id, "session.error", { agentName: "explore", ...model })
  return { reservation, prompts, run, signal }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  syncSubagentSessions.delete(id)
  clearAllDelegatedChildSessionBootstrap()
  releaseAllPromptAsyncReservationsForTesting()
})

test("a confirmed settled sync failure recovers through the normal gate with the resolved backup", async () => {
  const f = fixture(async () => ({}))
  await f.run()
  expect(f.prompts).toHaveLength(1)
  expect(f.prompts[0]).toMatchObject({ body: { model: { providerID: "fixture", modelID: "backup" } } })
})

test.each(["throw", "sdk-error"])("abort failure %s cannot release or retry", async (kind) => {
  const f = fixture(async () => { if (kind === "throw") throw new Error("abort rejected"); return { error: { message: "abort rejected" } } })
  await f.run()
  expect(f.prompts).toHaveLength(0)
  expect(getPromptReservation(id)?.token).toBe(f.reservation.token)
})

test.each(["call-omo-agent:sync", "user-prompt", "model-fallback:new-generation"])("replacement during abort preserves the new %s reservation", async (source) => {
  const newToken = Symbol("replacement")
  const f = fixture(async () => {
    setPromptReservation(id, { ...f.reservation, source, token: newToken })
    return {}
  })
  await f.run()
  expect(f.prompts).toHaveLength(0)
  expect(getPromptReservation(id)?.token).toBe(newToken)
})

test("parent cancellation while abort is awaited preserves the original hold", async () => {
  const f = fixture(async () => { f.signal.abort(); return {} })
  await f.run()
  expect(f.prompts).toHaveLength(0)
  expect(getPromptReservation(id)?.token).toBe(f.reservation.token)
})

test("a stop while abort is awaited prevents release and continuation", async () => {
  let stopped = false
  const f = fixture(async () => { stopped = true; return {} }, () => stopped)
  await f.run()
  expect(f.prompts).toHaveLength(0)
  expect(getPromptReservation(id)?.token).toBe(f.reservation.token)
})

test("a still in-flight sync reservation is never revoked", async () => {
  const f = fixture(async () => ({}))
  const { expiresAt: _hold, ...pending } = f.reservation
  setPromptReservation(id, pending)
  await f.run()
  expect(f.prompts).toHaveLength(0)
  expect(getPromptReservation(id)?.token).toBe(f.reservation.token)
})
