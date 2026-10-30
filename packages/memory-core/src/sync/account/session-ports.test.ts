import { expect, test } from "bun:test"
import { createHttpTransport } from "../engine/adapters/http-transport.ts"
import { enableSync } from "./enable.ts"
import { openAccountSession } from "./session.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"

test("port-based session verifies and uses supplied transports without CLI authentication", async () => {
  const f = await fixture()
  try {
    await enableSync(f.input)
    const transport = createHttpTransport(f.options)
    const outcome = await openAccountSession({
      account: ACCOUNT, keyring: f.keyring, pinDir: f.input.pinDir, spaceId: new Uint8Array(16),
      chain: f.input.chain, transport,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.session.transport).toBe(transport)
    expect((await outcome.session.transport.pull(0, 10)).head).toBe(1)
  } finally {
    await f.close()
  }
})
