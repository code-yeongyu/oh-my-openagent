import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  contentFiles,
  inProject,
  killWithoutShutdown,
  registerProcess,
  sentSeqs,
  turnEnd,
  writeInventory,
} from "./optout-purge.test-support"
import { createTransportRecorder, withTempAgentDir } from "./telemetry.test-support"

function writeProjectTelemetry(project: string, enabled: boolean): void {
  mkdirSync(join(project, ".omo"), { recursive: true })
  writeFileSync(join(project, ".omo", "omo.json"), JSON.stringify({ telemetry: { enabled } }))
}

describe("omo-native session_summary consent scope", () => {
  test("#given an opted-in session with a window on disk #when the project omo.json turns telemetry off and a turn ends at once #then no window is written and nothing is sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      const home = join(agentDir, "home")
      const project = join(home, "project")
      writeProjectTelemetry(project, true)
      const pi = registerProcess({ agentDir, recorder, cwd: project, env: { HOME: home }, options: { scheduleConsentCheck: () => () => undefined } })
      await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("flip", project))
      await pi.dispatch("turn_end", turnEnd(), inProject("flip", project))
      expect(contentFiles(stateDir)).toHaveLength(1)

      // when: the real config flips, and the next turn ends inside what used to be the consent cache window
      writeProjectTelemetry(project, false)
      await pi.dispatch("turn_end", turnEnd(), inProject("flip", project))

      // then
      expect(contentFiles(stateDir)).toEqual([])
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, inProject("flip", project))
      expect(sentSeqs(recorder, "hashed:flip")).toEqual([])
    })
  })

  test("#given a killed session whose window carries no cwd scope #when an opted-in process whose default consent is on recovers #then the window is dropped unsent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeInventory(agentDir)
      const stateDir = join(agentDir, "omo-senpi", "omo-native")
      const recorder = createTransportRecorder()
      const options = { isConfigEnabled: () => true, scheduleConsentCheck: () => () => undefined }

      // given: a host without a cwd records two turns and dies
      const scopeless = registerProcess({ agentDir, recorder, options })
      await scopeless.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("scopeless"))
      await scopeless.dispatch("turn_end", turnEnd(), inProject("scopeless"))
      await scopeless.dispatch("turn_end", turnEnd(), inProject("scopeless"))
      killWithoutShutdown(stateDir)

      // when
      const recovering = registerProcess({ agentDir, recorder, cwd: "/repo", options })
      await recovering.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("recovering", "/repo"))
      await recovering.dispatch("turn_end", turnEnd(), inProject("recovering", "/repo"))

      // then
      expect(sentSeqs(recorder, "hashed:scopeless")).toEqual([])
      expect(contentFiles(stateDir).filter((name) => name.includes("scopeless"))).toEqual([])
    })
  })

  for (const event of ["turn_end", "session_shutdown"] as const) {
    test(`#given a session in a project that opts out #when a ${event} arrives without a cwd #then consent is still read for that project and no window is written or sent`, async () => {
      await withTempAgentDir(async (agentDir) => {
        writeInventory(agentDir)
        const stateDir = join(agentDir, "omo-senpi", "omo-native")
        const recorder = createTransportRecorder()
        let projectEnabled = true
        const options = {
          isConfigEnabled: (cwd: string | undefined) => cwd !== "/project-a" || projectEnabled,
          scheduleConsentCheck: () => () => undefined,
        }
        const pi = registerProcess({ agentDir, recorder, cwd: "/project-a", options })
        await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, inProject("cwdless", "/project-a"))
        await pi.dispatch("turn_end", turnEnd(), inProject("cwdless", "/project-a"))

        // when: the project opts out and the next event carries no cwd
        projectEnabled = false
        const payload = event === "turn_end" ? turnEnd() : { type: "session_shutdown", reason: "quit" }
        await pi.dispatch(event, payload, inProject("cwdless"))

        // then
        expect(contentFiles(stateDir)).toEqual([])
        expect(sentSeqs(recorder, "hashed:cwdless")).toEqual([])
      })
    })
  }
})
