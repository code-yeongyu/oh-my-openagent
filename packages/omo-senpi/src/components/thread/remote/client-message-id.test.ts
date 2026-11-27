import { describe, expect, test } from "bun:test"
import { keyedMessageId } from "./client-message-id"

// #15021, the security owner's ruling: the holder-side id of a keyed send is scoped by thread, key and principal class,
// so a connector or a service repeating a person's key on the same thread is never the person's message, while one
// class's sends through any surface are one message.
describe("keyedMessageId scopes a key by thread and principal class", () => {
  const thread = { device: "dev-b", session: "rk-1", durable: "dur-1" }

  test("#given one thread and one key #when the class differs #then each class gets its own id", () => {
    const ids = (["first_party", "connector", "service"] as const).map((cls) => keyedMessageId(thread, cls, "k"))
    expect(new Set(ids).size).toBe(3)
  })

  test("#given one class and one key #when the thread differs #then the ids differ; the same thread and key give one id", () => {
    expect(keyedMessageId(thread, "first_party", "k")).toBe(keyedMessageId({ ...thread }, "first_party", "k"))
    expect(keyedMessageId(thread, "first_party", "k")).not.toBe(
      keyedMessageId({ ...thread, durable: "dur-2" }, "first_party", "k"),
    )
  })

  test("#given a send without a key #then each gets a fresh id", () => {
    expect(keyedMessageId(thread, "first_party", undefined)).not.toBe(keyedMessageId(thread, "first_party", undefined))
  })
})
