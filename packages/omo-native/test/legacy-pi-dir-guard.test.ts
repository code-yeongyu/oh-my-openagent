import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  LEGACY_PI_DIR_MIGRATION_RELATIVE,
  LIVE_PI_DIR_MOVES,
  NESTED_PI_DIR_MOVES,
  patchLegacyPiDirMigration,
} from "../bin/lib/legacy-pi-dir-guard.js"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const INSTALLED_MIGRATION = join(PACKAGE_ROOT, "node_modules", "@code-yeongyu", "senpi", LEGACY_PI_DIR_MIGRATION_RELATIVE)

const roots: string[] = []

function writeMigration(body: string): string {
  const root = mkdtempSync(join(tmpdir(), "omo-legacy-pi-dir-"))
  roots.push(root)
  const path = join(root, LEGACY_PI_DIR_MIGRATION_RELATIVE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("legacy pi-dir migration guard", () => {
  describe("#given Senpi still moves ~/.pi/agent and cwd/.pi into the branded dirs", () => {
    describe("#when postinstall patches the engine", () => {
      test("#then only nested leftover .omo/.pi paths remain eligible to migrate", () => {
        const root = writeMigration(`export function migrateLegacySenpiDirs() {}\n${LIVE_PI_DIR_MOVES}`)
        expect(patchLegacyPiDirMigration(root)).toBe("rewritten")
        const source = readFileSync(join(root, LEGACY_PI_DIR_MIGRATION_RELATIVE), "utf8")
        expect(source).toContain(NESTED_PI_DIR_MOVES)
        expect(source).not.toContain('[join(cwd, ".pi"), projectNewDir, "project config directory"]')
        expect(source).not.toContain('[join(homeDir, ".pi", "agent")')
      })
    })
  })

  describe("#given the live .pi moves were already removed", () => {
    describe("#when the patch runs again", () => {
      test("#then the file stays byte-identical", () => {
        const root = writeMigration(`export function migrateLegacySenpiDirs() {}\n${NESTED_PI_DIR_MOVES}`)
        const before = readFileSync(join(root, LEGACY_PI_DIR_MIGRATION_RELATIVE), "utf8")
        expect(patchLegacyPiDirMigration(root)).toBe("already-patched")
        expect(readFileSync(join(root, LEGACY_PI_DIR_MIGRATION_RELATIVE), "utf8")).toBe(before)
      })
    })
  })

  describe("#given the migration module matches neither known shape", () => {
    describe("#when the patch runs", () => {
      test("#then it fails loud instead of leaving a stealing migrate in place", () => {
        const root = writeMigration("export function migrateLegacySenpiDirs() {}\n")
        expect(() => patchLegacyPiDirMigration(root)).toThrow(
          `omo-ai: unsupported Senpi ${LEGACY_PI_DIR_MIGRATION_RELATIVE}`,
        )
      })
    })
  })

  describe("#given the currently pinned Senpi package", () => {
    describe("#when its published migration is inspected", () => {
      test("#then it still contains the live .pi moves this guard rewrites", () => {
        expect(readFileSync(INSTALLED_MIGRATION, "utf8")).toContain(LIVE_PI_DIR_MOVES)
      })
    })
  })
})
