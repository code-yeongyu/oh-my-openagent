import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { probeSocket } from "./busy-host"

const dirs: string[] = []
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const socketPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "probe-"))
  dirs.push(dir)
  return join(dir, "h.sock")
}

// A listener in a child process killed with SIGKILL: a host that died and left its socket entry behind.
async function leftoverSocket(path: string): Promise<void> {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `require("node:net").createServer(() => {}).listen({ path: ${JSON.stringify(path)}, backlog: 1 }, () => console.log("ready"))`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  )
  cleanups.push(() => child.kill("SIGKILL"))
  const reader = child.stdout.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ready = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("waited 10s for the listener")), 10_000)
    }),
  ]).finally(() => clearTimeout(timer))
  expect(new TextDecoder().decode(ready.value)).toContain("ready")
  child.kill("SIGKILL")
  await child.exited
}

describe.skipIf(process.platform === "win32")("probeSocket", () => {
  test("a live listener accepts", async () => {
    // given a listening socket
    const path = socketPath()
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(path, resolve))
    cleanups.push(() => server.close())
    // when probed, then it accepts
    expect(await probeSocket(path)).toEqual({ kind: "accepts" })
  })

  test("a socket file whose host died is refused, and a missing path is refused", async () => {
    // given a socket entry left behind by a killed host, and a path with no entry
    const path = socketPath()
    await leftoverSocket(path)
    expect(existsSync(path)).toBe(true)
    // when probed, then both read as nobody listening
    expect(await probeSocket(path)).toEqual({ kind: "refused" })
    expect(await probeSocket(`${path}.missing`)).toEqual({ kind: "refused" })
  })

  test.skipIf(process.getuid?.() === 0)("a socket this user may not open is unknown, with the reason", async () => {
    // given a live listener whose socket file has no permissions
    const path = socketPath()
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(path, resolve))
    cleanups.push(() => server.close())
    const { chmod } = await import("node:fs/promises")
    await chmod(path, 0o000)
    // when probed, then it is neither accepts nor refused
    const probe = await probeSocket(path)
    expect(probe.kind).toBe("unknown")
  })
})
