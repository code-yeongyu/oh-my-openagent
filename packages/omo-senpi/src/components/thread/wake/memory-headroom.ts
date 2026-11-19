import { readFileSync } from "node:fs"

/**
 * The memory a woken session's open needs left on the host before the carrier starts it. docs/reference/omo-daemon.md
 * measured a session's first turn adding 408.7 MB RSS on its host (544 MB RSS at four children), and no floor is set
 * anywhere in this repository, so the floor is 1 GiB: room for that first turn plus the same again for the host and
 * whatever else runs, without turning a busy but healthy machine away. It is the cap: where this process may use less
 * memory than four times that, the floor is a quarter of it (`readWakeMemoryFloor`), so a small limit still wakes.
 */
export const WAKE_MEMORY_FLOOR_BYTES = 1024 ** 3
/** Under a small limit the floor is this share of it: a cgroup of 768 MiB wakes with 192 MiB of room (#14363 review L1). */
const FLOOR_SHARE_OF_LIMIT = 4

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

/** This process's cgroup v2 memory limit and use; undefined with no limit (`max`) or nothing readable. */
function cgroupMemory(sources: MemoryProbeSources): { readonly limit: number; readonly current: number } | undefined {
  const entry = readable(sources, "/proc/self/cgroup")
    ?.split("\n")
    .find((line) => line.startsWith("0::"))
  if (entry === undefined) return undefined
  const base = `/sys/fs/cgroup${entry.slice("0::".length).trim().replace(/\/$/, "")}`
  const max = readable(sources, `${base}/memory.max`)?.trim()
  const current = Number(readable(sources, `${base}/memory.current`)?.trim())
  if (max === undefined || max === "max" || !Number.isFinite(current)) return undefined
  const limit = Number(max)
  return Number.isFinite(limit) ? { limit, current } : undefined
}

/** The room left under this process's cgroup v2 memory limit. */
function cgroupRoom(sources: MemoryProbeSources): number | undefined {
  const cgroup = cgroupMemory(sources)
  return cgroup === undefined ? undefined : Math.max(0, cgroup.limit - cgroup.current)
}

/** One `/proc/meminfo` field, in bytes. */
function meminfo(sources: MemoryProbeSources, field: "MemAvailable" | "MemTotal"): number | undefined {
  const line = readable(sources, "/proc/meminfo")
    ?.split("\n")
    .find((row) => row.startsWith(`${field}:`))
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
  const readings = [cgroupRoom(sources), meminfo(sources, "MemAvailable")].filter((value) => value !== undefined)
  return readings.length === 0 ? undefined : Math.min(...readings)
}

/**
 * The headroom a wake needs: `WAKE_MEMORY_FLOOR_BYTES`, or a quarter of the memory this process may use (the smaller of
 * its cgroup v2 limit and the host's `MemTotal`) when that is less. With nothing readable it is the 1 GiB cap.
 */
export function readWakeMemoryFloor(
  sources: MemoryProbeSources = { platform: process.platform, readFile: (path) => readFileSync(path, "utf8") },
): number {
  if (sources.platform !== "linux") return WAKE_MEMORY_FLOOR_BYTES
  const sizes = [cgroupMemory(sources)?.limit, meminfo(sources, "MemTotal")].filter((value) => value !== undefined)
  if (sizes.length === 0) return WAKE_MEMORY_FLOOR_BYTES
  return Math.min(WAKE_MEMORY_FLOOR_BYTES, Math.floor(Math.min(...sizes) / FLOOR_SHARE_OF_LIMIT))
}
