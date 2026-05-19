import type { Dirent } from "node:fs"
import { mkdir, readdir, rename, stat } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"

export interface DeliveryReservation {
  reservedPath: string
  inboxPath: string
  processedPath: string
  processedDir: string
}

const RESERVED_PREFIX = ".delivering-"
const RESERVED_SUFFIX = ".json"

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function buildReservation(inboxDir: string, messageId: string): DeliveryReservation {
  const inboxPath = path.join(inboxDir, `${messageId}.json`)
  const reservedPath = path.join(inboxDir, `${RESERVED_PREFIX}${messageId}${RESERVED_SUFFIX}`)
  const processedDir = path.join(inboxDir, "processed")
  const processedPath = path.join(processedDir, `${messageId}.json`)
  return { reservedPath, inboxPath, processedPath, processedDir }
}

export async function reserveMessageForDelivery(
  teamRunId: string,
  recipientName: string,
  messageId: string,
  config: TeamModeConfig,
): Promise<DeliveryReservation | null> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipientName)
  const reservation = buildReservation(inboxDir, messageId)

  // Pre-reserved by sendMessage: confirm existence without renaming.
  try {
    await stat(reservation.reservedPath)
    return reservation
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }

  // Not pre-reserved: rename the unreserved file into the reserved slot.
  try {
    await rename(reservation.inboxPath, reservation.reservedPath)
    return reservation
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

export async function commitDeliveryReservation(reservation: DeliveryReservation): Promise<void> {
  await mkdir(reservation.processedDir, { recursive: true, mode: 0o700 })
  await rename(reservation.reservedPath, reservation.processedPath)
}

export async function releaseDeliveryReservation(reservation: DeliveryReservation): Promise<void> {
  await rename(reservation.reservedPath, reservation.inboxPath)
}

export async function reclaimStaleReservations(
  teamRunId: string,
  recipientName: string,
  config: TeamModeConfig,
  staleTtlMs: number,
): Promise<string[]> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipientName)
  const cutoff = Date.now() - staleTtlMs
  const reclaimedIds: string[] = []

  let entries: Dirent[]
  try {
    entries = await readdir(inboxDir, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(RESERVED_PREFIX) || !entry.name.endsWith(RESERVED_SUFFIX)) continue

    const filePath = path.join(inboxDir, entry.name)
    const fileStat = await stat(filePath)
    if (fileStat.mtimeMs > cutoff) continue

    const messageId = entry.name.slice(RESERVED_PREFIX.length, -RESERVED_SUFFIX.length)
    const restoredPath = path.join(inboxDir, `${messageId}.json`)

    try {
      await rename(filePath, restoredPath)
      reclaimedIds.push(messageId)
    } catch {
      continue
    }
  }

  return reclaimedIds
}
