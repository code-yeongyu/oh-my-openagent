import { afterAll, describe, expect, jest, spyOn, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { summarize } from "../summary.ts"
import { MacSession } from "./session.ts"

// Fake helpers speak the recorder protocol without macOS. The test controls the second keystroke and the end of
// the drain so neither depends on when a child process is scheduled.
const FAKE = `
const role = process.argv[2]
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
let index = 0
let stopping = false
let finalPending = false
const key = () => emit({ t: Date.now(), kind: "typed", index: index++, char: "a" })
emit(role === "typist" ? { ctl: "hello", pid: process.pid, window: 1, frontmost: true } : { ctl: "ready", role })
for await (const line of console) {
  const [command] = line.trim().split(" ")
  if (command === "quit") process.exit(0)
  if (command === "reset") emit({ ctl: "reset" })
  if (command === "type" || command === "key") key()
  if (command === "start") emit({ t: Date.now(), kind: "start" })
  if (command === "stop") stopping = true
  if (command === "final" && stopping) {
    finalPending = true
    emit({ ctl: "draining" })
  }
  if (command === "finish-drain" && finalPending) {
    emit({ t: Date.now(), kind: "stop", pendingReads: 1, pendingRegistrations: 0 })
    emit({ t: Date.now(), kind: "field", text: "aa", final: true })
    emit({ ctl: "drained" })
  }
}
`

const dir = mkdtempSync(join(tmpdir(), "sentinel-session-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const fake = (role: string): string => {
  const script = join(dir, "fake.mjs")
  writeFileSync(script, FAKE)
  const path = join(dir, role)
  writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${script}' ${role}\n`)
  chmodSync(path, 0o755)
  return path
}

describe("a recording segment's stop", () => {
  // The fake helpers are POSIX shell launchers; the recorder they stand in for exists only on macOS.
  test.skipIf(process.platform === "win32")(
    "a recorder still draining past the old marker wait ends as pending reads, never as the harness's own timeout",
    async () => {
      const helpers = {
        recorder: fake("recorder"),
        typist: fake("typist"),
        planter: "",
        typistApp: "",
        idle: "",
        idleApp: "",
      }
      const session = await MacSession.open({ helpers, targetPids: [], withPlanter: false })
      const { recorder, typist } = session
      const nextEvent = session.nextEvent.bind(session)
      let virtualStopDeadlineArmed = false
      const observeWait = spyOn(session, "nextEvent").mockImplementation((match, timeoutMs, what) => {
        const isStopWait = what === "recorder stop marker"
        // Only the stop/final deadlines need virtual time; the segment's landing windows remain real.
        if (isStopWait) jest.useFakeTimers()
        const event = nextEvent(match, timeoutMs, what)
        if (isStopWait) virtualStopDeadlineArmed = true
        if (what === "a keystroke after the window") typist?.send("key")
        return event
      })
      try {
        if (recorder === undefined || typist === undefined) throw new Error("sentinel helpers did not open")
        // Register these I/O bounds on the real clock before the segment installs its virtual marker timers.
        const draining = recorder.next((line) => line.ctl === "draining", 2_500, "stop and final commands")
        const drained = recorder.next((line) => line.ctl === "drained", 2_500, "stop and final replies")
        const release = draining.then(() => {
          if (!virtualStopDeadlineArmed) throw new Error("recorder stop deadline was not armed on the virtual clock")
          // The old wait expired at 3 s, before the recorder's 4 s drain budget.
          jest.advanceTimersByTime(3_900)
          recorder.send("finish-drain")
        })
        const flush = drained.then(() => jest.runOnlyPendingTimers())
        const [events] = await Promise.all([session.segment(async () => {}, 0), release, flush])
        expect(summarize(events).faults).toContain("dialog: 1 new-window reads were still running at stop")
      } finally {
        jest.useRealTimers()
        observeWait.mockRestore()
        await session.close()
      }
    },
  )
})
