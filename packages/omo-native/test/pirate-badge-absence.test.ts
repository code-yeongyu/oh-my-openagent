import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import manifest from "../package.json"

const packageRoot = resolve(import.meta.dir, "..")
const senpiBadgeGateManifests = [
  join("packages", "omo-senpi", "package.json"),
  join("packages", "senpi-task", "package.json"),
]

function collectDirectoryNames(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (!statSync(full).isDirectory()) continue
      found.push(entry)
      walk(full)
    }
  }
  walk(root)
  return found
}

describe("omo native footer badge absence for omo-ai installs", () => {
  describe("#given the published omo-ai payload", () => {
    describe("#when the shipped file set is inspected", () => {
      test("#then the payload ships only bin and plugin, never a workspace packages tree", () => {
        expect(manifest.files).toEqual(["bin", "plugin"])
        expect(manifest.files).not.toContain("packages")
      })

      test("#then no shipped directory carries a senpi badge gate manifest", () => {
        for (const shipped of manifest.files) {
          const shippedRoot = join(packageRoot, shipped)
          for (const gateManifest of senpiBadgeGateManifests) {
            expect(existsSync(join(shippedRoot, gateManifest))).toBe(false)
          }
          expect(collectDirectoryNames(shippedRoot)).not.toContain("packages")
        }
      })
    })
  })
})
