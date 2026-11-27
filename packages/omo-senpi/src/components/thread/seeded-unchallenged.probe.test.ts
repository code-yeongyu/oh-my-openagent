import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createThreadSdk } from "./sdk"
import { createGatewayStore } from "./gateway/store"
import { SEEDED_THREAD, seededLiveHost, type SeededFault } from "../../../test-support/seeded-live-host"

const CANARIES = {
  keyHex: "c0ffee".repeat(10) + "abcd",
  keyPathSegment: "keyroot",
  socketPathSegment: "sock",
  row: { cwdSegment: "work", name: "seeded" },
  message: "hello",
}

async function locate(fault: SeededFault) {
  const seeded = await seededLiveHost(CANARIES, fault)
  const home = mkdtempSync(join(tmpdir(), "unchallenged-"))
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
    return { located, socket: seeded.socket, keyRecord: seeded.keyRecord, received: [...seeded.received] }
  } finally {
    await seeded.close()
    rmSync(home, { recursive: true, force: true })
  }
}

test.skipIf(process.platform === "win32")(
  "#given a live key record naming the endpoint #when the endpoint answers without a challenge #then the dial is refused by name and nothing follows get_protocol_info",
  async () => {
    const { located, socket, keyRecord, received } = await locate("no_challenge_with_record")
    expect(located).toEqual({
      kind: "error",
      error: expect.objectContaining({
        code: "internal_error",
        message: `Thread operation failed: host_identity_unproven:${socket}: the host did not authenticate, and key record ${keyRecord} names this endpoint`,
        next_action: "Run omo thread list and retry after checking the target.",
      }),
    })
    expect(received.length).toBeGreaterThan(0)
    expect(received.filter((type) => type !== "get_protocol_info")).toEqual([])
  },
)

test.skipIf(process.platform === "win32")(
  "#given no key record at all #when the endpoint answers without a challenge #then the thread is still served",
  async () => {
    const { located, received } = await locate("no_challenge_no_record")
    expect(located).toMatchObject({ kind: "ok" })
    expect(received).toContain("list_sessions")
  },
)
