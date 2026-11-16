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
          details: { reason: "fork_unsupported", source, ...(device === undefined ? {} : { device }) },
        },
      })
      expect(openSession).not.toHaveBeenCalled()
      expect(a.sent.filter((entry) => entry.rpc?.["type"] === "open_session")).toEqual([])
    },
  )
})
