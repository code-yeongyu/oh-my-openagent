import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readProcessCpuSeconds, readProcessTreeCpuSeconds } from "./native-process"

// The startup bounds (stall window, CPU cap) read a child's CPU seconds through this reader. A wrong unit silently moves
// every bound: on Apple Silicon proc_taskinfo counts Mach ticks of 125/3 ns, so reading them as nanoseconds made the
// 120 s cap ~83 min of real CPU (#14808 review M1). The reader must agree with the runtime's own CPU clock.
describe("readProcessCpuSeconds", () => {
  test("#given this process burned at least half a CPU second #when its CPU is read #then it matches the runtime's own CPU clock", () => {
    // given: spin until the runtime itself has counted 0.5 s of CPU, so the amount does not depend on host load
    const startMicros = process.cpuUsage()
    const elapsedCpuSeconds = () => {
      const usage = process.cpuUsage(startMicros)
      return (usage.user + usage.system) / 1e6
    }
    const before = readProcessCpuSeconds(process.pid)
    while (elapsedCpuSeconds() < 0.5) {}
    const runtimeSeconds = elapsedCpuSeconds()

    // when
    const after = readProcessCpuSeconds(process.pid)

    // then
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    const readerSeconds = (after ?? 0) - (before ?? 0)
    expect(readerSeconds).toBeGreaterThan(runtimeSeconds * 0.8)
    expect(readerSeconds).toBeLessThan(runtimeSeconds * 1.25)
  })

  test("#given a pid that is not a positive integer #then nothing is read", () => {
    expect(readProcessCpuSeconds(0)).toBeNull()
    expect(readProcessCpuSeconds(-1)).toBeNull()
    expect(readProcessCpuSeconds(1.5)).toBeNull()
  })
})

// A launcher that starts the engine as its own child (an npm shim, a wrapper script) idles while the engine boots. The
// startup bounds read the whole tree, so the engine's CPU must show up under the launcher's pid (#14820).
const GRANDCHILD =
  'const s = process.cpuUsage(); const burned = () => { const u = process.cpuUsage(s); return (u.user + u.system) / 1e6 }; while (burned() < 0.6) {} console.log("burned"); setInterval(() => {}, 1000)'
const WRAPPER = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(GRANDCHILD)}], { stdio: "inherit" }); setInterval(() => {}, 1000)`

describe("readProcessTreeCpuSeconds", () => {
  test("#given a launcher that idles while its child burns CPU #when the launcher's tree is read #then the child's CPU counts", async () => {
    // given: wait for the grandchild to report its own 0.6 CPU s, so no wall clock decides the amount
    const wrapper = spawn(process.execPath, ["-e", WRAPPER], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "inherit"],
    })
    const pid = wrapper.pid ?? 0
    try {
      let output = ""
      while (!output.includes("burned")) {
        const [chunk] = (await once(wrapper.stdout, "data")) as [Buffer]
        output += chunk.toString()
      }

      // when
      const launcherOnly = readProcessCpuSeconds(pid)
      const tree = readProcessTreeCpuSeconds(pid)

      // then
      expect(launcherOnly).not.toBeNull()
      expect(launcherOnly ?? 0).toBeLessThan(0.45)
      expect(tree ?? 0).toBeGreaterThan((launcherOnly ?? 0) + 0.45)
    } finally {
      const exited = once(wrapper, "exit")
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"])
      else process.kill(-pid, "SIGKILL")
      await exited
    }
  })
})
