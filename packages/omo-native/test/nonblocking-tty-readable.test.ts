import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { closeSync, constants, mkdtempSync, openSync, rmSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nonBlockingTtyReadable } from "../nonblocking-tty-readable"

// #14098 (#13337 review L1): the reader is exercised directly, not only through the end-to-end pty runs. A FIFO gives a
// real non-blocking descriptor with no terminal: an open writer with nothing written makes reads answer EAGAIN.
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fifoPair(): { readonly reader: number; readonly writer: number } {
  const dir = mkdtempSync(join(tmpdir(), "omo-nb-reader-"))
  dirs.push(dir)
  const path = join(dir, "fifo")
  expect(spawnSync("mkfifo", [path]).status).toBe(0)
  const reader = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  const writer = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK)
  return { reader, writer }
}

test.skipIf(process.platform === "win32")(
  "#given no input yet #when bytes arrive later #then the reader retries past EAGAIN and delivers them",
  async () => {
    // given
    const { reader, writer } = fifoPair()
    const stream = nonBlockingTtyReadable(reader, 1)
    const received = new Promise<string>((resolve) => stream.once("data", (chunk: Buffer) => resolve(chunk.toString())))

    // when
    writeSync(writer, "abc")

    // then
    expect(await received).toBe("abc")
    stream.destroy()
    closeSync(writer)
    closeSync(reader)
  },
)

test.skipIf(process.platform === "win32")(
  "#given a reader waiting on EAGAIN #when it is destroyed #then it closes and no retry keeps the process alive",
  async () => {
    // given a reader whose first read answered EAGAIN, so its retry timer is armed (#14105 review L1: the destroy must
    // happen in that state, or the test passes without a retry to clear)
    const { reader, writer } = fifoPair()
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    const RETRY_MS = 60_017
    const armed = Promise.withResolvers<ReturnType<typeof setTimeout>>()
    const cleared = new Set<unknown>()
    globalThis.setTimeout = ((run: () => void, ms?: number) => {
      const handle = realSetTimeout(run, ms)
      if (ms === RETRY_MS) armed.resolve(handle)
      return handle
    }) as typeof setTimeout
    globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
      cleared.add(handle)
      realClearTimeout(handle)
    }) as typeof clearTimeout
    try {
      const stream = nonBlockingTtyReadable(reader, RETRY_MS)
      stream.resume()
      const retry = await armed.promise
      const closed = new Promise<void>((resolve) => stream.once("close", () => resolve()))

      // when
      stream.destroy()

      // then the armed retry was cleared, so no timer keeps the process alive
      await closed
      expect(stream.destroyed).toBe(true)
      expect(cleared.has(retry)).toBe(true)
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
      closeSync(writer)
      closeSync(reader)
    }
  },
)

test.skipIf(process.platform === "win32")(
  "#given a descriptor whose read fails with something other than EAGAIN #when the reader reads #then it is destroyed with that error",
  async () => {
    // given
    // A live descriptor that always fails the same way (#14157 item 2): a closed number can be reused by the
    // runtime before the read runs.
    const directoryPath = mkdtempSync(join(tmpdir(), "tty-readable-dir-"))
    const directory = openSync(directoryPath, "r")
    const stream = nonBlockingTtyReadable(directory, 1)
    const failed = new Promise<unknown>((resolve) => stream.once("error", resolve))

    // when
    stream.resume()

    // then
    try {
      expect(await failed).toMatchObject({ code: "EISDIR" })
    } finally {
      closeSync(directory)
      rmSync(directoryPath, { recursive: true, force: true })
    }
  },
)
