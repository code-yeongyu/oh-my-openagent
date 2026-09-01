import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"

import {
  CANDIDATE_MAX_DEPTH,
  CANDIDATE_MIN_FILES,
  CANDIDATE_MIN_LOC,
  EXCLUDED_DIR_NAMES,
  MISSING_COVERAGE_RATIO_THRESHOLD,
  SOURCE_EXTENSIONS,
} from "./constants"

export interface DirInfo {
  path: string
  files: number
  loc: number
  covered: boolean
}

export interface CoverageRatio {
  coverage: number
  missingRatio: number
  candidateDirs: number
  coveredDirs: number
}

export function isCovered(root: string, dir: string): boolean {
  let current = dir
  for (;;) {
    if (existsSync(join(current, "AGENTS.md"))) return true
    if (current === root) return false
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

export function computeCandidateDirs(root: string): DirInfo[] {
  const candidates: DirInfo[] = []
  walk(root, root, 0, candidates)
  return candidates
}

export function computeCoverageRatio(root: string): CoverageRatio | null {
  const candidates = computeCandidateDirs(root)
  if (candidates.length === 0) return null
  const coveredDirs = candidates.filter((dir) => dir.covered).length
  const coverage = coveredDirs / candidates.length
  return {
    coverage,
    missingRatio: 1 - coverage,
    candidateDirs: candidates.length,
    coveredDirs,
  }
}

export function shouldProposeInit(missingRatio: number | null, rootHasAgentsMd: boolean): boolean {
  if (missingRatio === null) return false
  return missingRatio >= MISSING_COVERAGE_RATIO_THRESHOLD
}

function walk(root: string, dir: string, depth: number, candidates: DirInfo[]): void {
  if (depth > CANDIDATE_MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  if (depth >= 1) {
    const sourceFiles = entries.filter(
      (entry) =>
        !entry.isSymbolicLink() && entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)),
    )
    const loc = sourceFiles.reduce(
      (sum, entry) => sum + readFileSync(join(dir, entry.name), "utf8").split("\n").length,
      0,
    )
    if (sourceFiles.length >= CANDIDATE_MIN_FILES || loc >= CANDIDATE_MIN_LOC) {
      candidates.push({ path: dir, files: sourceFiles.length, loc, covered: isCovered(root, dir) })
    }
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    walk(root, join(dir, entry.name), depth + 1, candidates)
  }
}
