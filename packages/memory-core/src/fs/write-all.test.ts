import { afterEach, describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { constants } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { appendFile, writeFile } from "./resilient"
import { isExclusiveFlag, openSyncWithExclusivePolicy, writeHandleAll } from "./write-all"

function eintrError(syscall: string): NodeJS.ErrnoException {
  const error = new Error(`EINTR: interrupted system call, ${syscall}`) as NodeJS.ErrnoException
  error.code = "EINTR"
  return error
}

describe("writeHandleAll", () => {
  test("carries partial progress forward and retries only the interrupted write", async () => {
    const chunks: Buffer[] = []
    let calls = 0
    const fake = {
      write: (buffer: Uint8Array, offset?: number) => {
        calls += 1
        const start = offset ?? 0
        if (calls === 1) {
          chunks.push(Buffer.from(buffer.subarray(start, start + 3)))
          return Promise.resolve({ bytesWritten: 3 })
        }
        if (calls === 2) return Promise.reject(eintrError("write"))
        chunks.push(Buffer.from(buffer.subarray(start)))
        return Promise.resolve({ bytesWritten: buffer.length - start })
      },
    }
    await writeHandleAll(fake, "abcdefgh", "utf8")
    expect(Buffer.concat(chunks).toString("utf8")).toBe("abcdefgh")
    expect(calls).toBe(3)
  })

  test("rejects when a write reports no progress", async () => {
    const fake = { write: () => Promise.resolve({ bytesWritten: 0 }) }
    await expect(writeHandleAll(fake, "abc")).rejects.toThrow("no progress")
  })
})

describe("abort signals", () => {
  test("an already-aborted signal rejects writeFile before any mutation", async () => {
    const file = path.join(await (async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "write-abort-"))
      abortDirectories.push(directory)
      return directory
    })(), "never.txt")
    await expect(writeFile(file, "x", { signal: AbortSignal.abort() })).rejects.toThrow()
    await expect(readFile(file, "utf8")).rejects.toThrow("ENOENT")
  })

  test("an abort between partial writes stops the handle write loop", async () => {
    const controller = new AbortController()
    let calls = 0
    const fake = {
      write: (buffer: Uint8Array, offset?: number) => {
        calls += 1
        controller.abort()
        void buffer
        void offset
        return Promise.resolve({ bytesWritten: 2 })
      },
    }
    await expect(writeHandleAll(fake, "abcdef", "utf8", controller.signal)).rejects.toThrow()
    expect(calls).toBe(1)
  })
})

const abortDirectories: string[] = []
afterEach(async () => {
  for (const directory of abortDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe("handle-target options", () => {
  test("flush: true syncs the target handle after the write completes", async () => {
    let synced = 0
    const written: Buffer[] = []
    const fake = {
      fd: 3,
      write: (buffer: Uint8Array, offset?: number) => {
        written.push(Buffer.from(buffer.subarray(offset ?? 0)))
        return Promise.resolve({ bytesWritten: buffer.length - (offset ?? 0) })
      },
      sync: () => {
        synced += 1
        return Promise.resolve()
      },
    }
    await writeFile(fake as never, "payload", { flush: true })
    expect(Buffer.concat(written).toString("utf8")).toBe("payload")
    expect(synced).toBe(1)
  })
})

describe("openSyncWithExclusivePolicy", () => {
  test("gives exclusive creates exactly one attempt so an ambiguous EINTR propagates", () => {
    let calls = 0
    const rawOpen = (): number => {
      calls += 1
      throw eintrError("open")
    }
    expect(() => openSyncWithExclusivePolicy(rawOpen, "/tmp/x", "wx")).toThrow("EINTR")
    expect(calls).toBe(1)
  })

  test("retries shareable opens on transient EINTR", () => {
    let calls = 0
    const rawOpen = (): number => {
      calls += 1
      if (calls < 3) throw eintrError("open")
      return 7
    }
    expect(openSyncWithExclusivePolicy(rawOpen, "/tmp/x", "r")).toBe(7)
    expect(calls).toBe(3)
  })
})

describe("isExclusiveFlag", () => {
  test("classifies string and numeric open flags", () => {
    expect(isExclusiveFlag("wx")).toBe(true)
    expect(isExclusiveFlag("ax+")).toBe(true)
    expect(isExclusiveFlag("w")).toBe(false)
    expect(isExclusiveFlag("r+")).toBe(false)
    expect(isExclusiveFlag(undefined)).toBe(false)
    expect(isExclusiveFlag(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)).toBe(true)
    expect(isExclusiveFlag(constants.O_CREAT | constants.O_WRONLY)).toBe(false)
  })
})

describe("path write parity (real filesystem)", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  async function createDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "write-all-"))
    temporaryDirectories.push(directory)
    return directory
  }

  test("writeFile overwrites and appendFile appends exactly once", async () => {
    const file = path.join(await createDirectory(), "value.txt")
    await writeFile(file, "one", "utf8")
    await writeFile(file, "two", "utf8")
    await appendFile(file, "-plus", "utf8")
    expect(await readFile(file, "utf8")).toBe("two-plus")
  })

  test("writeFile honors exclusive flags without retry-induced EEXIST confusion", async () => {
    const file = path.join(await createDirectory(), "exclusive.txt")
    await writeFile(file, "first", { flag: "wx" })
    await expect(writeFile(file, "second", { flag: "wx" })).rejects.toThrow("EEXIST")
    expect(await readFile(file, "utf8")).toBe("first")
  })

  test("writeFile accepts Buffer payloads and explicit modes", async () => {
    const file = path.join(await createDirectory(), "binary.bin")
    await writeFile(file, Buffer.from("binary-body"), { mode: 0o600 })
    expect(await readFile(file, "utf8")).toBe("binary-body")
  })
})
