import { firstOmoBinOnPath, nativeOmoBin, scanOmoBins } from "./legacy-omo-bin"
import type { OmoBinEntry, OmoBinEnvironment } from "./legacy-omo-bin"
import { describePackage } from "./repair-legacy-omo-bin"

export interface OmoVersionProbeResult {
  readonly exitCode: number
  readonly stdout: string
}

export type OmoVersionProbe = (command: string, args: readonly string[]) => Promise<OmoVersionProbeResult>

export type OmoCommandVerification =
  | {
      readonly ok: true
      /** The omo-ai `omo` that was verified. */
      readonly binPath: string
      readonly notes: readonly string[]
      readonly warnings: readonly string[]
    }
  | { readonly ok: false; readonly notes: readonly string[]; readonly warnings: readonly string[] }

export function pathOrderFix(directory: string, isWindows: boolean): string {
  return isWindows ? `set PATH=${directory};%PATH%` : `export PATH="${directory}:$PATH"`
}

export async function verifyOmoCommand(options: {
  readonly environment: OmoBinEnvironment
  readonly probeVersion: OmoVersionProbe
}): Promise<OmoCommandVerification> {
  const entries = scanOmoBins(options.environment)
  const native = nativeOmoBin(entries)
  const resolved = firstOmoBinOnPath(entries)

  if (native === null) {
    return {
      ok: false,
      notes: [],
      warnings: ["Could not find an omo command owned by omo-ai after the install. Run omo --version yourself to check."],
    }
  }

  if (!native.onPath) {
    return {
      ok: false,
      notes: [],
      warnings: [
        `omo-ai installed ${native.binPath}, but ${native.directory} is not on PATH. Add it: ${pathOrderFix(native.directory, options.environment.isWindows)}`,
      ],
    }
  }

  if (resolved !== null && resolved.binPath !== native.binPath) {
    return { ok: false, notes: [], warnings: [shadowWarning(resolved, native, options.environment.isWindows)] }
  }

  const probe = await options.probeVersion(native.binPath, ["--version"])
  const printed = probe.stdout.trim().split("\n")[0] ?? ""
  if (probe.exitCode !== 0 || !printed.startsWith("omo ")) {
    return {
      ok: false,
      notes: [],
      warnings: [`omo --version did not report omo-ai (exit ${probe.exitCode}): ${printed || "no output"}`],
    }
  }

  return { ok: true, binPath: native.binPath, notes: [`omo --version reports ${printed}`], warnings: [] }
}

function shadowWarning(resolved: OmoBinEntry, native: OmoBinEntry, isWindows: boolean): string {
  return `omo on PATH still resolves to ${resolved.binPath} (${describePackage(resolved)}), not to the omo-ai command at ${native.binPath}. Put omo-ai first: ${pathOrderFix(native.directory, isWindows)}`
}
