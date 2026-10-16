import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { CHECKPOINT_MAX_TURNS } from "./omo-native-session-summary"
import {
  contentFiles,
  expectNoRepeatedSummaryKey,
  inProject,
  killWithoutShutdown,
  registerProcess,
  seedDeadOwnerQueue,
  sentSeqs,
  summaryFiles,
  turnEnd,
  writeInventory,
} from "./optout-purge.test-support"
import { createTransportRecorder, withTempAgentDir } from "./telemetry.test-support"

describe("omo-native session_summary opt-out purge", () => {
  for (const [label, env] of [
    ["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }],
    ["OMO_DISABLE_POSTHOG=1", { OMO_DISABLE_POSTHOG: "1" }],
  ] as const) {
    test(`#given a killed opted-in process's queue on disk #when an opted-out (${label}) process starts #then no telemetry content is left before any event, and nothing is sent`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:old", scope: { cwd: "/repo" } })
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:claimed", scope: { cwd: "/repo" }, claimed: true })
        expect(contentFiles(stateDir).length).toBeGreaterThan(0)

        // when: registration only, no session event yet
        const optedOut = registerProcess({ agentDir, recorder, env, cwd: "/repo", options: { isConfigEnabled: () => true } })

        // then: windows, pending events, claims and the dead owner's registry entry are gone at once
        expect(summaryFiles(stateDir)).toEqual([])
        await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("now", "/repo"))
        await optedOut.dispatch("turn_end", turnEnd(), inProject("now", "/repo"))
        await optedOut.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("now", "/repo"))
        expect(recorder.messages.filter(({ event }) => event === "session_summary")).toEqual([])
      })
    })
  }

  test("#given dead owners' orphans from an opted-out project and an opted-in one #when an opted-out process in the first project starts #then its orphans are dropped unsent and the other project's are kept", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:a", scope: { cwd: "/project-a" } })
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:b", scope: { cwd: "/project-b" } })
      const isConfigEnabled = (cwd: string | undefined) => cwd !== "/project-a"

      // when
      const optedOut = registerProcess({ agentDir, recorder, cwd: "/project-a", options: { isConfigEnabled } })

      // then
      const left = contentFiles(stateDir)
      expect(left.filter((name) => name.includes("hashed_a"))).toEqual([])
      expect(left.filter((name) => !name.startsWith("pending/"))).toEqual(["hashed_b.json"])
      expect(left.filter((name) => name.startsWith("pending/"))).toHaveLength(1)
      await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("a2", "/project-a"))
      await optedOut.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("a2", "/project-a"))
      expect(sentSeqs(recorder, "hashed:a")).toEqual([])
    })
  })

  test("#given a session that sent a checkpoint, then opted out and was killed #when a later opted-in process resumes it #then no (epoch, seq) pair is sent twice and the opt-out left no file", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      let consent = true
      const ticks: Array<() => void> = []
      const options = {
        isConfigEnabled: () => consent,
        scheduleConsentCheck: (check: () => void) => {
          ticks.push(check)
          return () => undefined
        },
      }

      // given: a full window is checkpointed (seq 0 sent), then telemetry is turned off, the consent tick
      // runs, and the process dies
      const first = registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await first.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("resumed", "/repo"))
      for (let turn = 0; turn < CHECKPOINT_MAX_TURNS; turn += 1) await first.dispatch("turn_end", turnEnd(), inProject("resumed", "/repo"))
      expect(sentSeqs(recorder, "hashed:resumed")).toHaveLength(1)
      consent = false
      for (const tick of ticks) tick()
      expect(summaryFiles(stateDir).filter((name) => !name.startsWith("owners/"))).toEqual([])
      killWithoutShutdown(stateDir)

      // when: telemetry is back on and a new process resumes the same session
      consent = true
      const resumed = registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await resumed.dispatch("session_start", { type: "session_start", reason: "resume" }, inProject("resumed", "/repo"))
      await resumed.dispatch("turn_end", turnEnd(), inProject("resumed", "/repo"))
      await resumed.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("resumed", "/repo"))

      // then
      expectNoRepeatedSummaryKey(recorder, "hashed:resumed", 2)
    })
  })

  test("#given a session that reloaded after sending seq 0 #when an opted-out process starts and then an opted-in one resumes it #then the opt-out left no file and no (epoch, seq) pair is sent twice", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      const options = { isConfigEnabled: () => true, scheduleConsentCheck: () => () => undefined }
      const first = registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await first.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("cycled", "/repo"))
      await first.dispatch("turn_end", turnEnd(), inProject("cycled", "/repo"))
      await first.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, inProject("cycled", "/repo"))
      expect(sentSeqs(recorder, "hashed:cycled")).toHaveLength(1)
      killWithoutShutdown(stateDir)

      // when: an opted-out process starts (its startup purge runs), then an opted-in one resumes the session
      registerProcess({ agentDir, recorder, cwd: "/repo", env: { DO_NOT_TRACK: "1" }, options })
      expect(summaryFiles(stateDir).filter((name) => !name.startsWith("owners/"))).toEqual([])
      const resumed = registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await resumed.dispatch("session_start", { type: "session_start", reason: "resume" }, inProject("cycled", "/repo"))
      await resumed.dispatch("turn_end", turnEnd(), inProject("cycled", "/repo"))
      await resumed.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("cycled", "/repo"))

      // then
      expectNoRepeatedSummaryKey(recorder, "hashed:cycled", 2)
    })
  })
})
