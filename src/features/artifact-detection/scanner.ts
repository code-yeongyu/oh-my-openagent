import { createHash } from "crypto"
import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join, relative, resolve } from "path"
import { homedir } from "os"
import type { ArtifactClass, ArtifactScanResult, DetectedArtifact } from "./types"

interface ScanTarget {
  dir: string
  pattern: RegExp
  artifactClass: ArtifactClass
  recursive?: boolean
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

function collectFiles(dir: string, pattern: RegExp, recursive: boolean): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath)
      } else if (entry.isDirectory() && recursive) {
        results.push(...collectFiles(fullPath, pattern, true))
      }
    }
  } catch {
    /* intentionally empty — unreadable directories are skipped */
  }
  return results
}

function detectArtifact(filePath: string, artifactClass: ArtifactClass, projectDir: string): DetectedArtifact | null {
  try {
    const stat = statSync(filePath)
    const content = readFileSync(filePath, "utf-8")
    return {
      class: artifactClass,
      path: filePath,
      relativePath: relative(projectDir, filePath),
      contentHash: hashContent(content),
      detectedAt: Date.now(),
      sizeBytes: stat.size,
    }
  } catch {
    return null
  }
}

export interface ScanOptions {
  homeDir?: string
}

export function scanArtifacts(projectDir: string, options?: ScanOptions): ArtifactScanResult {
  const start = Date.now()
  const artifacts: DetectedArtifact[] = []
  const errors: string[] = []
  const resolved = resolve(projectDir)
  const home = options?.homeDir ?? homedir()

  const targets: ScanTarget[] = [
    { dir: join(resolved, ".sisyphus"), pattern: /^boulder\.json$/, artifactClass: "boulder-plan" },
    { dir: join(resolved, ".sisyphus", "plans"), pattern: /\.md$/, artifactClass: "sisyphus-plan" },
    { dir: join(resolved, ".sisyphus", "drafts"), pattern: /\.md$/, artifactClass: "sisyphus-draft" },
    { dir: join(home, ".config", "opencode", "context"), pattern: /\.md$/, artifactClass: "context-file", recursive: true },
    { dir: join(home, ".config", "opencode"), pattern: /^hooks\.json$/, artifactClass: "hooks-config" },
    { dir: join(resolved, ".opencode", "skills"), pattern: /^SKILL\.md$/, artifactClass: "opencode-skill", recursive: true },
  ]

  for (const target of targets) {
    try {
      const files = collectFiles(target.dir, target.pattern, target.recursive ?? false)
      for (const file of files) {
        const artifact = detectArtifact(file, target.artifactClass, resolved)
        if (artifact) artifacts.push(artifact)
      }
    } catch (err) {
      errors.push(`scan error for ${target.artifactClass}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    projectDir: resolved,
    artifacts,
    scanDuration: Date.now() - start,
    errors,
  }
}
