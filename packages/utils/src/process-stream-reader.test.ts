import { describe, expect, test } from "bun:test"
import { Readable } from "node:stream"

import { readProcessStream } from "./process-stream-reader"

describe("readProcessStream", () => {
  test("#given nullish stream #when reading process output #then returns empty text", async () => {
    expect(await readProcessStream(null)).toBe("")
    expect(await readProcessStream(undefined)).toBe("")
  })

  test("#given Node readable chunks #when reading process output #then concatenates utf8 text", async () => {
    const stream = Readable.from(["hello ", Buffer.from("from "), new Uint8Array(Buffer.from("node"))])

    await expect(readProcessStream(stream)).resolves.toBe("hello from node")
  })

  test("#given Web readable chunks #when reading process output #then concatenates utf8 text", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hello "))
        controller.enqueue(encoder.encode("from web"))
        controller.close()
      },
    })

    await expect(readProcessStream(stream)).resolves.toBe("hello from web")
  })

  test("#given unsupported Node stream chunk #when reading process output #then rejects with type error", async () => {
    const stream = Readable.from([{ unsupported: true }], { objectMode: true })

    await expect(readProcessStream(stream)).rejects.toThrow("Unsupported process stream chunk type: object")
  })
})
