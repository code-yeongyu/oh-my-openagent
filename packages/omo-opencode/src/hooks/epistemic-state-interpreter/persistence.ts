import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join } from "path"
import { log } from "../../shared/logger"
import type { PersistedSessionState } from "./persistence-types"

const EPISTEMIC_DIR = ".sisyphus/epistemic"

type Metadata = { createdAt: number; lastUpdated: number }

function getFilePath(sessionID: string): string {
  return join(EPISTEMIC_DIR, `${sessionID}.json`)
}

function getMetadataPath(): string {
  return join(EPISTEMIC_DIR, "_metadata.json")
}

function ensureDir(): void {
  if (!existsSync(EPISTEMIC_DIR)) {
    mkdirSync(EPISTEMIC_DIR, { recursive: true })
  }
}

function readMetadata(now: number): Metadata {
  const metaPath = getMetadataPath()
  if (!existsSync(metaPath)) return { createdAt: now, lastUpdated: now }

  try {
    const existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Partial<Metadata>
    return { createdAt: existing.createdAt ?? now, lastUpdated: now }
  } catch {
    return { createdAt: now, lastUpdated: now }
  }
}

function writeAtomic(filePath: string, data: unknown): void {
  const tempPath = `${filePath}.tmp.${Date.now()}`
  writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
  renameSync(tempPath, filePath)
}

export function persistState(sessionID: string, data: PersistedSessionState): void {
  setTimeout(() => {
    try {
      ensureDir()
      writeAtomic(getFilePath(sessionID), data)
      writeAtomic(getMetadataPath(), readMetadata(Date.now()))
    } catch {
      log("[epistemic] persist failed", { sessionID })
    }
  }, 0)
}

export function loadPersistedState(sessionID: string): PersistedSessionState | null {
  const filePath = getFilePath(sessionID)

  try {
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<PersistedSessionState>
    if (!parsed.sessionID || typeof parsed.updatedAt !== "number") {
      log("[epistemic] corrupted state file", { sessionID })
      return null
    }

    const migratedConclusions: Record<string, PersistedSessionState["conclusions"][string]> = {}
    for (const [key, data] of Object.entries(parsed.conclusions ?? {})) {
      migratedConclusions[key] = {
        ...data,
        lastSeenInvocation: data.lastSeenInvocation ?? 0,
        exclusionTheoryHash: data.exclusionTheoryHash ?? undefined,
      }
    }

    return { ...parsed, conclusions: migratedConclusions } as PersistedSessionState
  } catch {
    log("[epistemic] load failed", { sessionID })
    return null
  }
}
