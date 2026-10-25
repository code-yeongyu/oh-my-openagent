import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CHECKPOINT_MAX_TURNS } from "./omo-native-session-summary"
import {
  contentFiles,
  createWatchedTransport,
  expectNoRepeatedSummaryKey,
  inProject,
  killWithoutShutdown,
  registerProcess,
  seedDeadOwnerQueue,
  readSummaryFile,
  sentSeqs,
  trackedSidecar,
  summaryFiles,
  turnEnd,
  writeInventory,
} from "./optout-purge.test-support"
import { createTransportRecorder, withTempAgentDir } from "./telemetry.test-support"

describe("omo-native session_summary opt-out purge", () => {
  // Only the persisted setting purges (lead ruling 2026-10-20); an env opt-out on top of it changes nothing.
  for (const [label, env] of [
    ["the persisted setting off", {}],
    ["the persisted setting off and DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }],
  ] as const) {
    test(`#given a killed opted-in process's queue on disk #when a process opted out by ${label} starts #then no telemetry content is left before any event, and nothing is sent`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:old", scope: { cwd: "/repo" } })
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:claimed", scope: { cwd: "/repo" }, claimed: true })
        expect(contentFiles(stateDir).length).toBeGreaterThan(0)

        // when: registration only, no session event yet
        const optedOut = await registerProcess({ agentDir, recorder, env, cwd: "/repo", options: { isConfigEnabled: () => false } })

        // then: windows, pending events, claims and the dead owner's registry entry are gone at once
        expect(summaryFiles(stateDir)).toEqual([])
        await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("now", "/repo"))
        await optedOut.dispatch("turn_end", turnEnd(), inProject("now", "/repo"))
        await optedOut.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("now", "/repo"))
        expect(recorder.messages.filter(({ event }) => event === "session_summary")).toEqual([])
      })
    })
  }

  // An opt-out set by environment variable belongs to this process alone: a consented session's queue, a dead
  // owner's claim included, stays for a consented process to send (lead ruling 2026-10-20).
  for (const [label, env] of [
    ["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }],
    ["OMO_DISABLE_POSTHOG=1", { OMO_DISABLE_POSTHOG: "1" }],
    // CI detection is an automated-run opt-out (#10934); the test env otherwise allows automation.
    ["CI=1", { CI: "1", OMO_TELEMETRY_ALLOW_AUTOMATION: "" }],
  ] as const) {
    test(`#given a killed opted-in process's queue on disk #when a process opted out only by ${label} starts and quits #then that queue is left intact and nothing is sent`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:kept", scope: { cwd: "/repo" } })
        seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:kept-claimed", scope: { cwd: "/repo" }, claimed: true })
        const before = contentFiles(stateDir)
        expect(before.length).toBeGreaterThan(0)

        // when
        const optedOut = await registerProcess({ agentDir, recorder, env, cwd: "/repo", options: { isConfigEnabled: () => true } })
        await optedOut.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("now", "/repo"))
        await optedOut.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("now", "/repo"))

        // then
        expect(contentFiles(stateDir)).toEqual(before)
        expect(recorder.messages.filter(({ event }) => event === "session_summary")).toEqual([])
      })
    })
  }

  // A killed owner never removes its registry entry; once an unrelated process holds its pid, a pid probe alone
  // reads the killed owner as alive and its queue would stay on disk. PID 1 is always held by another process.
  test("#given a killed owner whose pid now belongs to an unrelated live process #when an opted-out process starts #then the owner's queue is gone", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:reused", scope: { cwd: "/repo" }, claimed: true, ownerPid: 1 })
      expect(contentFiles(stateDir).length).toBeGreaterThan(0)

      // when
      await registerProcess({ agentDir, recorder, cwd: "/repo", options: { isConfigEnabled: () => false } })

      // then
      expect(summaryFiles(stateDir)).toEqual([])
    })
  })

  test("#given dead owners' orphans from an opted-out project and an opted-in one #when an opted-out process in the first project starts #then its orphans are dropped unsent and the other project's are kept", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:a", scope: { cwd: "/project-a" } })
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:b", scope: { cwd: "/project-b" } })
      const isConfigEnabled = (cwd: string | undefined) => cwd !== "/project-a"

      // when
      const optedOut = await registerProcess({ agentDir, recorder, cwd: "/project-a", options: { isConfigEnabled } })

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
      const recorder = createWatchedTransport()
      const sidecar = trackedSidecar()
      let consent = true
      const ticks: Array<() => void> = []
      const options = {
        isConfigEnabled: () => consent,
        loadRecovery: sidecar.load,
        scheduleConsentCheck: (check: () => void) => {
          ticks.push(check)
          return () => undefined
        },
      }

      // given: a full window is checkpointed (seq 0 sent), then telemetry is turned off, the consent tick
      // runs, and the process dies
      const first = await registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await first.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("resumed", "/repo"))
      for (let turn = 0; turn < CHECKPOINT_MAX_TURNS; turn += 1) await first.dispatch("turn_end", turnEnd(), inProject("resumed", "/repo"))
      await recorder.summariesSent("hashed:resumed", 1)
      await sidecar.sendsSettled()
      expect(sentSeqs(recorder, "hashed:resumed")).toHaveLength(1)
      consent = false
      for (const tick of ticks) tick()
      expect(summaryFiles(stateDir).filter((name) => !name.startsWith("owners/"))).toEqual([])
      killWithoutShutdown(stateDir)

      // when: telemetry is back on and a new process resumes the same session
      consent = true
      const resumed = await registerProcess({ agentDir, recorder, cwd: "/repo", options })
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
      const first = await registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await first.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("cycled", "/repo"))
      await first.dispatch("turn_end", turnEnd(), inProject("cycled", "/repo"))
      await first.dispatch("session_shutdown", { type: "session_shutdown", reason: "reload" }, inProject("cycled", "/repo"))
      expect(sentSeqs(recorder, "hashed:cycled")).toHaveLength(1)
      killWithoutShutdown(stateDir)

      // when: a process opted out by the persisted setting starts (its startup purge runs), then an opted-in one resumes the session
      await registerProcess({ agentDir, recorder, cwd: "/repo", options: { ...options, isConfigEnabled: () => false } })
      expect(summaryFiles(stateDir).filter((name) => !name.startsWith("owners/"))).toEqual([])
      const resumed = await registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await resumed.dispatch("session_start", { type: "session_start", reason: "resume" }, inProject("cycled", "/repo"))
      await resumed.dispatch("turn_end", turnEnd(), inProject("cycled", "/repo"))
      await resumed.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("cycled", "/repo"))

      // then
      expectNoRepeatedSummaryKey(recorder, "hashed:cycled", 2)
    })
  })

  // Lead ruling (2026-10-24): a torn or unreadable summary file can never be sent; under a persisted opt-out it
  // goes with the rest, while an env-only opt-out still leaves the directory to the consented processes.
  for (const [label, setup, gone] of [
    ["the persisted setting off", { env: {}, isConfigEnabled: () => false }, true],
    ["DO_NOT_TRACK only", { env: { DO_NOT_TRACK: "1" }, isConfigEnabled: () => true }, false],
  ] as const) {
    test(`#given a torn window and a torn pending event #when a process opted out by ${label} starts #then they are ${gone ? "deleted" : "left in place"}`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const root = join(stateDir, "session-summary")
        mkdirSync(join(root, "pending"), { recursive: true })
        writeFileSync(join(root, "hashed_torn.json"), '{"v":2,"consent":"enabled","scope":{"cwd":"/repo"},"window":{"sums":{"cost_1e4":12')
        writeFileSync(join(root, "pending", "0395eae0-1111-4222-8333-944455556699.json"), "not json")

        await registerProcess({ agentDir, recorder: createTransportRecorder(), env: setup.env, cwd: "/repo", options: { isConfigEnabled: setup.isConfigEnabled } })

        expect(summaryFiles(stateDir)).toEqual(gone ? [] : ["hashed_torn.json", "pending/0395eae0-1111-4222-8333-944455556699.json"])
      })
    })
  }

  // #11198: consent given through a profile is consent too (lead ruling 2026-10-20 covers it): the purge judges a
  // record by the config its writer selected, so a profile-consented queue survives another session's env opt-out.
  test("#given a live session consented through OMO_PROFILE=work while the base omo.json is off #when a process opted out only by DO_NOT_TRACK starts #then that session's window is kept", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const workProfileOn = { isConfigEnabled: (_cwd: string | undefined, env: Record<string, string | undefined>) => env.OMO_PROFILE === "work" }
      const writer = await registerProcess({ agentDir, recorder: createTransportRecorder(), env: { OMO_PROFILE: "work" }, cwd: "/repo", options: workProfileOn })
      await writer.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("work", "/repo"))
      await writer.dispatch("turn_end", turnEnd(), inProject("work", "/repo"))
      const queued = contentFiles(stateDir)
      expect(queued.length).toBeGreaterThan(0)

      await registerProcess({ agentDir, recorder: createTransportRecorder(), env: { DO_NOT_TRACK: "1" }, cwd: "/repo", options: workProfileOn })

      expect(contentFiles(stateDir)).toEqual(queued)
    })
  })

  // #11198 review: the send, resume and sweep gate judges a record by its writer's config too, not this process's.
  test("#given dead owners' queues from a profile now off and from this process's own profile #when a consented process sweeps #then only the record its writer may still send is sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:off", scope: { cwd: "/repo", config: { OMO_PROFILE: "retired" } } })
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:mine", scope: { cwd: "/repo", config: { OMO_PROFILE: "work" } } })
      const recorder = createWatchedTransport()
      const sidecar = trackedSidecar()
      const options = { isConfigEnabled: (_cwd: string | undefined, env: Record<string, string | undefined>) => env.OMO_PROFILE === "work", loadRecovery: sidecar.load }

      const sweeper = await registerProcess({ agentDir, recorder, env: { OMO_PROFILE: "work" }, cwd: "/repo", options })
      await sweeper.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("now", "/repo"))
      await sweeper.dispatch("turn_end", turnEnd(), inProject("now", "/repo"))
      await recorder.summariesSent("hashed:mine", 1)
      await sidecar.sendsSettled()

      expect(sentSeqs(recorder, "hashed:off")).toEqual([])
    })
  })

  // The per-pass consent cache keys on cwd AND config: two records of one project under different profiles.
  test("#given two queues in one project under a profile that is on and one that is off #when a process opted out only by DO_NOT_TRACK starts #then only the off profile's queue is deleted", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:work", scope: { cwd: "/repo", config: { OMO_PROFILE: "work" } } })
      seedDeadOwnerQueue(stateDir, { sessionHash: "hashed:private", scope: { cwd: "/repo", config: { OMO_PROFILE: "private" } } })
      const options = { isConfigEnabled: (_cwd: string | undefined, env: Record<string, string | undefined>) => env.OMO_PROFILE === "work" }

      await registerProcess({ agentDir, recorder: createTransportRecorder(), env: { DO_NOT_TRACK: "1" }, cwd: "/repo", options })

      const windows = summaryFiles(stateDir).filter((name) => !name.includes("/"))
      expect(windows).toContain("hashed_work.json")
      expect(windows).not.toContain("hashed_private.json")
      const pending = summaryFiles(stateDir).filter((name) => name.startsWith("pending/"))
      expect(pending.map((name) => readSummaryFile(stateDir, name).sessionHash)).toEqual(["hashed:work"])
    })
  })
})
