import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { codegraphDataRoot } from "./paths"

export interface PruneCodegraphStoreOptions {
  readonly homeDir?: string
  readonly maxAgeDays: number
  readonly maxBytes: number
  readonly nowMs?: number
  readonly pruneMissingSources?: boolean
}

export interface PruneCodegraphStoreResult {
  readonly remainingBytes: number
  readonly removed: readonly string[]
}

interface StoreEntry {
  readonly mtimeMs: number
  readonly path: string
  readonly sizeBytes: number
}

const CODEGRAPH_PROJECT_SOURCE_METADATA_FILE = "source.json"
const CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION = 1

export function writeCodegraphSourceMetadata(dataDir: string, sourceDir: string): void {
  writeFileSync(
    join(dataDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE),
    `${JSON.stringify({ sourceDir, version: CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION }, null, 2)}\n`,
  )
}

function directorySize(path: string): number {
  const entryStat = lstatSync(path)
  if (!entryStat.isDirectory()) return entryStat.size

  return readdirSync(path).reduce((total, entry) => total + directorySize(join(path, entry)), 0)
}

function readStoreEntries(projectsDir: string): StoreEntry[] {
  if (!existsSync(projectsDir)) return []
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(projectsDir, entry.name)
      return { mtimeMs: lstatSync(path).mtimeMs, path, sizeBytes: directorySize(path) }
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path))
}

function readRecordedSourceDir(projectDir: string): string | null {
  const metadataPath = join(projectDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE)
  if (!existsSync(metadataPath)) return null

  try {
    const parsed: unknown = JSON.parse(readFileSync(metadataPath, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const sourceDir = (parsed as { readonly sourceDir?: unknown }).sourceDir
    return typeof sourceDir === "string" && sourceDir.trim().length > 0 ? sourceDir : null
  } catch (error) {
    if (isNonFatalSourceMetadataError(error)) return null
    throw error
  }
}

function isNonFatalSourceMetadataError(error: unknown): boolean {
  if (error instanceof SyntaxError) return true
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { readonly code?: unknown }).code : undefined
  return typeof code === "string" && ["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(code)
}

function recordedSourceIsMissing(projectDir: string): boolean {
  const sourceDir = readRecordedSourceDir(projectDir)
  return sourceDir !== null && !existsSync(sourceDir)
}

function removeStoreEntry(entry: StoreEntry, removed: string[]): void {
  rmSync(entry.path, { force: true, recursive: true })
  removed.push(entry.path)
}

export function pruneCodegraphStore(options: PruneCodegraphStoreOptions): PruneCodegraphStoreResult {
  const projectsDir = join(codegraphDataRoot(options.homeDir ?? homedir()), "projects")
  const nowMs = options.nowMs ?? Date.now()
  const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1_000
  const removed: string[] = []
  let entries = readStoreEntries(projectsDir)
  let totalBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0)

  if (options.pruneMissingSources === true) {
    for (const entry of entries) {
      if (!recordedSourceIsMissing(entry.path)) continue
      removeStoreEntry(entry, removed)
      totalBytes -= entry.sizeBytes
    }
  }

  entries = entries.filter((entry) => !removed.includes(entry.path))
  for (const entry of entries) {
    if (nowMs - entry.mtimeMs <= maxAgeMs) continue
    removeStoreEntry(entry, removed)
    totalBytes -= entry.sizeBytes
  }

  entries = entries.filter((entry) => !removed.includes(entry.path))
  for (const entry of entries) {
    if (totalBytes <= options.maxBytes) break
    removeStoreEntry(entry, removed)
    totalBytes -= entry.sizeBytes
  }

  return { remainingBytes: Math.max(0, totalBytes), removed }
}

export function pruneDeadCodegraphProjectStores(
  options: { readonly homeDir?: string } = {},
): PruneCodegraphStoreResult {
  const projectsDir = join(codegraphDataRoot(options.homeDir ?? homedir()), "projects")
  const removed: string[] = []
  if (!existsSync(projectsDir)) return { remainingBytes: 0, removed }

  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const projectDir = join(projectsDir, entry.name)
    if (!recordedSourceIsMissing(projectDir)) continue
    rmSync(projectDir, { force: true, recursive: true })
    removed.push(projectDir)
  }

  return { remainingBytes: 0, removed }
}
