import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const HANDOFF = resolve(import.meta.dir, "../provisioned-handoff.ts")

// #13622: a coordinated engine start reports its startup milestones on fd 16. The trust exec reaches the
// runtime through this handoff, and process.execve drops inherited descriptors on Bun, so a start that
// re-execs must reach the runtime as a child that still holds fd 16 or its launcher times out.
describe.skipIf(process.platform === "win32")("provisioned runtime handoff of a coordinated start", () => {
  test("#given the startup hand-off and a pipe at fd 16 #when the launch re-execs #then the runtime still writes its milestone to that pipe", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-handoff-startup-"))
    try {
      const runtime = join(root, "omo")
      writeFileSync(runtime, `#!/bin/bash\nprintf 'startup:ok\\n' >&16\n`, { mode: 0o755 })
      const probe = join(root, "probe.ts")
      writeFileSync(
        probe,
        `import { reexecProvisionedRuntime } from ${JSON.stringify(HANDOFF)}\nawait reexecProvisionedRuntime(${JSON.stringify(runtime)}, { argv: [] })\n`,
      )
      const stdio: ("ignore" | "pipe")[] = ["ignore", "ignore", "pipe"]
      for (let slot = 3; slot < 16; slot += 1) stdio.push("ignore")
      stdio.push("pipe")
      const env: Record<string, string | undefined> = {
        ...process.env,
        SENPI_RPC_HOST_STARTUP_EVENTS: '{"role":"supervisor"}',
      }
      delete env.SENPI_PRIVATE_FDS
      const child = spawn(process.execPath, [probe], { env, stdio })
      const slots: readonly unknown[] = child.stdio
      const startup = slots[16]
      if (!(startup instanceof Socket)) throw new Error("no startup pipe at fd 16")
      let stderr = ""
      let received = ""
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      startup.on("data", (chunk: Buffer) => {
        received += chunk.toString()
      })
      const ended = once(startup, "end", { signal: AbortSignal.timeout(20_000) })
      const [code] = await once(child, "exit", { signal: AbortSignal.timeout(20_000) })
      await ended
      expect(code, stderr).toBe(0)
      expect(received).toBe("startup:ok\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
