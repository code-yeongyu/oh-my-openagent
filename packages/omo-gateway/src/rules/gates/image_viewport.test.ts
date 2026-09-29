import { describe, expect, it } from "bun:test"
import { gate } from "./image_viewport"
import { imageSizeOf } from "./image-size"
import { intentOf, THREAD } from "./testing"

function upload(path: string) {
  return intentOf("file", [{ op: "upload", key: THREAD, files: [{ path, title: path }], comment: null }])
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const sizes: Record<string, { width: number; height: number }> = {
  "phone.png": { width: 1000, height: 2200 },
  "tall.png": { width: 1000, height: 2201 },
  "huge.png": { width: 2000, height: 2401 },
}
const ctx = { imageSize: async (path: string) => sizes[path] ?? null }

describe("image_viewport gate", () => {
  it("#given an image at exactly the 2.2 ratio and a non-image file #when run #then it passes", async () => {
    const intent = intentOf("file", [{ op: "upload", key: THREAD, files: [{ path: "phone.png", title: "p" }, { path: "log.txt", title: "l" }], comment: null }])
    expect(await gate.run(intent, {}, ctx)).toEqual({ ok: true })
  })

  it("#given an image taller than 2.2 x width #when run #then it is refused asking for per-scene captures", async () => {
    expect(await gate.run(upload("tall.png"), {}, ctx)).toEqual({ refuse: expect.stringContaining("per-scene captures") })
  })

  it("#given an image over 2400 px high #when run #then it is refused", async () => {
    expect(await gate.run(upload("huge.png"), {}, ctx)).toHaveProperty("refuse")
  })

  it("#given an image whose size cannot be read #when run #then it is refused", async () => {
    expect(await gate.run(upload("unknown.png"), {}, ctx)).toHaveProperty("refuse")
  })

  it("#given PNG header bytes #when read #then the size is decoded", () => {
    expect(imageSizeOf(png(640, 1408))).toEqual({ width: 640, height: 1408 })
    expect(imageSizeOf(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
