import { describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const HANDOFF = resolve(import.meta.dir, "../provisioned-handoff.ts")

// #13622: a coordinated engine start reports its startup milestones on fd 16. The trust exec reaches the
// runtime through this handoff, and process.execve drops inherited descriptors on Bun, so a start that
// re-execs must reach the runtime as a child that still holds fd 16 or its launcher times out.
type Launch = { child: ChildProcess; read: (slot: number) => () => string; stderr: () => string }

function launch(root: string, runtimeScript: string, privateFds: string | undefined, pipes: readonly number[]): Launch {
  const runtime = join(root, "omo")
  writeFileSync(runtime, runtimeScript, { mode: 0o755 })
  const probe = join(root, "probe.ts")
  writeFileSync(
    probe,
    `import { reexecProvisionedRuntime } from ${JSON.stringify(HANDOFF)}\nawait reexecProvisionedRuntime(${JSON.stringify(runtime)}, { argv: [] })\n`,
  )
  const stdio: ("ignore" | "pipe")[] = ["ignore", "ignore", "pipe"]
  for (let slot = 3; slot <= 16; slot += 1) stdio.push(pipes.includes(slot) ? "pipe" : "ignore")
  const env: Record<string, string | undefined> = {
    ...process.env,
    SENPI_RPC_HOST_STARTUP_EVENTS: '{"role":"supervisor"}',
  }
  if (privateFds === undefined) delete env.SENPI_PRIVATE_FDS
  else env.SENPI_PRIVATE_FDS = privateFds
  const child = spawn(process.execPath, [probe], { env, stdio })
  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const read = (slot: number) => {
    const stream: unknown = (child.stdio as readonly unknown[])[slot]
    if (!(stream instanceof Socket)) throw new Error(`no pipe at fd ${slot}`)
    let received = ""
    stream.on("data", (chunk: Buffer) => {
      received += chunk.toString()
    })
    return () => received
  }
  return { child, read, stderr: () => stderr }
}

describe.skipIf(process.platform === "win32")("provisioned runtime handoff of a coordinated start", () => {
  test("#given the startup hand-off and a pipe at fd 16 #when the launch re-execs #then the runtime still writes its milestone to that pipe", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-handoff-startup-"))
    try {
      const run = launch(root, `#!/bin/bash\nprintf 'startup:ok\\n' >&16\n`, undefined, [16])
      const startup = run.read(16)
      const [code] = await once(run.child, "close", { signal: AbortSignal.timeout(20_000) })
      expect(code, run.stderr()).toBe(0)
      expect(startup()).toBe("startup:ok\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test("#given private descriptors and the startup pipe #when the launch re-execs #then the runtime holds both", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-handoff-startup-private-"))
    try {
      const script = `#!/bin/bash\nprintf 'engine:ok' >&5\nprintf 'startup:ok\\n' >&16\n`
      const run = launch(root, script, '{"memory-sync":5}', [5, 16])
      const [channel, startup] = [run.read(5), run.read(16)]
      const [code] = await once(run.child, "close", { signal: AbortSignal.timeout(20_000) })
      expect(code, run.stderr()).toBe(0)
      expect(channel()).toBe("engine:ok")
      expect(startup()).toBe("startup:ok\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test.each(["USR1", "USR2"] as const)(
    "#given a re-exec'd runtime waited on by the launcher #when the launcher gets SIG%s #then the runtime receives it and the launcher lives",
    async (name) => {
      const root = mkdtempSync(join(tmpdir(), `omo-handoff-startup-${name.toLowerCase()}-`))
      try {
        const script = `#!/bin/bash\nsleep 30 &\nsleeper=$!\ntrap 'kill $sleeper; printf "${name}\\n" >&16; exit 0' ${name}\nprintf 'ready\\n' >&16\nwait $sleeper\n`
        const run = launch(root, script, undefined, [16])
        const startup = run.read(16)
        const stream: unknown = (run.child.stdio as readonly unknown[])[16]
        if (!(stream instanceof Socket)) throw new Error("no startup pipe")
        const exited = once(run.child, "exit", { signal: AbortSignal.timeout(20_000) })
        const closed = once(run.child, "close", { signal: AbortSignal.timeout(20_000) })
        while (!startup().includes("ready")) await once(stream, "data", { signal: AbortSignal.timeout(20_000) })
        run.child.kill(`SIG${name}`)
        const [code, signal] = await exited
        expect({ code, signal }, run.stderr()).toEqual({ code: 0, signal: null })
        await closed
        expect(startup()).toBe(`ready\n${name}\n`)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
