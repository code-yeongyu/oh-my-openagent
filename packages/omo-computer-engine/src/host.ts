import { readFileSync } from "node:fs"

/** The C library a Linux engine links against; every other platform ships one engine per architecture. */
export type EngineLibc = "glibc" | "musl"

/**
 * `<platform>-<arch>`, plus `-musl` on a musl Linux host, whose loader cannot run the glibc engine.
 * The libc defaults to the running process's only when `platform` is the platform it runs on.
 * Exported for `packages/omo-native/engine-trust-helper-path.ts`, which names hosts the same way.
 */
export function engineHost(
  platform: string = process.platform,
  arch: string = process.arch,
  libc: EngineLibc | undefined = platform === "linux" && platform === process.platform ? runningLibc() : undefined,
): string {
  return platform === "linux" && libc === "musl" ? `${platform}-${arch}-musl` : `${platform}-${arch}`
}

let detected: EngineLibc | undefined

function runningLibc(): EngineLibc {
  detected ??= libcFromSignals(process.report?.getReport(), readOwnMaps)
  return detected
}

/**
 * The libc of the running process, never of what is installed. Glibc builds of Bun and Node report
 * `header.glibcVersionRuntime`; musl builds omit it, and absence alone is not proof, so musl also
 * needs its loader mapped into this process. Without either signal the host stays glibc.
 */
export function libcFromSignals(report: unknown, readMaps: () => string | undefined): EngineLibc {
  const header: unknown = typeof report === "object" && report !== null ? Reflect.get(report, "header") : undefined
  const glibc: unknown =
    typeof header === "object" && header !== null ? Reflect.get(header, "glibcVersionRuntime") : undefined
  if (typeof glibc === "string" && glibc.length > 0) return "glibc"
  return /\/ld-musl-[^/\s]+\.so\.1$/m.test(readMaps() ?? "") ? "musl" : "glibc"
}

function readOwnMaps(): string | undefined {
  try {
    return readFileSync("/proc/self/maps", "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error) return undefined
    throw error
  }
}
