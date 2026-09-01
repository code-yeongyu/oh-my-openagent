import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { StateDirConfig } from "../../../store"

const cleanupRoots: string[] = []

export function cleanupMessagingTmp(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempProjectDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-team-messaging-"))
  cleanupRoots.push(directory)
  return directory
}

export function stateDirConfig(projectDir: string): StateDirConfig {
  return { project_dir: projectDir }
}
