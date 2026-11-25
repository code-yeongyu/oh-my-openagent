import { afterEach, expect, test } from "bun:test"

import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runThreadCommand } from "../bin/lib/thread.js"

// B8 on omo thread: an unexpected exception under the thread SDK prints internal_error with fixed text and exit 5; the
// exception text appears on neither stdout nor stderr.

const CANARY = "canary-b8-5e1f secret=sk-live-do-not-print"
const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

test("#given a host whose listing throws #when omo thread list and close run #then exit 5 with internal_error and no exception text on either stream", async () => {
  const seen: unknown[] = []
  const s = fixture.surface(fixture.account().remote, { onUnexpected: (error: unknown) => void seen.push(error) })
  const fault = async () => {
    throw new Error(CANARY)
  }
  Object.assign(s.host, { listView: fault, listSessions: fault })
  const sdk = s.sdk()
  for (const args of [["list"], ["close", "dur-local"]]) {
    const out: string[] = []
    const exit = await runThreadCommand([...args, "--json"], {
      engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      pluginRoot: "/plugin",
      agentDir: s.agentDir,
      env: {},
      cwd: process.cwd(),
      stdout: { write: (text: string) => void out.push(text) },
      stderr: { write: (text: string) => void out.push(text) },
      platform: "linux",
      loadSqlite: async () => ({}),
      importSdk: async () => ({ createThreadSdk: () => ({ ...sdk, dispose: async () => {} }) }),
      identity: { uid: 501, user: "qa" },
    })
    expect(exit).toBe(5)
    expect(out.join("")).toContain("internal_error")
    expect(out.join("")).not.toContain("canary-b8")
  }
  expect(seen.length).toBeGreaterThan(0)
})
