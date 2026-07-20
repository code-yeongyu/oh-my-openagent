import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { randomBytes } from "node:crypto"

export function generateMissionId(): string {
  return `sec-${randomBytes(4).toString("hex")}`
}

export function generateFindingId(): string {
  return `find-${randomBytes(4).toString("hex")}`
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8")
  renameSync(tmp, filePath)
}

export function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    const raw = readFileSync(filePath, "utf-8")
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}
