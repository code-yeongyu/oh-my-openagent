import { afterEach, expect, test } from "bun:test"

import { hashArgs } from "./gateway/hash-args"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #14951 design ruling on review 6064335726: one receipt book, two projections. The SDK's keyed control answer carries
// `receipt_expires_at`, its own receipt's expiry; the thread tool's answer keeps the shipped thread contract without it
// (the registry rows' projection records the omission). Everything else is the same answer.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

test("#given the same keyed close through the tool and through the SDK #when each runs #then the tool answer has no receipt_expires_at and the SDK answer carries its own receipt's expiry, the rest equal", async () => {
  const toolSide = surface(account().remote)
  const sdkSide = surface(account().remote)
  const args = { thread: "dur-local", idempotency_key: "k-projection" }

  const viaTool = (await toolSide.run("thread_close", args)) as Record<string, unknown>
  const viaSdk = (await sdkSide.sdk().close(args)) as Record<string, unknown>

  expect("receipt_expires_at" in viaTool).toBe(false)
  const { receipt_expires_at, ...rest } = viaSdk
  expect(rest).toEqual(viaTool)

  const stored = await sdkSide.store.toolReceiptBegin({
    principal: "cli:501",
    operation: "thread_close",
    idempotency_key: "k-projection",
    now: Date.now(),
    args_hash: hashArgs(args),
  })
  expect(stored.kind).toBe("replay")
  expect(receipt_expires_at).toBe(new Date(stored.kind === "replay" ? stored.expires_at : 0).toISOString())
})
