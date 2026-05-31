/// <reference path="../../bun-test.d.ts" />

import { Buffer as NodeBuffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { bunFile, bunWrite } from "./bun-file-shim"

type NodeFallbackBunFileLike = {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  exists(): Promise<boolean>
  delete(): Promise<void>
}

type NodeFallbackBunFile = (path: string) => NodeFallbackBunFileLike
type NodeFallbackBunWrite = (path: string, data: string | ArrayBuffer | Uint8Array) => Promise<number>

type NodeFallbackExports = {
  bunFile: NodeFallbackBunFile
  bunWrite: NodeFallbackBunWrite
}

type BunFileTestRuntime = {
  Transpiler: new (options: { loader: "ts" }) => { transformSync(source: string): string }
}

type BunFileSandbox = {
  access: typeof access
  Buffer: typeof NodeBuffer
  console: Console
  Promise: PromiseConstructor
  readFile: typeof readFile
  TextEncoder: typeof TextEncoder
  Uint8Array: Uint8ArrayConstructor
  unlink: typeof unlink
  writeFile: typeof writeFile
  __exports?: NodeFallbackExports
}

const runtime = globalThis as typeof globalThis & { Bun: BunFileTestRuntime }
const NODE_FALLBACK = loadNodeFallbackBunFileShim()

let temporaryDirectory = ""
let nodeFallbackTemporaryDirectory = ""

function temporaryPath(fileName: string): string {
  return join(temporaryDirectory, fileName)
}

function nodeFallbackPath(fileName: string): string {
  return join(nodeFallbackTemporaryDirectory, fileName)
}

function loadNodeFallbackBunFileShim(): NodeFallbackExports {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "bun-file-shim.ts")
  const source = readFileSync(sourcePath, "utf8")
  const importStatement = 'import { access, readFile, unlink, writeFile } from "node:fs/promises"\n\n'
  const interfaceSignature = "export interface BunFileLike {"
  const bunFileSignature = "export function bunFile(path: string): BunFileLike {"
  const bunWriteSignature =
    "export async function bunWrite(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number> {"

  if (!source.startsWith(importStatement)) {
    throw new Error("bun-file-shim import statement changed")
  }

  for (const signature of [interfaceSignature, bunFileSignature, bunWriteSignature]) {
    if (!source.includes(signature)) {
      throw new Error(`bun-file-shim signature changed: ${signature}`)
    }
  }

  const transformedSource = source
    .slice(importStatement.length)
    .replace(interfaceSignature, "interface BunFileLike {")
    .replace(bunFileSignature, "function bunFile(path: string): BunFileLike {")
    .replace(
      bunWriteSignature,
      "async function bunWrite(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number> {",
    )
  const scriptSource = `${transformedSource}\nglobalThis.__exports = { bunFile, bunWrite }\n`
  const transpiler = new runtime.Bun.Transpiler({ loader: "ts" })
  const script = transpiler.transformSync(scriptSource)
  const sandbox: BunFileSandbox = {
    access,
    Buffer: NodeBuffer,
    console,
    Promise,
    readFile,
    TextEncoder,
    Uint8Array,
    unlink,
    writeFile,
  }

  runInNewContext(script, sandbox, { filename: sourcePath })

  if (!sandbox.__exports) {
    throw new Error("Node fallback bun-file-shim loader failed")
  }

  return sandbox.__exports
}

function arrayBufferFromBytes(bytes: number[]): ArrayBuffer {
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

    it("#when writing unicode text then it round trips content", async () => {
      const filePath = temporaryPath("unicode-round-trip.txt")
      const content = "Hello 世界 🌍"

      await bunWrite(filePath, content)

      expect(await bunFile(filePath).text()).toBe(content)
    })
  })

  describe("#given Node fallback without Bun global", () => {
    beforeAll(async () => {
      nodeFallbackTemporaryDirectory = await mkdtemp(join(tmpdir(), "bun-file-shim-node-"))
    })

    afterAll(async () => {
      if (nodeFallbackTemporaryDirectory.length === 0) return

      await rm(nodeFallbackTemporaryDirectory, { recursive: true, force: true })
    })

    it("#when text is called then it reads file contents", async () => {
      const filePath = nodeFallbackPath("text.txt")
      const content = "hello from Node fallback"

      await writeFile(filePath, content)

      expect(await NODE_FALLBACK.bunFile(filePath).text()).toBe(content)
    })

    it("#when arrayBuffer is called then it returns exact file bytes", async () => {
      const filePath = nodeFallbackPath("bytes.bin")
      const bytes = new Uint8Array([0, 1, 2, 255, 128])

      await writeFile(filePath, bytes)

      const arrayBuffer = await NODE_FALLBACK.bunFile(filePath).arrayBuffer()

      expect(arrayBuffer.byteLength).toBe(bytes.byteLength)
      expect(Array.from(new Uint8Array(arrayBuffer))).toEqual(Array.from(bytes))
    })

    it("#when exists is called then it reflects file presence", async () => {
      const existingPath = nodeFallbackPath("existing.txt")
      const missingPath = nodeFallbackPath("missing.txt")

      await writeFile(existingPath, "present")

      expect(await NODE_FALLBACK.bunFile(existingPath).exists()).toBe(true)
      expect(await NODE_FALLBACK.bunFile(missingPath).exists()).toBe(false)
    })

    it("#when delete is called then it removes the file", async () => {
      const filePath = nodeFallbackPath("delete-me.txt")

      await writeFile(filePath, "remove")
      await NODE_FALLBACK.bunFile(filePath).delete()

      expect(await NODE_FALLBACK.bunFile(filePath).exists()).toBe(false)
    })

    it("#when writing string data then it writes contents and returns byte count", async () => {
      const filePath = nodeFallbackPath("write-string.txt")
      const content = "write me from Node fallback"
      const bytesWritten = await NODE_FALLBACK.bunWrite(filePath, content)

      expect(bytesWritten).toBe(new TextEncoder().encode(content).byteLength)
      expect(await readFile(filePath, "utf8")).toBe(content)
    })

    it("#when writing array buffer data then it writes exact bytes", async () => {
      const filePath = nodeFallbackPath("write-array-buffer.bin")
      const arrayBuffer = arrayBufferFromBytes([65, 66, 67, 68, 69])
      const bytesWritten = await NODE_FALLBACK.bunWrite(filePath, arrayBuffer)
      const written = await readFile(filePath)

      expect(bytesWritten).toBe(arrayBuffer.byteLength)
      expect(Array.from(written)).toEqual([65, 66, 67, 68, 69])
    })

    it("#when writing then reading text then it round trips content", async () => {
      const filePath = nodeFallbackPath("round-trip.txt")
      const content = "round trip through Node fallback"

      await NODE_FALLBACK.bunWrite(filePath, content)

      expect(await NODE_FALLBACK.bunFile(filePath).text()).toBe(content)
    })

    it("#when writing unicode text then it round trips content", async () => {
      const filePath = nodeFallbackPath("unicode-round-trip.txt")
      const content = "Hello 世界 🌍 from Node fallback"

      await NODE_FALLBACK.bunWrite(filePath, content)

      expect(await NODE_FALLBACK.bunFile(filePath).text()).toBe(content)
    })
  })
})
