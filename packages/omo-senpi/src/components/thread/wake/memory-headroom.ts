import { readFileSync } from "node:fs"

/**
 * The memory a woken session's open needs left on the host before the carrier starts it. docs/reference/omo-daemon.md
 * measured a session's first turn adding 408.7 MB RSS on its host (544 MB RSS at four children), and no floor is set
 * anywhere in this repository, so the floor is 1 GiB: room for that first turn plus the same again for the host and
 * whatever else runs, without turning a busy but healthy machine away.
 */
export const WAKE_MEMORY_FLOOR_BYTES = 1024 ** 3

export type MemoryProbeSources = {
  readonly platform: NodeJS.Platform
  readonly readFile: (path: string) => string
}

const readable = (sources: MemoryProbeSources, path: string): string | undefined => {
  try {
    return sources.readFile(path)
  } catch {
    return undefined
  }
}

/** The room left under this process's cgroup v2 memory limit; undefined with no limit (`max`) or nothing readable. */
function cgroupRoom(sources: MemoryProbeSources): number | undefined {
  const entry = readable(sources, "/proc/self/cgroup")
    ?.split("\n")
    .find((line) => line.startsWith("0::"))
  if (entry === undefined) return undefined
  const base = `/sys/fs/cgroup${entry.slice("0::".length).trim().replace(/\/$/, "")}`
  const max = readable(sources, `${base}/memory.max`)?.trim()
  const current = Number(readable(sources, `${base}/memory.current`)?.trim())
  if (max === undefined || max === "max" || !Number.isFinite(current)) return undefined
  const limit = Number(max)
  return Number.isFinite(limit) ? Math.max(0, limit - current) : undefined
}

/** The host's `MemAvailable`, in bytes. */
function memAvailable(sources: MemoryProbeSources): number | undefined {
  const line = readable(sources, "/proc/meminfo")
    ?.split("\n")
    .find((row) => row.startsWith("MemAvailable:"))
  const kib = Number(line?.match(/(\d+)\s*kB/)?.[1])
  return line === undefined || !Number.isFinite(kib) ? undefined : kib * 1024
}

/**
 * The host memory headroom a wake may use: the smaller of this process's cgroup v2 room and the host's `MemAvailable`.
 * Undefined means no reading (macOS, Windows, or nothing readable), and the carrier never refuses on a missing reading.
 */
export function readHostMemoryHeadroom(
  sources: MemoryProbeSources = { platform: process.platform, readFile: (path) => readFileSync(path, "utf8") },
): number | undefined {
  if (sources.platform !== "linux") return undefined
  const readings = [cgroupRoom(sources), memAvailable(sources)].filter((value) => value !== undefined)
  return readings.length === 0 ? undefined : Math.min(...readings)
}
