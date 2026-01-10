/**
 * Release channel detection and management
 */

import type { ReleaseChannel } from "./types"
import { parse } from "./semver"

/**
 * Patterns to detect release channel from prerelease string
 * Order matters - more specific patterns first
 */
const CHANNEL_PATTERNS: [RegExp, ReleaseChannel][] = [
  [/^alpha/, "alpha"],
  [/^a\.?\d/, "alpha"],
  [/^beta/, "beta"],
  [/^b\.?\d/, "beta"],
  [/^rc/, "rc"],
  [/^canary/, "canary"],
  [/^dev/, "dev"],
  [/^nightly/, "dev"],
  [/^next/, "beta"], // treat "next" as beta equivalent
  [/^preview/, "beta"],
  [/^snapshot/, "dev"],
]

/**
 * Detect the release channel from a version string
 */
export function detectChannel(version: string): ReleaseChannel {
  const parsed = parse(version)
  if (!parsed || parsed.prerelease.length === 0) return "stable"

  const prereleaseStr = parsed.prerelease.join(".").toLowerCase()

  for (const [pattern, channel] of CHANNEL_PATTERNS) {
    if (pattern.test(prereleaseStr)) return channel
  }

  // Unknown prerelease type defaults to beta (safer than assuming dev)
  return "beta"
}

/**
 * Get the stability priority of a channel (higher = more stable)
 */
export function getChannelPriority(channel: ReleaseChannel): number {
  const priorities: Record<ReleaseChannel, number> = {
    stable: 100,
    rc: 80,
    beta: 60,
    alpha: 40,
    canary: 20,
    dev: 0,
  }
  return priorities[channel]
}

/**
 * Check if a user on currentChannel should be offered updates to targetChannel
 *
 * Rules:
 * - Stable users only see stable updates
 * - Prerelease users can update within their channel or to more stable channels
 * - Users are never auto-downgraded to less stable channels
 */
export function shouldUpdateToChannel(
  currentChannel: ReleaseChannel,
  targetChannel: ReleaseChannel
): boolean {
  // Stable users should NOT be pushed to prerelease
  if (currentChannel === "stable") {
    return targetChannel === "stable"
  }

  // Prerelease users can move to same or more stable channel
  return getChannelPriority(targetChannel) >= getChannelPriority(currentChannel)
}

/**
 * Map npm dist-tag name to release channel
 */
export function mapDistTagToChannel(tag: string): ReleaseChannel {
  const mapping: Record<string, ReleaseChannel> = {
    latest: "stable",
    beta: "beta",
    alpha: "alpha",
    rc: "rc",
    canary: "canary",
    next: "beta",
    dev: "dev",
    nightly: "dev",
  }
  return mapping[tag.toLowerCase()] ?? "beta"
}

/**
 * Map release channel to expected npm dist-tag
 */
export function mapChannelToDistTag(channel: ReleaseChannel): string {
  const mapping: Record<ReleaseChannel, string> = {
    stable: "latest",
    beta: "beta",
    alpha: "alpha",
    rc: "rc",
    canary: "canary",
    dev: "dev",
  }
  return mapping[channel]
}

/**
 * Get a human-readable label for a channel
 */
export function getChannelLabel(channel: ReleaseChannel): string {
  const labels: Record<ReleaseChannel, string> = {
    stable: "Stable",
    beta: "Beta",
    alpha: "Alpha",
    rc: "Release Candidate",
    canary: "Canary",
    dev: "Development",
  }
  return labels[channel]
}

/**
 * Check if a channel is considered a prerelease channel
 */
export function isPrereleaseChannel(channel: ReleaseChannel): boolean {
  return channel !== "stable"
}

/**
 * Get all channels ordered by stability (most stable first)
 */
export function getChannelsByStability(): ReleaseChannel[] {
  return ["stable", "rc", "beta", "alpha", "canary", "dev"]
}
