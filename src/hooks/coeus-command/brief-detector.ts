import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { BRIEFS_DIR } from "./constants"

function getBriefsPath(dir: string): string {
  return join(dir, BRIEFS_DIR)
}

function getMdFiles(briefsPath: string): string[] {
  if (!existsSync(briefsPath)) return []
  return readdirSync(briefsPath)
    .filter((f) => f.endsWith(".md"))
    .sort()
}

export function findBriefBySlug(dir: string, slug: string): string | null {
  const briefsPath = getBriefsPath(dir)
  const files = getMdFiles(briefsPath)
  const match = files.find((f) => f.startsWith(slug))
  return match ? join(briefsPath, match) : null
}

export function findLatestBrief(dir: string): string | null {
  const briefsPath = getBriefsPath(dir)
  const files = getMdFiles(briefsPath)
  if (files.length === 0) return null
  return join(briefsPath, files[files.length - 1])
}

export function listBriefs(dir: string): string[] {
  const briefsPath = getBriefsPath(dir)
  return getMdFiles(briefsPath).map((f) => join(briefsPath, f))
}
