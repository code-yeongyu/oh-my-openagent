import { describe, expect, test } from "bun:test"
import type { Socket } from "node:net"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { readWebSocketText } from "./sparkshell-appserver-websocket"

describe("readWebSocketText", () => {
  test("#given coalesced websocket frames #when reading twice #then buffered bytes are preserved", async () => {
    // given
    let pending: Buffer | null = Buffer.concat([
      createServerTextFrame("notification"),
      createServerTextFrame("response"),
    ])
    const socket = unsafeTestValue<Socket>({
      read: () => {
        const chunk = pending
        pending = null
        return chunk
      },
      once: () => socket,
      off: () => socket,
    })

    // when
    const first = await readWebSocketText(socket)
    const second = await readWebSocketText(socket)

    // then
    expect(first).toBe("notification")
    expect(second).toBe("response")
  })
})

function createServerTextFrame(payload: string): Buffer {
  const body = Buffer.from(payload)
  if (body.length >= 126) {
    throw new Error("test helper only supports short frames")
  }
  return Buffer.concat([Buffer.from([0x81, body.length]), body])
}
