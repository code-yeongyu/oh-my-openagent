import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { B_ROW, createRemoteThreadFixture } from "../thread-remote-fixture"

// #14274: a reopen keeps the thread's name, and a name given at reopen is applied, on this device and on another.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const ENDED_ROW = { ...B_ROW, state: "ended" }
// The disk session's file, so the engine resumes it under the id its header carries, as senpi does.
const writeSessionFile = (agentDir: string, id: string): void =>
  writeFileSync(join(agentDir, `${id}.jsonl`), `${JSON.stringify({ type: "session", version: 3, id, cwd: process.cwd() })}\n`)
const namesSent = (sent: ReturnType<typeof account>["sent"]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "set_session_name").map((entry) => entry.rpc?.["name"])

describe("thread_create keeps or applies a reopened thread's name (#14274)", () => {
  test("#given a session file here whose thread was named #when thread_create reopens it #then the result and the session carry that name", async () => {
    const { run, setSessionName, agentDir } = surface(account().remote, {
      diskSessions: ["dur-on-disk"],
      diskNames: { "dur-on-disk": "fix the build" },
    })
    writeSessionFile(agentDir, "dur-on-disk")
    expect(await run("thread_create", { thread: "dur-on-disk" })).toMatchObject({ kind: "ok", name: "fix the build" })
    expect(setSessionName.mock.calls.map((call) => call[1])).toEqual(["fix the build"])
  })

  test("#given a session file here #when thread_create reopens it with a name #then that name is applied and returned", async () => {
    const { run, setSessionName, agentDir } = surface(account().remote, {
      diskSessions: ["dur-on-disk"],
      diskNames: { "dur-on-disk": "fix the build" },
    })
    writeSessionFile(agentDir, "dur-on-disk")
    expect(await run("thread_create", { thread: "dur-on-disk", name: "x" })).toMatchObject({ kind: "ok", name: "x" })
    expect(setSessionName.mock.calls.map((call) => call[1])).toEqual(["x"])
  })

  test("#given b's closed thread listed under its title #when thread_create reopens it #then the title is set on the reopened session and returned", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", name: ENDED_ROW.title })
    expect(namesSent(a.sent)).toEqual([ENDED_ROW.title])
  })

  test("#given b's closed thread #when thread_create reopens it with a name #then that name is set on b and returned", async () => {
    const a = account({ rows: [ENDED_ROW] })
    const { run } = surface(a.remote)
    expect(await run("thread_create", { thread: "dur-on-b", name: "x" })).toMatchObject({ kind: "ok", name: "x" })
    expect(namesSent(a.sent)).toEqual(["x"])
  })
})
