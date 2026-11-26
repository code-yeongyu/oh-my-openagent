import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// The pinned engine's open_session never reads forkFrom (senpi modes/rpc/session-router-open-profile.ts builds the open
// profile without it), so an open carrying it starts a blank thread. Until the engine forks, fork_from is refused typed.
describe("thread_create fork_from with an engine that cannot fork on open_session (#13031)", () => {
  test.each([
    ["a source on this device", "dur-local", undefined],
    ["a source on device b", "dur-on-b", "b"],
  ] as const)(
    "#given %s #when thread_create forks it #then unsupported names the resolved source and no session opens",
    async (_label, source, device) => {
      const a = account()
      const { run, openSession } = surface(a.remote)

      const result = await run("thread_create", { fork_from: source })

      expect(result).toMatchObject({
        kind: "error",
        error: {
          code: "unsupported",
          details: { reason: "fork_unsupported", thread: source, ...(device === undefined ? {} : { device }) },
        },
      })
      expect(openSession).not.toHaveBeenCalled()
      expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toEqual([])
    },
  )
})

// senpi#7085: an engine that advertises open_session_fork forks on open_session { forkFrom }; the create sends it the
// source and answers the fork, a new thread, never a refusal and never a blank session.
describe("thread_create fork_from with an engine that forks (#13031)", () => {
  test("#given this device's engine forks #when thread_create forks a thread here #then the open names the source and the fork is a new thread", async () => {
    const { run, openSession } = surface(account().remote, { forks: true })

    expect(await run("thread_create", { fork_from: "dur-local" })).toMatchObject({
      kind: "ok",
      thread: "dur-fork-here",
    })
    expect(openSession.mock.calls.map((call) => call[0].forkFrom)).toEqual(["dur-local"])
  })

  test("#given b's engine forks #when thread_create forks a thread on b #then b's open_session names the source and the fork is a new thread on b", async () => {
    const a = account({ forks: true })
    const { run } = surface(a.remote)

    expect(await run("thread_create", { fork_from: "dur-on-b" })).toMatchObject({
      kind: "ok",
      thread: "dur-fork-on-b",
      device: "b",
    })
    expect(
      a.sent.filter((entry) => entry.rpc?.["type"] === "open_session").map((entry) => entry.rpc?.["forkFrom"]),
    ).toEqual(["dur-on-b"])
  })

  test("#given b's engine forks but holds no session file of the source #when thread_create forks it #then not_found with the engine's reason, naming the device that holds the source as the way out", async () => {
    const a = account({ forks: true, sessionFiles: {} })
    const { run } = surface(a.remote)

    const result = await run("thread_create", { fork_from: "dur-on-b" })

    expect(result).toMatchObject({
      kind: "error",
      error: {
        code: "not_found",
        details: { reason: "fork_source_not_local", thread: "dur-on-b", device: "b" },
        next_action: expect.stringContaining("device that holds its source"),
      },
    })
  })
})
