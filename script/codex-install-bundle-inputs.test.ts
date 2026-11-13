import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { buildCodexInstaller } from "./build-codex-install"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const outputDirectory = mkdtempSync(join(tmpdir(), "codex-install-bundle-inputs-"))

afterAll(() => {
  rmSync(outputDirectory, { recursive: true, force: true })
})

function harnessIds(source: string): string | undefined {
  return /OMO_CONFIG_HARNESS_IDS = (\[[^\]]*\])/.exec(source)?.[1]
}

describe("the Codex installer bundle tracks its transitive inputs", () => {
  // The bundle INLINES workspace dependencies, but the freshness digest walks only
  // packages/omo-codex/src/install. omo#8620 renamed the harness ids in omo-config-core and the inlined copy went
  // stale. Feature PRs no longer commit the bundle (#9903), so this builds a throwaway copy from the current sources
  // and proves the inlined ids follow omo-config-core.
  test("#given a fresh build #when its inlined harness ids are read #then they match the current config source", async () => {
    // given
    const bundlePath = await buildCodexInstaller({ outputPath: join(outputDirectory, "install-local.mjs") })
    const source = await readFile(join(repositoryRoot, "packages/omo-config-core/src/schema/harness.ts"), "utf8")

    // when
    const bundled = harnessIds(await readFile(bundlePath, "utf8"))
    const current = harnessIds(source)

    // then
    expect(current).toBeDefined()
    expect(bundled).toBe(current as string)
  }, 60_000)
})
