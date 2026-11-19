import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

// #14296: an open_session that names a session file and no folder makes the engine probe the file's path on the host
// loop, each filesystem step bounded at 500 ms; on a loaded host a step misses it and the reopen fails open_failed
// ("a filesystem step did not answer in time ... name its folder with cwd"). A reopen knows the thread's folder, so it
// names it, and the engine never runs that probe.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ENDED_ROW = { ...B_ROW, state: "ended" }

describe("thread_create reopening a closed thread names its folder (#14296)", () => {
  test("#given a session file here #when thread_create reopens it #then the open names the file and the folder its header records", async () => {
    const { run, openSession, agentDir } = surface(account().remote, { diskSessions: ["dur-on-disk"] })
    writeFileSync(
      join(agentDir, "dur-on-disk.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "dur-on-disk", cwd: process.cwd() })}\n`,
    )
    expect(await run("thread_create", { thread: "dur-on-disk" })).toMatchObject({ kind: "ok" })
    const opens = openSession.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0])
    expect(opens).toHaveLength(1)
    expect(opens[0]).toMatchObject({ sessionPath: join(agentDir, "dur-on-disk.jsonl"), cwd: process.cwd() })
  })

  test("#given b's closed thread #when thread_create reopens it #then the open_session sent to b names the file and the folder b's find_session reports", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b" })).toMatchObject({ kind: "ok" })
    const frames = a.sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ sessionPath: expect.any(String), cwd: B_ROW.project })
  })
})
