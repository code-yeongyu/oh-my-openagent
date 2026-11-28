export type AtomicVersion = {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly text: string
}

export type AtomicCompatibility = "supported" | "degraded" | "unsupported"

const VERSION_OUTPUT = /^atomic (\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\r?\n?$/

export function parseAtomicVersion(stdout: string): AtomicVersion | undefined {
  const match = VERSION_OUTPUT.exec(stdout)
  if (match === null) return undefined
  const [, major, minor, patch] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    text: stdout.trim().slice("atomic ".length),
  }
}

/**
 * 0.22.1 and later 0.22.x releases are supported. Older releases are refused outright. Newer families are
 * degraded: reads run only while their output still validates, and mutations are refused.
 */
export function classifyAtomicVersion(version: AtomicVersion): AtomicCompatibility {
  if (version.major === 0 && version.minor === 22) return version.patch >= 1 ? "supported" : "unsupported"
  if (version.major === 0 && version.minor < 22) return "unsupported"
  return "degraded"
}
