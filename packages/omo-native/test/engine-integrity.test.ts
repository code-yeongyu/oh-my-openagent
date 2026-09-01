import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveSenpi, updateTarget } from "../bin/lib/package-paths.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type EngineFixtureOptions = {
  cli?: boolean
  brandModule?: boolean
}

/**
 * A minimal on-disk engine install shaped like the published package: the resolver hands the
 * launcher `dist/index.js`, and the launcher derives every sibling it preflights from there. The
 * corrupted variants mirror real partially-reified npm trees seen in the wild, where an interrupted
 * upgrade keeps some dist files and loses others.
 */
function createEngineFixture(options: EngineFixtureOptions = {}): { indexPath: string; senpiRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-engine-integrity-"))
  roots.push(root)
  const senpiRoot = join(root, "node_modules", "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.25" }))
  const indexPath = join(senpiRoot, "dist", "index.js")
  writeFile(indexPath, "export {}\n")
  if (options.cli !== false) writeFile(join(senpiRoot, "dist", "cli.js"), "export {}\n")
  if (options.brandModule !== false) writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  return { indexPath, senpiRoot }
}

function resolveError(fixtureIndexPath: string, platform: string): Error {
  try {
    resolveSenpi({ resolveIndex: () => fixtureIndexPath, platform })
  } catch (error) {
    return error as Error
  }
  throw new Error("expected resolveSenpi to refuse the fixture install")
}

const REINSTALL_COMMAND = updateTarget().command

describe("engine install integrity", () => {
  describe("#given a partially reified install missing the brand contract module", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then it refuses with the missing path, the partial-install diagnosis, and the reinstall command", () => {
        const { indexPath, senpiRoot } = createEngineFixture({ brandModule: false })

        const error = resolveError(indexPath, "darwin")

        expect(error.message).toContain(join(senpiRoot, "dist", "core", "brand.js"))
        expect(error.message).toContain("incomplete")
        expect(error.message).toContain("interrupted")
        expect(error.message).toContain(`reinstall with: ${REINSTALL_COMMAND}`)
      })

      test("#then win32 adds the locked-native-module hint", () => {
        const { indexPath } = createEngineFixture({ brandModule: false })

        const error = resolveError(indexPath, "win32")

        expect(error.message).toContain("EBUSY")
        expect(error.message).toContain("locks loaded native modules")
      })

      test("#then posix keeps the message free of the windows hint", () => {
        const { indexPath } = createEngineFixture({ brandModule: false })

        const error = resolveError(indexPath, "linux")

        expect(error.message).not.toContain("EBUSY")
      })
    })
  })

  describe("#given an intact engine install", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then it hands back the cli path and package root unchanged", () => {
        const { indexPath, senpiRoot } = createEngineFixture()

        const resolved = resolveSenpi({ resolveIndex: () => indexPath, platform: "win32" })

        expect(resolved).toEqual({
          cliPath: join(senpiRoot, "dist", "cli.js"),
          packageRoot: senpiRoot,
        })
      })
    })
  })

  describe("#given an install missing the engine CLI entirely", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then the established missing-CLI message is preserved", () => {
        const { indexPath, senpiRoot } = createEngineFixture({ cli: false })

        const error = resolveError(indexPath, "darwin")

        expect(error.message).toBe(
          `senpi CLI is missing at ${join(senpiRoot, "dist", "cli.js")}; reinstall with: ${REINSTALL_COMMAND}`,
        )
      })
    })
  })
})
