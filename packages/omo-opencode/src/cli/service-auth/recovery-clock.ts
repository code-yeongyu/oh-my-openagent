import { readFile } from "node:fs/promises"

export interface RecoveryClockReading {
  readonly wallTimeMs: number
  readonly continuousTimeMs: number
  readonly bootId: string
}

export type RecoveryClock = () => Promise<RecoveryClockReading | null>

// performance.now/hrtime stop during suspend on some platforms. Recovery must use the OS's
// continuous clock and a boot identity, not a process epoch or a wall-time-derived boot date.
export const readRecoveryClock: RecoveryClock = async () => {
  try {
    switch (process.platform) {
      case "linux": {
        const [boot, uptime] = await Promise.all([
          readFile("/proc/sys/kernel/random/boot_id", "utf8"),
          readFile("/proc/uptime", "utf8"),
        ])
        const continuousTimeMs = Number(uptime.trim().split(/\s+/)[0]) * 1000
        const bootId = boot.trim()
        if (!/^[a-f0-9-]{36}$/i.test(bootId) || !Number.isFinite(continuousTimeMs) || continuousTimeMs < 0) return null
        return { wallTimeMs: Date.now(), continuousTimeMs, bootId }
      }
      case "darwin": {
        const { dlopen } = await import("bun:ffi")
        const library = dlopen("/usr/lib/libSystem.B.dylib", {
          mach_continuous_time: { args: [], returns: "u64" },
          mach_timebase_info: { args: ["buffer"], returns: "int" },
          sysctlbyname: { args: ["buffer", "buffer", "buffer", "ptr", "u64"], returns: "int" },
        })
        try {
          const timebase = new Uint32Array(2)
          const boot = new Uint8Array(128)
          const size = new BigUint64Array([BigInt(boot.byteLength)])
          if (library.symbols.mach_timebase_info(timebase) !== 0 ||
              library.symbols.sysctlbyname(Buffer.from("kern.bootsessionuuid\0"), boot, size, null, 0) !== 0) return null
          const numerator = timebase[0]
          const denominator = timebase[1]
          if (numerator === undefined || denominator === undefined || numerator === 0 || denominator === 0) return null
          const bootId = Buffer.from(boot).toString("utf8").split("\0")[0] ?? ""
          if (!/^[a-f0-9-]{36}$/i.test(bootId)) return null
          const continuousTimeMs = Number(library.symbols.mach_continuous_time()) * numerator / denominator / 1_000_000
          return { wallTimeMs: Date.now(), continuousTimeMs, bootId }
        } finally {
          library.close()
        }
      }
      case "win32": {
        const { dlopen } = await import("bun:ffi")
        const kernel = dlopen("kernel32.dll", { GetTickCount64: { args: [], returns: "u64" } })
        try {
          const ntdll = dlopen("ntdll.dll", {
            NtQuerySystemInformation: { args: ["u32", "buffer", "u32", "buffer"], returns: "i32" },
          })
          try {
            // SystemBootEnvironmentInformation starts with the 16-byte BootIdentifier GUID.
            const boot = new Uint8Array(32)
            const returned = new Uint32Array(1)
            if (ntdll.symbols.NtQuerySystemInformation(90, boot, boot.byteLength, returned) !== 0 ||
                (returned[0] ?? 0) < 16 || boot.subarray(0, 16).every(byte => byte === 0)) return null
            return {
              wallTimeMs: Date.now(),
              continuousTimeMs: Number(kernel.symbols.GetTickCount64()),
              bootId: Buffer.from(boot.subarray(0, 16)).toString("hex"),
            }
          } finally {
            ntdll.close()
          }
        } finally {
          kernel.close()
        }
      }
      default:
        return null
    }
  } catch {
    // An unavailable native clock is an explicit loss of proof, never a wall-clock fallback.
    return null
  }
}
