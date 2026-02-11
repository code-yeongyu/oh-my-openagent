import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { withMcbFallback } from "../mcb-integration"
import type { DetectedArtifact, IngestionRecord } from "./types"

const HASH_FILE = ".sisyphus/.ingested-hashes.json"

function loadIngestedHashes(projectDir: string): Set<string> {
  const hashPath = join(projectDir, HASH_FILE)
  try {
    if (existsSync(hashPath)) {
      const records: IngestionRecord[] = JSON.parse(readFileSync(hashPath, "utf-8"))
      return new Set(records.map((r) => r.artifactHash))
    }
  } catch {
    // corrupt file — start fresh
  }
  return new Set()
}

function saveIngestedHash(projectDir: string, record: IngestionRecord): void {
  const hashPath = join(projectDir, HASH_FILE)
  try {
    const dir = dirname(hashPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const existing: IngestionRecord[] = existsSync(hashPath)
      ? JSON.parse(readFileSync(hashPath, "utf-8"))
      : []
    existing.push(record)
    writeFileSync(hashPath, JSON.stringify(existing, null, 2))
  } catch {
    // non-critical — idempotency will still work via in-memory set
  }
}

export interface IngestionResult {
  ingested: number
  skipped: number
  failed: number
  errors: string[]
}

export async function ingestArtifacts(
  artifacts: DetectedArtifact[],
  projectDir: string,
  collection: string,
  storeOperation?: (artifact: DetectedArtifact) => Promise<void>,
): Promise<IngestionResult> {
  const ingestedHashes = loadIngestedHashes(projectDir)
  const result: IngestionResult = { ingested: 0, skipped: 0, failed: 0, errors: [] }

  for (const artifact of artifacts) {
    if (ingestedHashes.has(artifact.contentHash)) {
      result.skipped++
      continue
    }

    if (storeOperation) {
      const mcbResult = await withMcbFallback(
        () => storeOperation(artifact),
        "memory",
        {
          tool: "memory",
          action: "store",
          params: {
            relativePath: artifact.relativePath,
            contentHash: artifact.contentHash,
          },
          maxRetries: 3,
          source: "artifact-ingestion",
        },
        projectDir,
      )

      if (!mcbResult.success) {
        result.failed++
        result.errors.push(`${artifact.relativePath}: ${mcbResult.error}`)
        continue
      }
    }

    ingestedHashes.add(artifact.contentHash)
    saveIngestedHash(projectDir, {
      artifactHash: artifact.contentHash,
      ingestedAt: Date.now(),
      mcbCollection: collection,
    })
    result.ingested++
  }

  return result
}
