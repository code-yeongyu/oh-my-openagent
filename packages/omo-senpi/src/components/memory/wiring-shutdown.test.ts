import { describe, expect, it } from "bun:test"

import { InFlightReads } from "@oh-my-opencode/memory-core"

import { createShutdownDrain, shutdownDeadlineAt } from "./shutdown-drain"
import { gate, gatedStep } from "./shutdown-work.test-support"
import { runMemorySessionShutdown } from "./wiring-shutdown"

const SETTLED = { settled: async () => {} }

describe("memory session shutdown budget", () => {
  it("#given tracked memory work that never settles #when the session quits #then the drain's own steps run before that work spends the shared budget", async () => {
    // given
    const ran: string[] = []
    const drain = createShutdownDrain({
      steps: {
        flushJournal: async () => { ran.push("journal-flush") },
        enqueueFinalDelta: async () => { ran.push("facts-enqueue") },
        flushSkillsUsage: async () => { ran.push("skills-usage-flush") },
      },
    })
    drain.registerEvaluator(async () => { ran.push("shutdown-evaluator") })
    const work = new InFlightReads()
    const held = gate()
    const { step, finished } = gatedStep(held)
    void work.track(step)
    await held.entered

    // when
    await runMemorySessionShutdown({
      shutdownDrain: drain,
      maintenance: { ...SETTLED, dispose: () => {} },
      reflectionLive: { ...SETTLED, shutdown: () => {} },
      corpusCache: SETTLED,
      promptCache: SETTLED,
      launches: SETTLED,
      work,
      sessions: new Map(),
      kibitzerRef: {},
      resolveContext: () => undefined,
      factsWiringFor: () => ({}),
      resetSession: () => {},
    }, { reason: "quit", sessionId: "session-quit", deadlineAt: shutdownDeadlineAt(Date.now) })
    held.open()
    await finished

    // then
    expect(ran).toEqual(["journal-flush", "facts-enqueue", "skills-usage-flush", "shutdown-evaluator"])
  }, process.platform === "win32" ? 20_000 : 5_000)
})
