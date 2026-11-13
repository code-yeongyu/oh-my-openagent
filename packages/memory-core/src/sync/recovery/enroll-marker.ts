import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { z } from "zod"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "../../fs/resilient.ts"
import { syncJournalDirectory, syncJournalFile } from "../../journal/fsync.ts"
import { genesisIntentLocation } from "../genesis/intent-store.ts"

/**
 * The enrollment phrase marker (contract 6, review M3): written BEFORE a new phrase is shown on a member device,
 * naming the engine-drawn credential id. It holds no secret: the credential id is public. Resolution reads the
 * VERIFIED chain: enrolled means saved, absent with no live ceremony means the shown phrase is void.
 */
export type EnrollMarker = {
  readonly version: 1
  readonly account: string
  readonly credentialId: string
  readonly purpose: "enroll" | "rotate"
  readonly oldCredentialId?: string
  readonly startedAt: number
}

export type EnrollPlace = { readonly pinDir: string; readonly account: string; readonly principalId: string }

const schema = z.strictObject({
  version: z.literal(1),
  account: z.string().min(1),
  credentialId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  purpose: z.enum(["enroll", "rotate"]),
  oldCredentialId: z.string().min(1).optional(),
  startedAt: z.number().finite(),
})

const directory = (place: EnrollPlace): string =>
  `${genesisIntentLocation(place.pinDir, place.account, place.principalId)}.phrase-enroll`
const fileOf = (place: EnrollPlace, credentialId: string): string => join(directory(place), `${credentialId}.json`)
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT"

export const writeEnrollMarker = async (place: EnrollPlace, marker: EnrollMarker): Promise<void> => {
  const target = fileOf(place, marker.credentialId)
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

export const deleteEnrollMarker = async (place: EnrollPlace, credentialId: string): Promise<void> => {
  await rm(fileOf(place, credentialId), { force: true })
  await syncJournalDirectory(directory(place))
}

export type EnrollMarkerRead = { readonly kind: "marker"; readonly marker: EnrollMarker } | { readonly kind: "corrupt" }

/** Every marker on disk; an unreadable one is reported, never silently skipped (it resolves as unresolved). */
export const listEnrollMarkers = async (place: EnrollPlace): Promise<ReadonlyArray<EnrollMarkerRead>> => {
  let names: string[]
  try {
    names = await readdir(directory(place))
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const out: EnrollMarkerRead[] = []
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(join(directory(place), name), "utf8")))
      if (!parsed.success || parsed.data.account !== place.account) out.push({ kind: "corrupt" })
      else {
        const { oldCredentialId, ...rest } = parsed.data
        out.push({ kind: "marker", marker: oldCredentialId === undefined ? rest : { ...rest, oldCredentialId } })
      }
    } catch {
      out.push({ kind: "corrupt" })
    }
  }
  return out
}

/** What the verified chain says about one marker; `null` means the chain could not be read and verified. */
export type EnrollChainFacts = {
  readonly enrolledEver: ReadonlySet<string>
  readonly registry: ReadonlySet<string>
  /** Credential ids whose removal is followed by a stored rotation that excludes them. */
  readonly removedAndRotated: ReadonlySet<string>
} | null

export type EnrollResolution =
  | { readonly kind: "saved" }
  | { readonly kind: "rotation-pending" }
  | { readonly kind: "void"; readonly purpose: "enroll" | "rotate" }
  | { readonly kind: "unresolved" }

/**
 * Contract 6 resolution, fail-safe in one direction (L8): only a genuinely signed enrollment record reads as
 * saved; a server that withholds a just-appended record can at worst make the phrase read void (availability
 * only; for a rotation the old phrase stays valid). An unreadable chain is unresolved, never void or saved.
 */
export const resolveEnrollMarker = (marker: EnrollMarker, facts: EnrollChainFacts): EnrollResolution => {
  if (facts === null) return { kind: "unresolved" }
  if (!facts.enrolledEver.has(marker.credentialId)) return { kind: "void", purpose: marker.purpose }
  if (marker.purpose === "enroll" || marker.oldCredentialId === undefined) return { kind: "saved" }
  return facts.removedAndRotated.has(marker.oldCredentialId) ? { kind: "saved" } : { kind: "rotation-pending" }
}
