import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const HANDOFF = resolve(import.meta.dir, "../provisioned-handoff.ts")

// senpi#4749: the desktop launches the provisioned runtime, and process.execve drops inherited
// descriptors on Bun, so a launch carrying private descriptors must reach the runtime as a child.
describe.skipIf(process.platform === "win32")("provisioned runtime handoff with private descriptors", () => {
  test("keeps the descriptor readable and its table in the provisioned runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-handoff-fd-"))
    try {
      // given: a provisioned runtime stand-in that records the table and answers on fd 5
      const runtime = join(root, "omo")
      writeFileSync(runtime, `#!/bin/sh\nprintf '%s' "$SENPI_PRIVATE_FDS" > "$CAPTURE_FILE"\nprintf 'engine:ok' >&5\n`, { mode: 0o755 })
      const probe = join(root, "probe.ts")
      writeFileSync(probe, `import { reexecProvisionedRuntime } from ${JSON.stringify(HANDOFF)}\nawait reexecProvisionedRuntime(${JSON.stringify(runtime)}, { argv: [] })\n`)
      const child = spawn(process.execPath, [probe], {
        env: { ...process.env, CAPTURE_FILE: join(root, "capture"), SENPI_PRIVATE_FDS: '{"memory-sync":5}' },
        stdio: ["ignore", "ignore", "pipe", "ignore", "ignore", "pipe"],
      })
      const stdio: readonly unknown[] = child.stdio
      const channel = stdio[5]
      if (!(channel instanceof Socket)) throw new Error("no private channel")
      let stderr = ""
      let received = ""
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
      channel.on("data", (chunk: Buffer) => { received += chunk.toString() })
      const ended = once(channel, "end", { signal: AbortSignal.timeout(20_000) })
      // when: the launch hands off to the provisioned runtime
      const [code] = await once(child, "exit", { signal: AbortSignal.timeout(20_000) })
      await ended
      // then: the runtime received both the table and a working descriptor
      expect(code, stderr).toBe(0)
      expect(readFileSync(join(root, "capture"), "utf8")).toBe('{"memory-sync":5}')
      expect(received).toBe("engine:ok")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test("closes a named socket it cannot forward, so its peer sees EOF while the runtime still runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-handoff-discard-"))
    try {
      // given: a runtime that stays up until fd 5's peer goes away, and a named socket at 24 (above 5..15)
      const runtime = join(root, "omo")
      writeFileSync(runtime, `#!/bin/sh\ncat <&5 >/dev/null\n`, { mode: 0o755 })
      const probe = join(root, "probe.ts")
      writeFileSync(probe, `import { reexecProvisionedRuntime } from ${JSON.stringify(HANDOFF)}\nawait reexecProvisionedRuntime(${JSON.stringify(runtime)}, { argv: [] })\n`)
      const stdio: ("ignore" | "pipe")[] = ["ignore", "ignore", "pipe"]
      for (let fd = 3; fd <= 24; fd++) stdio.push(fd === 5 || fd === 24 ? "pipe" : "ignore")
      const child = spawn(process.execPath, [probe], {
        env: { ...process.env, SENPI_PRIVATE_FDS: '{"memory-sync":5,"high":24}' },
        stdio,
      })
      const slots: readonly unknown[] = child.stdio
      const [channel, high] = [slots[5], slots[24]]
      if (!(channel instanceof Socket) || !(high instanceof Socket)) throw new Error("no private sockets")
      high.resume()
      const exited = once(child, "exit", { signal: AbortSignal.timeout(20_000) })
      // when: the handoff is running
      await once(high, "end", { signal: AbortSignal.timeout(20_000) })
      // then: fd 24 reached EOF while the parent still waits on the runtime; ending fd 5 lets it finish
      expect(child.exitCode).toBeNull()
      channel.end()
      const [code] = await exited
      expect(code).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
