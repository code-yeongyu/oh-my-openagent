import { describe, expect, test } from "bun:test"
import { readProcessCpuSeconds } from "./native-process"

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
