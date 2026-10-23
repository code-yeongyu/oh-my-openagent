// omo#10571: on Node < 24.22 / 26.10, kill() on a child whose spawn failed signals the caller's own process group.
// The spy is mocked, so a regression shows up as a recorded call instead of killing the test runner.
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { ChildProcess, spawn } from "node:child_process"
import { once } from "node:events"
import { signalSpawnedChild } from "./child-signal"

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

describe("signalSpawnedChild", () => {
  it("sends nothing to a child whose spawn failed", async () => {
    const kill = spyOn(ChildProcess.prototype, "kill").mockImplementation(() => false)
    restores.push(() => kill.mockRestore())
    const child = spawn("/nonexistent/omo-10571", [])
    const failed = once(child, "error")
    expect(child.pid).toBeUndefined()

    expect(signalSpawnedChild(child, "SIGKILL")).toBe(false)
    await failed
    expect(signalSpawnedChild(child, "SIGKILL")).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  it("signals a child that started", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"])
    const exited = once(child, "exit")

    expect(signalSpawnedChild(child, "SIGKILL")).toBe(true)
    const [, signal] = await exited
    expect(signal).toBe("SIGKILL")
  })
})
