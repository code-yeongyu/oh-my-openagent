import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type TokenIndex = Record<string, string>

const INDEX_FILE_NAME = "index.json"

function isTokenIndex(value: unknown): value is TokenIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

function getIndexPath(storageDir: string): string {
  return join(storageDir, INDEX_FILE_NAME)
}

export function readTokenIndex(storageDir: string): TokenIndex {
  const indexPath = getIndexPath(storageDir)
  if (!existsSync(indexPath)) return {}

  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath, "utf-8"))
    return isTokenIndex(parsed) ? parsed : {}
  } catch (readError) {
    if (!(readError instanceof Error)) throw readError
    return {}
  }
}

export function writeTokenIndex(storageDir: string, index: TokenIndex): boolean {
  try {
    const indexPath = getIndexPath(storageDir)
    const tempPath = `${indexPath}.tmp.${Date.now()}`
    writeFileSync(tempPath, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, indexPath)
    return true
  } catch (writeError) {
    if (!(writeError instanceof Error)) throw writeError
    return false
  }
}

export function saveTokenIndexEntry(storageDir: string, hash: string, key: string): boolean {
  return writeTokenIndex(storageDir, { ...readTokenIndex(storageDir), [hash]: key })
}

export function deleteTokenIndexEntry(storageDir: string, hash: string): boolean {
  const index = readTokenIndex(storageDir)
  if (!(hash in index)) return true
  delete index[hash]
  return writeTokenIndex(storageDir, index)
}
