import { describe, expect, test } from "bun:test"
import type { RemoteThreadSurface } from "../remote/ports"
import { fakeRemoteClient } from "../thread-remote-fixture"
import { holderTarget } from "./holder"

describe("holderTarget: an alias holder this device cannot locate because its own relay sign-in lapsed", () => {
  test("#given the locate answers sign_in_required #when the holder is resolved #then host_unavailable names the sign-in, not a re-claim", async () => {
    const remote = {
      client: fakeRemoteClient({
        state: () => "connected",
        here: "a",
        devices: () => [{ device: "b", label: "b", online: true }],
      }),
      sessions: {
        locate: async () => ({ kind: "refused" as const, reason: "sign_in_required" }),
      },
    } as unknown as RemoteThreadSurface
    expect(await holderTarget(remote, { device: "b", session_id: "dur-1" }, "a", [], undefined)).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { device: "b", reason: "sign_in_required" } },
    })
  })
})
