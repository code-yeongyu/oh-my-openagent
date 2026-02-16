import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs"
import { readFile } from "fs/promises"
import { join } from "path"
import { log } from "../../shared/logger"
import type { QueuedMcbOperation, SyncQueueConfig } from "./sync-queue-types"

export const DEFAULT_SYNC_QUEUE_CONFIG: SyncQueueConfig = {
  maxEntries: 500,
  maxAgeMs: 604_800_000,
  queueDir: ".sisyphus",
  queueFile: ".mcb-sync-queue.json",
}

function getQueuePath(projectDir: string, config = DEFAULT_SYNC_QUEUE_CONFIG): string {
  return join(projectDir, config.queueDir, config.queueFile)
}

function parseQueue(raw: string): QueuedMcbOperation[] {
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : []
}

function writeQueueAtomic(queuePath: string, entries: QueuedMcbOperation[]): void {
  const tmpPath = `${queuePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8")
  renameSync(tmpPath, queuePath)
}

export async function peekQueue(
  projectDir: string,
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<QueuedMcbOperation[]> {
  const queuePath = getQueuePath(projectDir, config)
  if (!existsSync(queuePath)) {
    return []
  }

  try {
    const raw = await readFile(queuePath, "utf-8")
    return parseQueue(raw)
  } catch (error) {
    log("[mcb] Failed to read sync queue, using empty queue", {
      queuePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function getQueueSize(
  projectDir: string,
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<number> {
  const queue = await peekQueue(projectDir, config)
  return queue.length
}

export async function enqueueOperation(
  projectDir: string,
  operation: QueuedMcbOperation,
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<void> {
  const queuePath = getQueuePath(projectDir, config)
  const queueDir = join(projectDir, config.queueDir)
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true })
  }

  const existing = await peekQueue(projectDir, config)
  const fresh = existing.filter((entry) => Date.now() - entry.queuedAt <= config.maxAgeMs)
  const next = [...fresh, operation]
  while (next.length > config.maxEntries) {
    next.shift()
  }
  writeQueueAtomic(queuePath, next)
}

export async function dequeueOperation(
  projectDir: string,
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<QueuedMcbOperation | null> {
  const queuePath = getQueuePath(projectDir, config)
  const queue = await peekQueue(projectDir, config)
  const item = queue.shift() ?? null
  if (item) {
    writeQueueAtomic(queuePath, queue)
  }
  return item
}

export async function saveQueue(
  projectDir: string,
  entries: QueuedMcbOperation[],
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<void> {
  const queueDir = join(projectDir, config.queueDir)
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true })
  }
  const queuePath = getQueuePath(projectDir, config)
  writeQueueAtomic(queuePath, entries)
}

export async function evictStaleEntries(
  projectDir: string,
  config = DEFAULT_SYNC_QUEUE_CONFIG,
): Promise<number> {
  const queue = await peekQueue(projectDir, config)
  const fresh = queue.filter((entry) => Date.now() - entry.queuedAt <= config.maxAgeMs)
  const evicted = queue.length - fresh.length
  if (evicted > 0) {
    await saveQueue(projectDir, fresh, config)
  }
  return evicted
}

export function clearQueue(projectDir: string, config = DEFAULT_SYNC_QUEUE_CONFIG): void {
  rmSync(getQueuePath(projectDir, config), { force: true })
}
