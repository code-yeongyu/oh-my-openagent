import { expect, test } from "bun:test"
import { sha256Object } from "./mirror-object"

test("an object read that overruns its deadline stops the mirror and names the key (#12304)", async () => {
  const deadline = new AbortController()
  const key = "releases/v5.1.60/omo-darwin-arm64"
  const store = {
    stream: () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          deadline.abort()
          controller.close()
        },
      }),
  }
  await expect(sha256Object(store, key, deadline.signal)).rejects.toThrow(key)
})

test("a completed object read reports the real bytes and sha256", async () => {
  const bytes = new TextEncoder().encode("mirror fixture")
  const store = { stream: () => new Blob([bytes]).stream() }
  const result = await sha256Object(store, "releases/v5/fixture")
  expect(result.size).toBe(bytes.length)
  expect(result.sha256).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"))
})
