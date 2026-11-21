import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// omo#14195 review M1: an unlisted own engine is not a transient "did not answer"; its remedy is a machine token.
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const failure = (result: unknown) =>
  (result as { error?: { code: string; next_action: string; details?: Record<string, unknown> } }).error

describe("thread_create on a device whose own engine is not listed (omo#14195)", () => {
  test("#given b names no primary engine endpoint #when a thread is created there #then it fails host_unavailable no_primary_endpoint with the restart-or-update remedy", async () => {
    const a = account({ refuse: "no_primary_endpoint" })
    const { run } = surface(a.remote)
    const result = await run("thread_create", { name: "no-primary-14195", device: "studio", cwd: "/tmp" })
    expect(failure(result)).toMatchObject({
      code: "host_unavailable",
      details: { reason: "no_primary_endpoint", device: "b", remedy: "restart_omo_or_update_device_service" },
    })
  })
})
