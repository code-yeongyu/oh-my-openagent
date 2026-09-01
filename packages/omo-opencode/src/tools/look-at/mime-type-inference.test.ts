import { describe, expect, test } from "bun:test"
import { extractBase64Data, inferMimeTypeFromBase64, inferMimeTypeFromFilePath } from "./mime-type-inference"

describe("mime type inference", () => {
  test("returns MIME from data URL prefix", () => {
    const mime = inferMimeTypeFromBase64("data:image/heic;base64,AAAAGGZ0eXBoZWlj")
    expect(mime).toBe("image/heic")
  })

  test("detects HEIC from raw base64 magic bytes", () => {
    const heicHeader = Buffer.from("00000018667479706865696300000000", "hex").toString("base64")
    const mime = inferMimeTypeFromBase64(heicHeader)
    expect(mime).toBe("image/heic")
  })

  test("detects HEIF from raw base64 magic bytes", () => {
    const heifHeader = Buffer.from("00000018667479706865696600000000", "hex").toString("base64")
    const mime = inferMimeTypeFromBase64(heifHeader)
    expect(mime).toBe("image/heif")
  })

  test("falls back to png when base64 signature is unknown", () => {
    const mime = inferMimeTypeFromBase64("dW5rbm93biBiaW5hcnk=")
    expect(mime).toBe("image/png")
  })

  test("infers heic from file extension", () => {
    const mime = inferMimeTypeFromFilePath("/tmp/photo.HEIC")
    expect(mime).toBe("image/heic")
  })

  test("extracts raw base64 data from data URL", () => {
    const base64 = extractBase64Data("data:image/png;base64,abc123")
    expect(base64).toBe("abc123")
  })

  test("extracts raw base64 data from data URL with extra parameters", () => {
    const base64 = extractBase64Data("data:image/heic;name=clip.heic;base64,abc123")
    expect(base64).toBe("abc123")
  })
})
