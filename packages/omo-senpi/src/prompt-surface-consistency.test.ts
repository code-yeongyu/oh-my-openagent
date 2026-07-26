import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")

// Machine consistency gate for the injection-model prompt sweep. The plugin ships skills
// regenerated from these sources (plugin/skills is deleted and rebuilt by sync-skills.mjs;
// generated-directive.ts is rebuilt by embed-directive.mjs), so gating the sources plus the
// committed generated artifacts gates what actually ships. Prose sentences are never pinned —
// only the stale wait idioms (absence) and the injection/monitor guidance markers (presence).
const scannedDirectories = [
  "packages/omo-senpi/skills",
  "packages/shared-skills/skills",
  "packages/omo-codex/plugin/components/ulw-loop/skills/ulw-loop",
]

const scannedFiles = [
  "packages/omo-senpi/plugin/scripts/sync-skills.mjs",
  "packages/omo-senpi/src/components/ultrawork/generated-directive.ts",
  "packages/omo-senpi/src/components/task/usage-guidance.ts",
  "packages/omo-senpi/AGENTS.md",
  "packages/senpi-task/AGENTS.md",
]

// Blocking waits are gone: team_wait was removed, bash_output is peek-only (no wait_for param),
// and task_output no longer takes block. Shipped prompt surfaces must not teach the old idioms.
const staleWaitIdiomPatterns = [
  { label: "team_wait", pattern: /\bteam_wait\b/ },
  { label: "bash_output wait_for parameter", pattern: /\bwait_for\s*[:=]/ },
  { label: "task_output blocking example", pattern: /\btask_output\b[^\n]*\bblock\s*:\s*true/ },
]

// A stale idiom may still be NAMED when the line is migration/ghost guidance that points at the
// removal instead of teaching the wait (e.g. "the team_wait claim path was removed").
const migrationMentionPattern = /\b(?:removed|retired|replaced|no longer)\b/i

// Every surface the sweep rewrote must teach the injection model afterwards.
const injectionGuidanceSurfaces = [
  "packages/omo-senpi/skills/ultrawork/SKILL.md",
  "packages/omo-senpi/skills/hyperplan/SKILL.md",
  "packages/omo-senpi/skills/ulw-research/SKILL.md",
  "packages/omo-senpi/plugin/scripts/sync-skills.mjs",
  "packages/omo-senpi/src/components/ultrawork/generated-directive.ts",
  "packages/omo-senpi/src/components/task/usage-guidance.ts",
]
const injectionMarkerPattern = /\binject\w*/i

// Surfaces that teach command/child waiting must route pattern watches through the monitor tool.
const monitorGuidanceSurfaces = [
  "packages/omo-senpi/skills/ultrawork/SKILL.md",
  "packages/omo-senpi/src/components/ultrawork/generated-directive.ts",
]
const monitorMarkerPattern = /\bmonitor\b/

function listFiles(path: string): string[] {
  const entries = readdirSync(path, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function collectScannedFiles(): string[] {
  const files = scannedFiles.map((file) => join(repoRoot, file))
  for (const directory of scannedDirectories) {
    files.push(...listFiles(join(repoRoot, directory)))
  }
  return files.sort()
}

describe("prompt surface consistency gate", () => {
  test("#given shipped prompt surfaces #when grepped for stale wait idioms #then only migration mentions remain", () => {
    const violations: string[] = []

    for (const file of collectScannedFiles()) {
      const content = readFileSync(file, "utf8")
      const lines = content.split("\n")
      lines.forEach((line, index) => {
        for (const { label, pattern } of staleWaitIdiomPatterns) {
          if (!pattern.test(line)) continue
          if (migrationMentionPattern.test(line)) continue
          violations.push(`${relative(repoRoot, file)}:${index + 1} teaches ${label}: ${line.trim().slice(0, 120)}`)
        }
      })
    }

    expect(violations).toEqual([])
  })

  test("#given swept prompt surfaces #when inspected #then each teaches the injection model", () => {
    const missing: string[] = []

    for (const file of injectionGuidanceSurfaces) {
      const content = readFileSync(join(repoRoot, file), "utf8")
      if (!injectionMarkerPattern.test(content)) {
        missing.push(`${file} carries no injection-model guidance`)
      }
    }

    expect(missing).toEqual([])
  })

  test("#given wait-teaching prompt surfaces #when inspected #then pattern watches route through the monitor tool", () => {
    const missing: string[] = []

    for (const file of monitorGuidanceSurfaces) {
      const content = readFileSync(join(repoRoot, file), "utf8")
      if (!monitorMarkerPattern.test(content)) {
        missing.push(`${file} carries no monitor guidance`)
      }
    }

    expect(missing).toEqual([])
  })
})
