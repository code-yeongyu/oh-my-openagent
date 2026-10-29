import { expect, test } from "bun:test"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { wireComputerEscapeEvents } from "./escape-events"
import { createEscapeStopGate } from "./escape-stop-gate"

test("only the queued user's started event lifts Escape, not agent input or session delivery", async () => {
  const pi = new FakeExtensionAPI()
  const gate = createEscapeStopGate()
  wireComputerEscapeEvents(pi, { started: () => Promise.resolve({ escapeStopGate: gate }) })
  gate.stop(1)
  await pi.dispatch("input", { inputId: "agent", attribution: "agent", source: "rpc" })
  await pi.dispatch("input_disposition", { inputId: "agent", disposition: "started" })
  await pi.dispatch("before_agent_start", { trigger: "delivery" })
  expect(await gate.admit()).toBe(false)
  await pi.dispatch("input", { inputId: "user", attribution: "user", source: "extension" })
  await pi.dispatch("input_disposition", { inputId: "user", disposition: "queued" })
  expect(await gate.admit()).toBe(false)
  await pi.dispatch("input_disposition", { inputId: "user", disposition: "started" })
  expect(await gate.admit()).toBe(true)
})

test("handled and rejected inputs are retired without lifting; an unused runtime stays unloaded", async () => {
  const pi = new FakeExtensionAPI()
  const gate = createEscapeStopGate()
  let started: Promise<{ escapeStopGate: typeof gate }> | undefined
  wireComputerEscapeEvents(pi, { started: () => started })
  await pi.dispatch("input", { inputId: "unused", attribution: "user" })
  expect(started).toBeUndefined()
  started = Promise.resolve({ escapeStopGate: gate })
  gate.stop(1)
  for (const disposition of ["handled", "rejected"]) {
    await pi.dispatch("input", { inputId: disposition, attribution: "user" })
    await pi.dispatch("input_disposition", { inputId: disposition, disposition })
    await pi.dispatch("input_disposition", { inputId: disposition, disposition: "started" })
    expect(await gate.admit()).toBe(false)
  }
})
