import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { spawn } from "node:child_process"
import { PassThrough } from "node:stream"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createSandbox, driveRpc } from "./omo-native-telemetry-drive.mjs"

class RpcProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode = null
  commands = []
  constructor() {
    super()
    this.stdin.on("data", (chunk) => { this.commands.push(JSON.parse(chunk.toString())) })
  }
  send(event) { this.stdout.write(`${JSON.stringify(event)}\n`) }
  close(code = 0) { this.exitCode = code; this.emit("close", code, null) }
  kill() { this.close(1) }
}

describe("telemetry RPC prompt sequencing", () => {
  test("#given a running prompt #when a low-level run ends #then no next prompt is submitted", async () => {
    const child = new RpcProcess()
    const run = driveRpc(child, "test").catch((error) => error)
    child.send({ type: "agent_end", willRetry: false })
    const submitted = child.commands.length
    child.close(1)
    await run
    expect(submitted).toBe(1)
  })

  test("#given three requested turns #when each settles #then exactly three prompts complete successfully", async () => {
    const child = new RpcProcess()
    const run = driveRpc(child, "test")
    for (let index = 0; index < 3; index += 1) child.send({ type: "agent_settled" })
    child.close()
    const result = await run
    expect({ commands: child.commands.length, exit: result.result.code }).toEqual({ commands: 3, exit: 0 })
  })

  test("#given a prompt request #when RPC rejects it #then the drive reports that failure", async () => {
    const child = new RpcProcess()
    const run = driveRpc(child, "test").catch((error) => error)
    child.send({ type: "response", command: "prompt", success: false, error: "fixture-rejection" })
    child.close(1)
    expect((await run).message).toContain("fixture-rejection")
  })

  test("#given a child that ignores SIGTERM #when RPC rejects a prompt #then forced termination preserves the original failure", async () => {
    const child = spawn("node", ["--eval", `
      process.on("SIGTERM", () => process.send("sigterm-observed"));
      process.stdin.on("data", () => process.stdout.write(JSON.stringify({
        type: "response", command: "prompt", success: false, error: "fixture-rejection"
      }) + "\\n"));
    `], { stdio: ["pipe", "pipe", "pipe", "ipc"] })
    const closed = new Promise((resolve) => child.once("close", (_code, signal) => resolve(signal)))
    let sigtermObserved = false
    child.on("message", (message) => { if (message === "sigterm-observed") sigtermObserved = true })
    let watchdogForcedKill = false
    const watchdog = setTimeout(() => { watchdogForcedKill = true; child.kill("SIGKILL") }, 8_000)
    try {
      const failure = await driveRpc(child, "test").catch((error) => error)
      const signal = await closed
      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toContain("fixture-rejection")
      expect(watchdogForcedKill).toBe(false)
      if (process.platform !== "win32") {
        expect(sigtermObserved).toBe(true)
        expect(signal).toBe("SIGKILL")
      }
    } finally {
      clearTimeout(watchdog)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await closed
    }
  }, 15_000)

  test("#given a fresh sandbox #when it is created #then onboarding is already claimed in its isolated agent state", () => {
    const sandbox = createSandbox("test", true)
    try {
      expect(existsSync(join(sandbox.agentDir, "omo-senpi", "omo-native", "onboarding-completed"))).toBe(true)
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true })
    }
  })
})
