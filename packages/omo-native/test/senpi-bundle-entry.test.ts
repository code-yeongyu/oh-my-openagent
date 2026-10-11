import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveSenpi, updateTarget } from "../bin/lib/package-paths.js"

/**
 * senpi ships a pre-linked esbuild bundle of its CLI at `dist/bundle/cli.js`: one file instead of
 * the module graph `dist/cli.js` pulls in, so the engine boot skips hundreds of resolutions. The
 * launcher must prefer it when the INSTALLED engine carries it, and an engine without it must
 * resolve exactly as it does today - the pin is upgraded independently of this launcher.
 */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type EngineFixtureOptions = {
  bundle?: boolean
  brandModule?: boolean
}

function createEngineFixture(options: EngineFixtureOptions = {}): { indexPath: string; senpiRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-bundle-"))
  roots.push(root)
  const senpiRoot = join(root, "node_modules", "@code-yeongyu", "senpi")
  writeFile(join(senpiRoot, "package.json"), JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.9.17" }))
  const indexPath = join(senpiRoot, "dist", "index.js")
  writeFile(indexPath, "export {}\n")
  writeFile(join(senpiRoot, "dist", "cli.js"), "export {}\n")
  if (options.bundle === true) writeFile(join(senpiRoot, "dist", "bundle", "cli.js"), "export {}\n")
  if (options.brandModule !== false) writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  return { indexPath, senpiRoot }
}

describe("senpi engine entry resolution", () => {
  describe("#given an installed engine that ships the pre-linked bundle", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then the bundle is the CLI it spawns", () => {
        // given
        const { indexPath, senpiRoot } = createEngineFixture({ bundle: true })

        // when
        const resolved = resolveSenpi({ resolveIndex: () => indexPath, platform: "darwin" })

        // then
        expect(resolved).toEqual({
          cliPath: join(senpiRoot, "dist", "bundle", "cli.js"),
          packageRoot: senpiRoot,
        })
      })
    })
  })

  describe("#given an installed engine without the bundle", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then it resolves the unbundled CLI exactly as before", () => {
        // given
        const { indexPath, senpiRoot } = createEngineFixture()

        // when
        const resolved = resolveSenpi({ resolveIndex: () => indexPath, platform: "darwin" })

        // then
        expect(resolved).toEqual({
          cliPath: join(senpiRoot, "dist", "cli.js"),
          packageRoot: senpiRoot,
        })
      })
    })
  })

  describe("#given a bundled engine whose brand contract module is missing", () => {
    describe("#when the launcher resolves the engine", () => {
      test("#then the incomplete-engine refusal still fires", () => {
        // given - a bundled CLI says nothing about the rest of the tree being reified
        const { indexPath, senpiRoot } = createEngineFixture({ bundle: true, brandModule: false })

        // when
        let error: Error | undefined
        try {
          resolveSenpi({ resolveIndex: () => indexPath, platform: "darwin" })
        } catch (thrown) {
          error = thrown as Error
        }

        // then
        expect(error?.message).toContain(join(senpiRoot, "dist", "core", "brand.js"))
        expect(error?.message).toContain("senpi engine files are incomplete")
        expect(error?.message).toContain(`reinstall with: ${updateTarget().command}`)
      })
    })
  })
})
