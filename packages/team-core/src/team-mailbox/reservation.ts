import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdir, readFile, readdir, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { atomicWrite } from "../team-state-store/locks"
import {
  DEAD_CONSUMER_LEASE_STALE_MS,
  withInboxConsumerLease,
  withInboxConsumerLeaseAtPath,
} from "./consumer-lease"

export interface DeliveryReservation {
  readonly reservedPath: string
  readonly inboxPath: string
  readonly processedPath: string
  readonly processedDir: string
  readonly generation?: string
}

const RESERVED_PREFIX = ".delivering-"
const RESERVED_SUFFIX = ".json"

class MissingDeliveryReservationError extends Error {
  readonly reservedPath: string

  constructor(reservedPath: string) {
    super(`delivery reservation has no terminal file: ${reservedPath}`)
    this.name = "MissingDeliveryReservationError"
    this.reservedPath = reservedPath
  }
}

export class StaleDeliveryReservationError extends Error {
  readonly reservedPath: string

  constructor(reservedPath: string) {
    super(`stale delivery reservation: ${reservedPath}`)
    this.name = "StaleDeliveryReservationError"
    this.reservedPath = reservedPath
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function buildReservation(
  inboxDir: string,
  messageId: string,
): DeliveryReservation {
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

  return await withInboxConsumerLease(teamRunId, recipientName, config, async () => {
    return await reserveMessageForDeliveryUnderLease(reservation)
  }, { staleAfterMs: DEAD_CONSUMER_LEASE_STALE_MS })
}

async function reserveMessageForDeliveryUnderLease(
  reservation: DeliveryReservation,
): Promise<DeliveryReservation | null> {
  // Pre-reserved by sendMessage: confirm existence without renaming.
  try {
    await stat(reservation.reservedPath)
    return await reuseOrAssignReservationGeneration(reservation)
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }

  // Not pre-reserved: rename the unreserved file into the reserved slot.
  try {
    await rename(reservation.inboxPath, reservation.reservedPath)
    return await assignReservationGeneration(reservation)
  } catch (error) {
    if (isMissingPathError(error)) {
      await removeReservationGeneration(reservation)
      return null
    }
    throw error
  }
}

export async function commitDeliveryReservation(reservation: DeliveryReservation): Promise<void> {
  await withReservationLease(reservation, async () => {
    if (!(await assertCurrentReservationGeneration(reservation))) return
    await mkdir(reservation.processedDir, { recursive: true, mode: 0o700 })
    if (await moveFirstExisting([reservation.reservedPath, reservation.inboxPath], reservation.processedPath)) {
      await removeReservationGeneration(reservation)
      return
    }
    await assertTerminalPathExists(reservation.processedPath, reservation)
    await removeReservationGeneration(reservation)
  })
}

export async function releaseDeliveryReservation(reservation: DeliveryReservation): Promise<void> {
  await withReservationLease(reservation, async () => {
    if (!(await assertCurrentReservationGeneration(reservation))) return
    if (await moveFirstExisting([reservation.reservedPath], reservation.inboxPath)) {
      await removeReservationGeneration(reservation)
      return
    }
    if (await pathExists(reservation.inboxPath)) {
      await removeReservationGeneration(reservation)
      return
    }
    if (await pathExists(reservation.processedPath)) {
      await removeReservationGeneration(reservation)
      return
    }
    throw new MissingDeliveryReservationError(reservation.reservedPath)
  })
}

export async function reclaimStaleReservations(
  teamRunId: string,
  recipientName: string,
  config: TeamModeConfig,
  staleTtlMs: number,
): Promise<string[]> {
  return await withInboxConsumerLease(teamRunId, recipientName, config, async () => {
    return await reclaimStaleReservationsUnderLease(teamRunId, recipientName, config, staleTtlMs)
  }, { staleAfterMs: DEAD_CONSUMER_LEASE_STALE_MS })
}

async function reclaimStaleReservationsUnderLease(
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
    } catch (error) {
      error instanceof Error
      continue
    }
  }

  return reclaimedIds
}

async function withReservationLease<T>(reservation: DeliveryReservation, fn: () => Promise<T>): Promise<T> {
  const inboxDir = path.dirname(reservation.inboxPath)
  return await withInboxConsumerLeaseAtPath(
    inboxDir,
    path.basename(inboxDir),
    fn,
    { staleAfterMs: DEAD_CONSUMER_LEASE_STALE_MS },
  )
}

async function moveFirstExisting(sourcePaths: readonly string[], targetPath: string): Promise<boolean> {
  for (const sourcePath of sourcePaths) {
    try {
      await rename(sourcePath, targetPath)
      return true
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
  }
  return false
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

async function assertTerminalPathExists(
  terminalPath: string,
  reservation: DeliveryReservation,
): Promise<void> {
  if (await pathExists(terminalPath)) return
  throw new MissingDeliveryReservationError(reservation.reservedPath)
}

async function assignReservationGeneration(reservation: DeliveryReservation): Promise<DeliveryReservation> {
  const generation = randomUUID()
  await atomicWrite(reservationGenerationPath(reservation), `${generation}\n`)
  return { ...reservation, generation }
}

async function reuseOrAssignReservationGeneration(
  reservation: DeliveryReservation,
): Promise<DeliveryReservation> {
  const generation = await readReservationGeneration(reservation)
  return generation === null
    ? await assignReservationGeneration(reservation)
    : { ...reservation, generation }
}

function reservationGenerationPath(reservation: DeliveryReservation): string {
  const messageId = path.basename(reservation.inboxPath, ".json")
  return path.join(path.dirname(reservation.inboxPath), `.reservation-${messageId}.generation`)
}

async function readReservationGeneration(reservation: DeliveryReservation): Promise<string | null> {
  try {
    return (await readFile(reservationGenerationPath(reservation), "utf8")).trim()
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

async function removeReservationGeneration(reservation: DeliveryReservation): Promise<void> {
  try {
    await unlink(reservationGenerationPath(reservation))
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }
}

async function assertCurrentReservationGeneration(reservation: DeliveryReservation): Promise<boolean> {
  const currentGeneration = await readReservationGeneration(reservation)
  if (reservation.generation === undefined) {
    if (currentGeneration !== null) throw new StaleDeliveryReservationError(reservation.reservedPath)
    return true
  }
  if (currentGeneration === reservation.generation) return true

  const hasReserved = await pathExists(reservation.reservedPath)
  const hasUnread = await pathExists(reservation.inboxPath)
  const hasProcessed = await pathExists(reservation.processedPath)
  if (currentGeneration === null && !hasReserved && !hasUnread && hasProcessed) return false
  if (currentGeneration === null && !hasReserved && !hasUnread && !hasProcessed) {
    throw new MissingDeliveryReservationError(reservation.reservedPath)
  }
  throw new StaleDeliveryReservationError(reservation.reservedPath)
}
