import { describe, expect, test } from "bun:test"

import { readHostMemoryHeadroom, WAKE_MEMORY_FLOOR_BYTES } from "./memory-headroom"

const GIB = 1024 ** 3
const MIB = 1024 ** 2

/** A fake file system: a path maps to its content, any other path is unreadable. */
function files(entries: Record<string, string>): (path: string) => string {
  return (path) => {
    const content = entries[path]
    if (content === undefined) throw new Error(`ENOENT: ${path}`)
    return content
  }
}

const MEMINFO = (availableKb: number): string =>
  `MemTotal:       65536000 kB\nMemFree:         1000000 kB\nMemAvailable:   ${availableKb} kB\n`

describe("host memory headroom for a wake", () => {
  test("#given the floor #then it is 1 GiB", () => {
    expect(WAKE_MEMORY_FLOOR_BYTES).toBe(GIB)
  })

  test("#given a cgroup v2 limit and the host's MemAvailable #when read on linux #then the headroom is the smaller of the cgroup's room and MemAvailable", () => {
    const read = files({
      "/proc/self/cgroup": "0::/user.slice/omo.scope\n",
      "/sys/fs/cgroup/user.slice/omo.scope/memory.max": `${4 * GIB}\n`,
      "/sys/fs/cgroup/user.slice/omo.scope/memory.current": `${3 * GIB + 512 * MIB}\n`,
      "/proc/meminfo": MEMINFO(8 * 1024 * 1024),
    })
    expect(readHostMemoryHeadroom({ platform: "linux", readFile: read })).toBe(512 * MIB)
  })

  test("#given a cgroup whose memory.max is max #when read on linux #then MemAvailable alone is the headroom", () => {
    const read = files({
      "/proc/self/cgroup": "0::/\n",
      "/sys/fs/cgroup/memory.max": "max\n",
      "/sys/fs/cgroup/memory.current": `${GIB}\n`,
      "/proc/meminfo": MEMINFO(2 * 1024 * 1024),
    })
    expect(readHostMemoryHeadroom({ platform: "linux", readFile: read })).toBe(2 * GIB)
  })

  test("#given no cgroup v2 entry but a readable meminfo #when read on linux #then MemAvailable is the headroom", () => {
    const read = files({ "/proc/self/cgroup": "12:memory:/x\n", "/proc/meminfo": MEMINFO(1024) })
    expect(readHostMemoryHeadroom({ platform: "linux", readFile: read })).toBe(MIB)
  })

  test.each([
    ["nothing readable on linux", "linux", {}],
    ["macOS", "darwin", { "/proc/meminfo": MEMINFO(1) }],
    ["Windows", "win32", { "/proc/meminfo": MEMINFO(1) }],
  ] as const)("#given %s #then there is no headroom reading, so nothing is refused", (_label, platform, entries) => {
    expect(readHostMemoryHeadroom({ platform, readFile: files(entries) })).toBeUndefined()
  })
})
