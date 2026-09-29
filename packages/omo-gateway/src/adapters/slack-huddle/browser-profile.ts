// The throwaway profile a call runs in.
//
// A call NEVER touches a real browser profile. It gets a fresh 0700 directory that carries only what
// the call needs, and that directory is removed again on every exit path.

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PROFILE_PREFIX = "call-"

/** How long a profile may sit unclaimed before the next launch treats it as debris. */
export const STALE_PROFILE_MS = 12 * 60 * 60 * 1000

/**
 * A silent 16-bit mono WAV.
 *
 * The browser loops this as the fake microphone, so a call hears silence until the bridge injects
 * audio. Without it the browser supplies its own beeping test tone, which every participant hears.
 */
export function writeSilentWav(path: string, seconds = 1, sampleRate = 48_000): void {
  const samples = Math.max(1, Math.round(seconds * sampleRate))
  const dataBytes = samples * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write("WAVE", 8, "ascii")
  buffer.write("fmt ", 12, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(dataBytes, 40)
  writeFileSync(path, buffer, { mode: 0o600 })
}

/**
 * Remove profiles no live call can own any more.
 *
 * A machine that lost power leaves a directory behind with no watchdog left to collect it. Profiles
 * are created here and calls are bounded well below this age, so anything older is debris. Only
 * directories this module named are touched. Returns what it removed, for a cleanup receipt.
 */
export function sweepStaleProfiles(profilesRoot: string, olderThanMs = STALE_PROFILE_MS, now = Date.now()): string[] {
  const removed: string[] = []
  let entries: readonly string[]
  try {
    entries = readdirSync(profilesRoot)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return removed
    throw error
  }
  for (const entry of entries) {
    if (!entry.startsWith(PROFILE_PREFIX)) continue
    const path = join(profilesRoot, entry)
    if (now - statSync(path).mtimeMs < olderThanMs) continue
    rmSync(path, { recursive: true, force: true, maxRetries: 5 })
    removed.push(path)
  }
  return removed
}

export type CallProfile = { readonly dir: string; readonly silenceWav: string }

/** Create this call's profile: 0700, swept clean of debris first, with its silent microphone ready. */
export function createCallProfile(profilesRoot: string): CallProfile {
  mkdirSync(profilesRoot, { recursive: true, mode: 0o700 })
  chmodSync(profilesRoot, 0o700)
  sweepStaleProfiles(profilesRoot)
  const dir = mkdtempSync(join(profilesRoot, PROFILE_PREFIX))
  chmodSync(dir, 0o700)
  const silenceWav = join(dir, "silence.wav")
  writeSilentWav(silenceWav)
  return { dir, silenceWav }
}
