import { afterEach, describe, expect, test } from "bun:test"
import { sdkOn, type Cleanups } from "./address/testing/entries"
import { createTwoDevices, T } from "./address/testing/two-devices"

const cleanups: Cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// T1a of #14943 (the T1b pin of the SDK's send): a send to a thread on another device answers the id of what it sent,
// from the agent's tool (a delivery) and from a script's SDK (the person's prompt), so either caller can name it later.
describe("a send to a thread on another device answers its delivery_id", () => {
  test("#given a live thread on device b #when thread_send and ThreadSdk.send address it #then both answers carry a delivery_id", async () => {
    // given
    const td = createTwoDevices()
    cleanups.push(td.cleanup)

    // when
    const tool = (await td.run("thread_send", { thread: T.bLive, message: "x" })) as {
      readonly kind: string
      readonly delivery_id?: unknown
    }
    const sdk = (await sdkOn(td, cleanups).send({ thread: T.bLive, text: "x" })) as {
      readonly kind: string
      readonly delivery_id?: unknown
    }

    // then
    expect({ tool: tool.kind, sdk: sdk.kind }).toEqual({ tool: "ok", sdk: "ok" })
    expect({ tool: typeof tool.delivery_id, sdk: typeof sdk.delivery_id }).toEqual({ tool: "string", sdk: "string" })
  })
})
