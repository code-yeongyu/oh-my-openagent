import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadSdk } from "./sdk"
import { createGatewayStore } from "./gateway/store"
import { SEEDED_THREAD, seededLiveHost } from "../../../test-support/seeded-live-host"

const CANARIES = {
  keyHex: "c0ffee".repeat(10) + "abcd",
  keyPathSegment: "keyroot",
  socketPathSegment: "sock",
  row: { cwdSegment: "work", name: "seeded" },
  message: "hello",
}

// As shipped: with no key record for the host's launch, the dial continues unauthenticated and the call succeeds.
// The fix makes this refuse with a named error; flip the expectation then.
test("#given an rpc_host that challenges and no key record #when a thread is located #then (as shipped) it answers ok", async () => {
  const seeded = await seededLiveHost(CANARIES, "key_absent")
  const home = mkdtempSync(join(tmpdir(), "keyabsent-"))
  try {
    const sdk = createThreadSdk({
      agentDir: home,
      cwd: seeded.cwd,
      uid: 501,
      user: "probe",
      env: { HOME: home },
      host: seeded.host,
      store: createGatewayStore({ agentDir: home }),
    } as never)
    const located = await sdk.locate({ thread: SEEDED_THREAD, all_scope: true })
    expect(Reflect.get(Object(located), "kind")).toBe("ok")
  } finally {
    await seeded.close()
    rmSync(home, { recursive: true, force: true })
  }
})
