import { execSync } from "child_process"
import { getOpenCodeVersion } from "./opencode-version"

/**
 * Host detection for the OpenCode family.
 *
 * v1 stable ships as `opencode` with plain semver versions (1.x.y).
 * v2 beta ships as a separate binary `opencode2` with timestamped
 * prerelease versions such as `0.0.0-beta-17759`.
 */
export type OmoHostKind = "opencode-v1" | "opencode-v2"

export interface OmoHostInfo {
  kind: OmoHostKind
  version: string
}

export interface OmoHostDetection {
  hosts: OmoHostInfo[]
  primary: OmoHostInfo | null
  hasV1: boolean
  hasV2: boolean
}

export type OmoHostDeps = {
  getV1Version: () => string | null
  getV2VersionOutput: () => string | null
}

const V2_VERSION_PATTERN = /(\d+\.\d+\.\d+-(?:beta|dev)-\d+)/

const defaultDeps: OmoHostDeps = {
  getV1Version: () => getOpenCodeVersion(),
  getV2VersionOutput: () => {
    try {
      return execSync("opencode2 --version", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      return null
    }
  },
}

/**
 * Extract a v2 beta/dev version from raw `opencode2 --version` output.
 * Returns null for stable semver, empty strings, and garbage.
 */
export function parseV2VersionOutput(output: string): string | null {
  const match = output.match(V2_VERSION_PATTERN)
  return match?.[1] ?? null
}

/**
 * True for v2-line prerelease builds (`0.0.0-beta-N`, `0.0.0-dev-N`),
 * false for stable semver.
 */
export function isBetaVersion(version: string): boolean {
  return V2_VERSION_PATTERN.test(version)
}

/**
 * Detect every OpenCode host binary available on this machine.
 * When both are installed, v1 stable is the primary target so existing
 * behavior keeps precedence.
 */
export function detectOmoHosts(deps: Partial<OmoHostDeps> = {}): OmoHostDetection {
  const resolvedDeps: OmoHostDeps = { ...defaultDeps, ...deps }

  const hosts: OmoHostInfo[] = []

  const v1Version = resolvedDeps.getV1Version()
  if (v1Version && !isBetaVersion(v1Version)) {
    hosts.push({ kind: "opencode-v1", version: v1Version })
  }

  const v2Output = resolvedDeps.getV2VersionOutput()
  const v2Version = v2Output ? parseV2VersionOutput(v2Output) : null
  if (v2Version) {
    hosts.push({ kind: "opencode-v2", version: v2Version })
  }

  const primary = hosts.find((host) => host.kind === "opencode-v1") ?? hosts[0] ?? null

  return {
    hosts,
    primary,
    hasV1: hosts.some((host) => host.kind === "opencode-v1"),
    hasV2: hosts.some((host) => host.kind === "opencode-v2"),
  }
}
