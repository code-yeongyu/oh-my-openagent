import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import { getInboxDir, resolveBaseDir } from "@oh-my-opencode/team-core/team-registry/paths"

const WAKE_ERROR_PREFIX = ".wake-error-"
const WAKE_ERROR_SUFFIX = ".marker"

const WakeDeliveryErrorSchema = z.object({
  version: z.literal(1),
  messageId: z.string().uuid(),
  reason: z.string().min(1),
  failedAt: z.number().int().positive(),
}).strict()

export type WakeDeliveryError = z.infer<typeof WakeDeliveryErrorSchema>

function getWakeErrorPath(teamRunId: string, recipientName: string, messageId: string, config: TeamModeConfig): string {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipientName)
  return path.join(inboxDir, `${WAKE_ERROR_PREFIX}${messageId}${WAKE_ERROR_SUFFIX}`)
}

function getWakeErrorTempPath(markerPath: string): string {
  return `${markerPath}.tmp-${process.pid}-${Date.now()}`
}

function isMissingDirectoryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function recordWakeDeliveryError(
  teamRunId: string,
  recipientName: string,
  messageId: string,
  reason: string,
  config: TeamModeConfig,
): Promise<void> {
  const markerPath = getWakeErrorPath(teamRunId, recipientName, messageId, config)
  const markerDir = path.dirname(markerPath)
  const tempPath = getWakeErrorTempPath(markerPath)
  const record = WakeDeliveryErrorSchema.parse({
    version: 1,
    messageId,
    reason,
    failedAt: Date.now(),
  })

  await mkdir(markerDir, { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(record)}\n`, "utf8")
  await rename(tempPath, markerPath)
}

async function readWakeDeliveryError(markerPath: string): Promise<WakeDeliveryError | undefined> {
  try {
    return WakeDeliveryErrorSchema.parse(JSON.parse(await readFile(markerPath, "utf8")))
  } catch (error) {
    log("[team-mailbox] failed to read wake delivery error marker", {
      markerPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

export async function listWakeDeliveryErrors(
  teamRunId: string,
  recipientName: string,
  config: TeamModeConfig,
): Promise<readonly WakeDeliveryError[]> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, recipientName)
  const entries = await readdir(inboxDir).catch((error: unknown) => {
    if (isMissingDirectoryError(error)) return []

    log("[team-mailbox] failed to list wake delivery error markers", {
      inboxDir,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  })
  const markerPaths = entries
    .filter((entry) => entry.startsWith(WAKE_ERROR_PREFIX) && entry.endsWith(WAKE_ERROR_SUFFIX))
    .map((entry) => path.join(inboxDir, entry))
  const records = await Promise.all(markerPaths.map(readWakeDeliveryError))

  return records.filter((record): record is WakeDeliveryError => record !== undefined)
}
