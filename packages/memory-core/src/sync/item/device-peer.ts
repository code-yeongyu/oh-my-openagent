// The device's one Loro peer id (review r3): created once, persisted, and reused by every
// capture on this device, so the version vector holds one entry per device. `path` is a
// directory holding the file `id`. The id is written whole into a private candidate directory,
// which is published by renaming it onto `path`: a directory rename is atomic and fails when
// the target exists and is non-empty, on every file system (no hard links, review r4 LOW-2).
// A racing reader never sees a partial id, and exactly one candidate wins.
// Next to `id` sits `machine`, the device fingerprint (machine id + canonical state-dir path)
// it was minted under. A peer read under another fingerprint (a state dir copied to another
// machine or path) is retired, renamed aside, and a new one is minted (reviews r4 MEDIUM, r5 M3).
// Only one process may open a state dir; two racing retirers could otherwise retire each
// other's fresh peer and its receipts (review r5 L3).

import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"

import type { PeerID } from "../../crdt/loro-runtime"
import { mkdir, readFile, rename, rm, writeFile } from "../../fs/resilient"

export class DevicePeerError extends Error {
  override readonly name = "DevicePeerError"
}

const PEER_RE = /^[1-9][0-9]{0,19}$/
const U64_MAX = (1n << 64n) - 1n

export interface DevicePeer {
  readonly peer: PeerID
  readonly retired: boolean
}

export async function loadOrCreateDevicePeer(path: string, machine: string): Promise<DevicePeer> {
  const existing = await readPeer(path)
  if (existing !== null && existing.machine === machine) return { peer: existing.peer, retired: false }
  if (existing !== null) await retireAside(path)
  await mkdir(dirname(path), { recursive: true })
  const candidate = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await mkdir(candidate, { mode: 0o700 })
  let lost: unknown = null
  try {
    await writeFile(join(candidate, "id"), `${freshPeer()}\n`, { flag: "wx", mode: 0o600 })
    await writeFile(join(candidate, "machine"), `${machine}\n`, { flag: "wx", mode: 0o600 })
    await rename(candidate, path)
  } catch (error) {
    lost = error
  } finally {
    await rm(candidate, { recursive: true, force: true })
  }
  const created = await readPeer(path)
  if (created !== null && created.machine === machine) return { peer: created.peer, retired: existing !== null }
  throw lost ?? new DevicePeerError(`device peer could not be created for this machine: ${path}`)
}

/** Renames `path` aside so nothing on this machine reuses it; a concurrent retirer that won is fine. */
export async function retireAside(path: string): Promise<void> {
  try {
    await rename(path, `${path}.retired-${Date.now()}-${randomBytes(4).toString("hex")}`)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
}

async function readPeer(path: string): Promise<{ peer: PeerID; machine: string | null } | null> {
  const raw = await readOptional(join(path, "id"))
  if (raw === null) return null
  const text = raw.trim()
  if (!isPeer(text)) throw new DevicePeerError(`device peer file is not a u64 peer id: ${path}`)
  const machine = await readOptional(join(path, "machine"))
  return { peer: text, machine: machine === null ? null : machine.trim() }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function freshPeer(): string {
  let value = 0n
  while (value === 0n) value = randomBytes(8).readBigUInt64BE()
  return value.toString()
}

function isPeer(text: string): text is PeerID {
  return PEER_RE.test(text) && BigInt(text) <= U64_MAX
}
