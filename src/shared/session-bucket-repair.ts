import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "./data-path"

interface SessionMetadataLike {
  id?: string
  directory?: string
  projectID?: string
  parentID?: string
  [key: string]: unknown
}

export interface RepairMisbucketedSessionMetadataOptions {
  directory: string
  sessionID?: string
  storageRoot?: string
}

export interface RepairMisbucketedSessionMetadataResult {
  scanned: number
  repaired: number
  skipped: number
  errors: number
}

function normalizeDirectoryPathForMatch(value: string): string {
  let normalized = value.trim().replace(/\\/g, "/")

  const driveRootMatch = normalized.match(/^\/([A-Za-z])(?:\/(.*))?$/)
  if (driveRootMatch) {
    const [, drive, rest] = driveRootMatch
    normalized = `${drive}:/${rest ?? ""}`
  }

  const wslMatch = normalized.match(/^\/mnt\/([A-Za-z])(?:\/(.*))?$/)
  if (wslMatch) {
    const [, drive, rest] = wslMatch
    normalized = `${drive}:/${rest ?? ""}`
  }

  const cygdriveMatch = normalized.match(/^\/cygdrive\/([A-Za-z])(?:\/(.*))?$/)
  if (cygdriveMatch) {
    const [, drive, rest] = cygdriveMatch
    normalized = `${drive}:/${rest ?? ""}`
  }

  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  if (/^[A-Za-z]:/.test(normalized)) {
    return normalized.toLowerCase()
  }

  return normalized
}

async function readMetadata(filePath: string): Promise<SessionMetadataLike | null> {
  try {
    const content = await readFile(filePath, "utf-8")
    const parsed = JSON.parse(content) as SessionMetadataLike
    return parsed
  } catch {
    return null
  }
}

async function resolveParentBucket(
  sessionRoot: string,
  projectBuckets: string[],
  parentID: string,
  cache: Map<string, string | null>,
): Promise<string | undefined> {
  if (cache.has(parentID)) {
    const cached = cache.get(parentID)
    return cached ?? undefined
  }

  for (const bucket of projectBuckets) {
    const parentPath = join(sessionRoot, bucket, `${parentID}.json`)
    if (existsSync(parentPath)) {
      cache.set(parentID, bucket)
      return bucket
    }
  }

  cache.set(parentID, null)
  return undefined
}

async function resolveBucketByDirectory(
  sessionRoot: string,
  projectBuckets: string[],
  normalizedDirectory: string,
  cache: Map<string, string | null>,
): Promise<string | undefined> {
  if (cache.has(normalizedDirectory)) {
    const cached = cache.get(normalizedDirectory)
    return cached ?? undefined
  }

  for (const bucket of projectBuckets) {
    const bucketDir = join(sessionRoot, bucket)
    const files = await readdir(bucketDir).catch(() => [])
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const metadata = await readMetadata(join(bucketDir, file))
      if (!metadata || typeof metadata.directory !== "string") continue
      const candidateDirectory = normalizeDirectoryPathForMatch(metadata.directory)
      if (candidateDirectory === normalizedDirectory) {
        cache.set(normalizedDirectory, bucket)
        return bucket
      }
    }
  }

  cache.set(normalizedDirectory, null)
  return undefined
}

function resolveExplicitProjectBucket(metadata: SessionMetadataLike): string | undefined {
  const projectID = typeof metadata.projectID === "string" ? metadata.projectID.trim() : ""
  if (!projectID || projectID.toLowerCase() === "global") return undefined
  return projectID
}

function getSessionStorageRoot(override?: string): string {
  if (override) return override
  return join(getOpenCodeStorageDir(), "session")
}

export async function repairMisbucketedSessionMetadata(
  options: RepairMisbucketedSessionMetadataOptions,
): Promise<RepairMisbucketedSessionMetadataResult> {
  const result: RepairMisbucketedSessionMetadataResult = {
    scanned: 0,
    repaired: 0,
    skipped: 0,
    errors: 0,
  }

  if (!options.directory.trim()) {
    return result
  }

  const sessionRoot = getSessionStorageRoot(options.storageRoot)
  const globalDir = join(sessionRoot, "global")

  if (!existsSync(globalDir)) {
    return result
  }

  const targetDirectory = normalizeDirectoryPathForMatch(options.directory)

  const dirEntries = await readdir(sessionRoot, { withFileTypes: true }).catch(() => [])
  const projectBuckets = dirEntries
    .filter((entry) => entry.isDirectory() && entry.name !== "global")
    .map((entry) => entry.name)

  const files = options.sessionID
    ? [`${options.sessionID}.json`]
    : (await readdir(globalDir).catch(() => [])).filter((name) => name.endsWith(".json"))

  const parentBucketCache = new Map<string, string | null>()
  const directoryBucketCache = new Map<string, string | null>()

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const sourcePath = join(globalDir, file)
    if (!existsSync(sourcePath)) continue

    const metadata = await readMetadata(sourcePath)
    if (!metadata) {
      result.errors += 1
      continue
    }

    const sourceDirectory = typeof metadata.directory === "string" ? metadata.directory : ""
    if (!sourceDirectory) {
      result.skipped += 1
      continue
    }

    const normalizedSourceDirectory = normalizeDirectoryPathForMatch(sourceDirectory)
    if (normalizedSourceDirectory !== targetDirectory) {
      result.skipped += 1
      continue
    }

    result.scanned += 1

    const parentID = typeof metadata.parentID === "string" ? metadata.parentID : undefined
    const explicitBucket = resolveExplicitProjectBucket(metadata)
    const bucket = parentID
      ? (await resolveParentBucket(sessionRoot, projectBuckets, parentID, parentBucketCache)) ?? explicitBucket
      : explicitBucket ??
        (await resolveBucketByDirectory(
          sessionRoot,
          projectBuckets,
          normalizedSourceDirectory,
          directoryBucketCache,
        ))

    if (!bucket || bucket === "global") {
      result.skipped += 1
      continue
    }

    const targetDir = join(sessionRoot, bucket)
    const targetPath = join(targetDir, file)
    if (existsSync(targetPath)) {
      result.skipped += 1
      continue
    }

    try {
      await mkdir(targetDir, { recursive: true })
      const repairedMetadata: SessionMetadataLike = {
        ...metadata,
        projectID: bucket,
      }
      await writeFile(targetPath, `${JSON.stringify(repairedMetadata, null, 2)}\n`, "utf-8")
      result.repaired += 1
    } catch {
      result.errors += 1
    }
  }

  return result
}
