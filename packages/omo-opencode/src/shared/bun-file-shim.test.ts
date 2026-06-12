import { readFile } from "node:fs/promises"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import {
  bunFile as sharedBunFile,
  bunWrite as sharedBunWrite,
} from "@oh-my-opencode/utils/runtime"

import { bunFile, bunWrite } from "./bun-file-shim"

let temporaryDirectory = ""

function temporaryPath(fileName: string): string {
  return join(temporaryDirectory, fileName)
}

function arrayBufferFromBytes(bytes: readonly number[]): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.length)
  const view = new Uint8Array(arrayBuffer)

  view.set(bytes)

  return arrayBuffer
}

describe("bun-file-shim", () => {
  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "bun-file-shim-"))
  })

  afterAll(async () => {
    if (temporaryDirectory.length === 0) return

    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it("#given old shared shim path #when imported #then it re-exports the shared runtime implementation", () => {
    expect(bunFile).toBe(sharedBunFile)
    expect(bunWrite).toBe(sharedBunWrite)
  })

  describe("#given bunFile", () => {
    it("#when text is called then it reads file contents", async () => {
      const filePath = temporaryPath("text.txt")
      const content = "hello from file"

      await writeFile(filePath, content)

      expect(await bunFile(filePath).text()).toBe(content)
    })

    it("#when arrayBuffer is called then it returns exact file bytes", async () => {
      const filePath = temporaryPath("bytes.bin")
      const bytes = new Uint8Array([0, 1, 2, 255])

      await writeFile(filePath, bytes)

      const arrayBuffer = await bunFile(filePath).arrayBuffer()

      expect(arrayBuffer.byteLength).toBe(bytes.byteLength)
      expect(Array.from(new Uint8Array(arrayBuffer))).toEqual(Array.from(bytes))
    })

    it("#when exists is called then it reflects file presence", async () => {
      const existingPath = temporaryPath("existing.txt")
      const missingPath = temporaryPath("missing.txt")

      await writeFile(existingPath, "present")

      expect(await bunFile(existingPath).exists()).toBe(true)
      expect(await bunFile(missingPath).exists()).toBe(false)
    })

    it("#when delete is called then it removes the file", async () => {
      const filePath = temporaryPath("delete-me.txt")

      await writeFile(filePath, "remove")
      await bunFile(filePath).delete()

      expect(await bunFile(filePath).exists()).toBe(false)
    })
  })

  describe("#given bunWrite", () => {
    it("#when writing string data then it writes contents and returns byte count", async () => {
      const filePath = temporaryPath("write-string.txt")
      const content = "write me"
      const bytesWritten = await bunWrite(filePath, content)

      expect(bytesWritten).toBe(new TextEncoder().encode(content).byteLength)
      expect(await readFile(filePath, "utf8")).toBe(content)
    })

    it("#when writing array buffer data then it writes exact bytes", async () => {
      const filePath = temporaryPath("write-array-buffer.bin")
      const arrayBuffer = arrayBufferFromBytes([65, 66, 67, 68])
      const bytesWritten = await bunWrite(filePath, arrayBuffer)
      const written = await readFile(filePath)

      expect(bytesWritten).toBe(arrayBuffer.byteLength)
      expect(Array.from(written)).toEqual([65, 66, 67, 68])
    })

    it("#when writing then reading text then it round trips content", async () => {
      const filePath = temporaryPath("round-trip.txt")
      const content = "round trip content"

      await bunWrite(filePath, content)

      expect(await bunFile(filePath).text()).toBe(content)
    })

    it("#when writing another text file then it round trips content", async () => {
      const filePath = temporaryPath("second-round-trip.txt")
      const content = "Hello world"

      await bunWrite(filePath, content)

      expect(await bunFile(filePath).text()).toBe(content)
    })
  })
})
