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

test.skipIf(process.platform === "win32")(
  "#given an rpc_host that challenges and no key record #when a thread is located #then the dial is refused by name and nothing follows the challenge",
  async () => {
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
      expect(located).toEqual({
        kind: "error",
        error: expect.objectContaining({
          code: "internal_error",
          message: `Thread operation failed: unsafe_key_record:${seeded.keyRecord}: missing; set SENPI_RPC_KEY_ROOT to the host's agent dir`,
          next_action: "Run omo thread list and retry after checking the target.",
        }),
      })
      expect(seeded.received.length).toBeGreaterThan(0)
      expect(seeded.received.filter((type) => type !== "get_protocol_info")).toEqual([])
    } finally {
      await seeded.close()
      rmSync(home, { recursive: true, force: true })
    }
  },
)
