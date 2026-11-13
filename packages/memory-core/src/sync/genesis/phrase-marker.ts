import { randomBytes } from "node:crypto"
import { dirname } from "node:path"
import { z } from "zod"
import { mkdir, readFile, rename, rm, stat, writeFile } from "../../fs/resilient.ts"
import { syncJournalDirectory, syncJournalFile } from "../../journal/fsync.ts"
import { readOwner } from "../../locks/lock-owner.ts"
import { isLockOwnerProvenDead } from "../../locks/stale-owner.ts"
import { genesisIntentLocation } from "./intent-store.ts"

/**
 * The genesis phrase marker (A3 engine contract 5.1, review M1/L7): a local, non-secret record that
 * this device showed a recovery phrase for a genesis that may not have been saved. It holds no words,
 * no entropy and no key, only the account, when the ceremony began and, once built, the genesis digest.
 */
export type PhraseGenesisMarker = {
  readonly version: 1
  readonly account: string
  readonly startedAt: number
  readonly genesisDigest?: string
}

export type PhraseGenesisPlace = { readonly pinDir: string; readonly account: string; readonly principalId: string }

const markerSchema = z.strictObject({
  version: z.literal(1),
  account: z.string().min(1),
  startedAt: z.number().finite(),
  genesisDigest: z.string().min(1).optional(),
})

const markerPath = (place: PhraseGenesisPlace): string =>
  `${genesisIntentLocation(place.pinDir, place.account, place.principalId)}.phrase-pending`
const lockPath = (place: PhraseGenesisPlace): string =>
  `${genesisIntentLocation(place.pinDir, place.account, place.principalId)}.lock`
const intentFile = (place: PhraseGenesisPlace): string =>
  `${genesisIntentLocation(place.pinDir, place.account, place.principalId)}/intent.json`

const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT"

type MarkerRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly marker: PhraseGenesisMarker }
  | { readonly kind: "corrupt" }

const readMarker = async (place: PhraseGenesisPlace): Promise<MarkerRead> => {
  let raw: string
  try {
    raw = await readFile(markerPath(place), "utf8")
  } catch (error) {
    if (missing(error)) return { kind: "absent" }
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: "corrupt" }
  }
  const parsed = markerSchema.safeParse(value)
  if (!parsed.success || parsed.data.account !== place.account) return { kind: "corrupt" }
  const { genesisDigest, ...rest } = parsed.data
  return { kind: "present", marker: genesisDigest === undefined ? rest : { ...rest, genesisDigest } }
}

/** Atomic and durable: a crash leaves the old marker or the new one, never a torn file. */
export const writePhraseGenesisMarker = async (place: PhraseGenesisPlace, marker: PhraseGenesisMarker): Promise<void> => {
  const target = markerPath(place)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const staging = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await writeFile(staging, JSON.stringify(marker), { flag: "wx", mode: 0o600 })
    await syncJournalFile(staging)
    await rename(staging, target)
  } finally {
    await rm(staging, { force: true })
  }
  await syncJournalDirectory(dirname(target))
}

export const deletePhraseGenesisMarker = async (place: PhraseGenesisPlace): Promise<void> => {
  await rm(markerPath(place), { force: true })
  await syncJournalDirectory(dirname(markerPath(place)))
}

/**
 * Whether a LIVE process holds this genesis lock (review M1): the lock file existing is not enough,
 * because a crashed owner leaves it behind. The owner is dead only on the lock code's own proof; an
 * incomplete record, another host or unknown liveness all count as live, so a doubt reads as a running
 * ceremony and never as a void phrase.
 */
export const genesisLockHeldByLiveOwner = async (place: PhraseGenesisPlace): Promise<boolean> => {
  const owner = await readOwner(lockPath(place))
  if (owner === null) return false
  if (owner.record === null) return true
  return !(await isLockOwnerProvenDead(owner.record))
}

/**
 * What the marker means for a phrase this device showed. `void`: it was certainly not saved. `saved`: a
 * stale marker whose genesis is this device's pinned root. `unresolved`: unreadable marker over an
 * existing chain, never reported as void or saved. Rules (contract 5.1): no marker or a pending intent
 * means nothing to report; with no chain at all a shown phrase cannot have landed; a recorded digest
 * equal to the pinned root means the phrase genesis committed (the pin is written before the intent is
 * retired); otherwise the intent was never stored or was retired by a lost race, so the phrase is void.
 */
export type GenesisPhraseState =
  | { readonly kind: "none" }
  | { readonly kind: "void" }
  | { readonly kind: "saved" }
  | { readonly kind: "unresolved" }

export const genesisPhraseState = async (
  place: PhraseGenesisPlace,
  facts: { readonly intentPresent: boolean; readonly pinnedGenesisDigest: string | null; readonly chainEmpty?: boolean },
): Promise<GenesisPhraseState> => {
  const read = await readMarker(place)
  if (read.kind === "absent" || facts.intentPresent) return { kind: "none" }
  if (facts.chainEmpty === true) return { kind: "void" }
  if (read.kind === "corrupt") return { kind: "unresolved" }
  const digest = read.marker.genesisDigest
  if (digest !== undefined && digest === facts.pinnedGenesisDigest) return { kind: "saved" }
  return { kind: "void" }
}

/** Whether an intent file exists, without parsing it; status reads never need the keyring. */
export const genesisIntentPresent = async (place: PhraseGenesisPlace): Promise<boolean> => {
  try {
    await stat(intentFile(place))
    return true
  } catch (error) {
    if (missing(error)) return false
    throw error
  }
}
