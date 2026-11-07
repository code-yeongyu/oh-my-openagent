import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runChild } from "../bin/lib/child-process.js"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === "win32")("runChild terminateWhen", () => {
  test("#given a child that leaves on SIGTERM #when terminateWhen settles #then it is asked to leave and its own exit is the result", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-term-"))
    roots.push(root)
    const childPath = join(root, "child.mjs")
    writeFileSync(
      childPath,
      `import { connect } from "node:net"
process.on("SIGTERM", () => process.exit(0))
connect(process.env.READY_SOCKET).on("error", () => {})
setInterval(() => {}, 1000)
`,
    )
    // The child connects only after installing its SIGTERM handler, so the stop never lands before the handler does.
    const server = createServer()
    const ready = new Promise<void>(resolve => {
      server.once("connection", socket => {
        socket.destroy()
        server.close()
        resolve()
      })
    })
    await new Promise<void>(resolve => server.listen(join(root, "ready.sock"), resolve))

    const result = await runChild(process.execPath, [childPath], {
      env: { ...process.env, READY_SOCKET: join(root, "ready.sock") },
      stdio: "ignore",
      terminateWhen: ready,
    })

    expect(result).toEqual({ status: 0, signal: null })
  }, 15_000)
})
