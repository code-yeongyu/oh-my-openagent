import { expect, test } from "bun:test"
import { createEscapeStopGate } from "./escape-stop-gate"

test("a queued user input lifts only when delivered; agent and synthetic inputs never lift", async () => {
  const gate = createEscapeStopGate()
  const running = gate.signal
  gate.stop(1)
  expect(running.aborted).toBe(true)
  gate.userInput({ inputId: "agent", attribution: "agent", source: "rpc" })
  gate.inputStarted("agent")
  gate.userInput({ inputId: "synthetic", attribution: "user", synthetic: true })
  gate.inputStarted("synthetic")
  expect(await gate.admit()).toBe(false)
  gate.userInput({ inputId: "answer", attribution: "user", source: "extension" })
  expect(await gate.admit()).toBe(false)
  gate.inputStarted("answer")
  expect(await gate.admit()).toBe(true)
  expect(running.aborted).toBe(true)
  expect(gate.signal.aborted).toBe(false)
  gate.stop(1)
  expect(await gate.admit()).toBe(true)
})

test("the counter read catches a missed notification before admitting another run", async () => {
  let stops = 0
  const gate = createEscapeStopGate(async () => stops)
  expect(await gate.admit()).toBe(true)
  stops = 1
  expect(await gate.admit()).toBe(false)
})

test("handled, rejected, unknown and repeated starts do not lift a stop", async () => {
  const gate = createEscapeStopGate()
  for (const id of ["handled", "rejected"]) {
    gate.userInput({ inputId: id, attribution: "user" })
    gate.inputDiscarded(id)
    gate.stop(id === "handled" ? 1 : 2)
    gate.inputStarted(id)
    expect(await gate.admit()).toBe(false)
  }
  gate.inputStarted("unknown")
  expect(await gate.admit()).toBe(false)
  gate.userInput({ inputId: "user", attribution: "user" })
  gate.inputStarted("user")
  gate.stop(3)
  gate.inputStarted("user")
  expect(await gate.admit()).toBe(false)
})

test("seeded stop/input traces preserve the delivered-user and generation invariants", async () => {
  // Invariants: only a new engine stop latches; only one matching delivered
  // user input lifts; a lifted gate never un-aborts a running generation.
  for (let seed = 1; seed <= 64; seed += 1) {
    let random = seed
    const next = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return random
    }
    let count = 0
    let stopped = false
    const users = new Set<string>()
    const gate = createEscapeStopGate()
    for (let step = 0; step < 80; step += 1) {
      const action = (next() >>> 16) % 6
      const id = `input-${(next() >>> 16) % 9}`
      switch (action) {
        case 0: {
          const old = gate.signal
          gate.stop(++count)
          stopped = true
          expect(old.aborted).toBe(true)
          break
        }
        case 1:
          users.add(id)
          gate.userInput({ inputId: id, attribution: "user", source: "extension" })
          break
        case 2:
          users.delete(id)
          gate.userInput({ inputId: id, attribution: "agent", source: "rpc" })
          break
        case 3:
          if (users.delete(id)) stopped = false
          gate.inputStarted(id)
          break
        case 4:
          users.delete(id)
          gate.inputDiscarded(id)
          break
        case 5:
          gate.stop(count)
          break
      }
      expect(await gate.admit()).toBe(!stopped)
      expect(gate.signal.aborted).toBe(stopped)
    }
  }
})
