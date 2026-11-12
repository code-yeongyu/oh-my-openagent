import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { summarize } from "../summary.ts"
import { MacSession } from "./session.ts"

// Fake typist and recorder processes speak the helper protocol, so the harness's own waiting is tested without macOS.
// The fake recorder drains for just under the budget the harness sends with stop (3.9 s when none is sent), then
// reports one read still pending, exactly what a real recorder does when a new-window read outlives its drain.
const FAKE = `
const role = process.argv[2]
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
let index = 0
let stopped = false
let finalAsked = false
const finalRead = () => emit({ t: Date.now(), kind: "field", text: "a".repeat(index), final: true })
emit(role === "typist" ? { ctl: "hello", pid: process.pid, window: 1, frontmost: true } : { ctl: "ready", role })
for await (const line of console) {
  const [command, argument] = line.trim().split(" ")
  if (command === "quit") process.exit(0)
  if (command === "reset") emit({ ctl: "reset" })
  if (command === "type") {
    const key = () => emit({ t: Date.now(), kind: "typed", index: index++, char: "a" })
    key()
    setInterval(key, 1_000)
  }
  if (command === "start") emit({ t: Date.now(), kind: "start" })
  if (command === "stop")
    setTimeout(() => {
      stopped = true
      emit({ t: Date.now(), kind: "stop", pendingReads: 1 })
      if (finalAsked) finalRead()
    }, Number(argument ?? 4_000) - 100)
  if (command === "final") {
    if (stopped) finalRead()
    else finalAsked = true
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
      try {
        const events = await session.segment(async () => {}, 50)
        expect(summarize(events).faults).toContain("dialog: 1 new-window reads were still running at stop")
      } finally {
        await session.close()
      }
    },
    20_000,
  )
})
