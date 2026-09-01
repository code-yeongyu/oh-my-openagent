import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  findNewestCachedCodexComponentCli,
  resolveCachedCodexComponentCliPath,
  resolveCodexComponentBinCandidates,
  resolveCodexPluginCacheRoot,
} from "./codex-cache-paths"

describe("codex cache path helpers", () => {
  test("resolves the canonical OMO plugin cache root", () => {
    // given
    const codexHome = join(tmpdir(), `omo-codex-cache-root-${randomUUID()}`)

    // when
    const cacheRoot = resolveCodexPluginCacheRoot(codexHome)

    // then
    expect(cacheRoot).toBe(join(codexHome, "plugins", "cache", "sisyphuslabs", "omo"))
  })

  test("resolves cached component CLI paths under a plugin version root", () => {
    // given
    const pluginRoot = join(tmpdir(), `omo-codex-plugin-root-${randomUUID()}`, "4.9.2")

    // when
    const cliPath = resolveCachedCodexComponentCliPath(pluginRoot, "ulw-loop")

    // then
    expect(cliPath).toBe(join(pluginRoot, "components", "ulw-loop", "dist", "cli.js"))
  })

  test("selects the newest cached component CLI from an OMO cache tree", () => {
    // given
    const root = join(tmpdir(), `omo-codex-cache-newest-${randomUUID()}`)
    const oldCli = join(root, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0", "components", "ulw-loop", "dist", "cli.js")
    const newCli = join(root, "plugins", "cache", "sisyphuslabs", "omo", "0.2.0", "components", "ulw-loop", "dist", "cli.js")
    mkdirSync(dirname(oldCli), { recursive: true })
    mkdirSync(dirname(newCli), { recursive: true })
    writeFileSync(oldCli, "#!/usr/bin/env node\n")
    writeFileSync(newCli, "#!/usr/bin/env node\n")

    // when
    const cliPath = findNewestCachedCodexComponentCli({ codexHome: root, componentName: "ulw-loop" })

    // then
    expect(cliPath).toBe(newCli)
  })

  test("preserves legacy component bin lookup priority", () => {
    // given
    const root = join(tmpdir(), `omo-codex-bin-candidates-${randomUUID()}`)
    const explicitBinDir = join(root, "explicit-bin")

    // when
    const candidates = resolveCodexComponentBinCandidates({
      executableName: "omo-ulw-loop",
      env: { CODEX_LOCAL_BIN_DIR: explicitBinDir },
      homeDir: root,
    })

    // then
    expect(candidates).toEqual([
      join(explicitBinDir, "omo-ulw-loop"),
      join(root, ".local", "bin", "omo-ulw-loop"),
      join(root, ".codex", "bin", "omo-ulw-loop"),
    ])
  })
})
