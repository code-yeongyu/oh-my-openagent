import { afterEach, describe, expect, test } from "bun:test"
import { constants, mkdirSync, mkdtempSync, openSync, closeSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { open } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { claimedSessionPaths } from "./endpoint-registry"
import { createLiveThreadSurface } from "./live-surface"

// #13581 review L1: a dead endpoint's listing reads its claim files and then its session files ONE AT A TIME, so a host
// that died holding many claims costs time, not file descriptors (#13579, #13584). A FIFO shows it without a seam: its
// reader's open waits for a writer, and a non-blocking writer open fails ENXIO while no reader holds it, so "the next
// file is not open yet" is observable while the first one is still being read.

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fifo(path: string): string {
  expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0)
  return path
}

/** Whether some reader holds `path` open now; never waits. */
function readerHolds(path: string): boolean {
  try {
    closeSync(openSync(path, constants.O_WRONLY | constants.O_NONBLOCK))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENXIO") return false
    throw error
  }
}

/** Circuit breaker only: a reader that never opens the FIFO fails here instead of hanging the run. */
async function within<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`waited 5s for ${label}, it never happened`)), 5_000)
  })
  try {
    return await Promise.race([work, breaker])
  } finally {
    clearTimeout(timer)
  }
}

/** Waits until the reader opens `path`, then hands it `text` and closes, so the reader reaches end of file. */
async function feed(path: string, text: string, label: string): Promise<void> {
  const writer = await within(open(path, "w"), label)
  try {
    await writer.writeFile(text)
  } finally {
    await writer.close()
  }
}

function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "thr-serial-")))
  scratch.push(dir)
  return dir
}

describe.skipIf(process.platform === "win32")("a dead endpoint's files are read one at a time", () => {
  test("#given two claim files #when the claims are read #then the second is opened only after the first was read", async () => {
    // given
    const dir = scratchDir()
    mkdirSync(join(dir, "reservations"))
    const first = fifo(join(dir, "reservations", "a000000000000000.json"))
    const second = fifo(join(dir, "reservations", "b000000000000000.json"))

    // when
    const reading = claimedSessionPaths(dir)
    const firstWriter = await within(open(first, "w"), "the first claim to be opened")
    const secondOpenEarly = readerHolds(second)
    await firstWriter.writeFile(JSON.stringify({ sessionPath: "/s/a.jsonl" }))
    await firstWriter.close()
    await feed(second, JSON.stringify({ sessionPath: "/s/b.jsonl" }), "the second claim to be opened")

    // then
    expect(secondOpenEarly).toBe(false)
    expect(await reading).toEqual(["/s/a.jsonl", "/s/b.jsonl"])
  })

  test("#given a dead endpoint whose claims name two session files #when it is listed #then the second session file is opened only after the first was read", async () => {
    // given
    const dir = scratchDir()
    mkdirSync(join(dir, "reservations"))
    const firstSession = fifo(join(dir, "first.jsonl"))
    const secondSession = fifo(join(dir, "second.jsonl"))
    writeFileSync(join(dir, "reservations", "a000000000000000.json"), JSON.stringify({ sessionPath: firstSession }))
    writeFileSync(join(dir, "reservations", "b000000000000000.json"), JSON.stringify({ sessionPath: secondSession }))
    const surface = createLiveThreadSurface(
      {} as never,
      {
        env: { SENPI_RPC_SOCKET: join(dir, "missing-legacy.sock") },
        exists: () => false,
        registry: async () => [
          { socket: join(dir, "dead.sock"), dir, identity: "endpoint", endpoint_kind: "rpc_host", registry_version: 1 },
        ],
      } as never,
    )

    // when
    const listing = surface.listView({ offline: true })
    const firstWriter = await within(open(firstSession, "w"), "the first session file to be opened")
    const secondOpenEarly = readerHolds(secondSession)
    await firstWriter.close()
    await feed(secondSession, "", "the second session file to be opened")
    await within(listing, "the dead endpoint's listing")

    // then
    expect(secondOpenEarly).toBe(false)
  })
})
