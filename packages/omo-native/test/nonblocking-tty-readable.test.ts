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
    // given
    const { reader, writer } = fifoPair()
    const stream = nonBlockingTtyReadable(reader, 60_000)
    stream.resume()
    const closed = new Promise<void>((resolve) => stream.once("close", () => resolve()))

    // when
    stream.destroy()

    // then
    await closed
    expect(stream.destroyed).toBe(true)
    closeSync(writer)
    closeSync(reader)
  },
)

test.skipIf(process.platform === "win32")(
  "#given a descriptor whose read fails with something other than EAGAIN #when the reader reads #then it is destroyed with that error",
  async () => {
    // given
    const { reader, writer } = fifoPair()
    closeSync(writer)
    closeSync(reader)
    const stream = nonBlockingTtyReadable(reader, 1)
    const failed = new Promise<unknown>((resolve) => stream.once("error", resolve))

    // when
    stream.resume()

    // then
    expect(await failed).toMatchObject({ code: "EBADF" })
  },
)
