/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"

const INSTALL_CODEX_CODEGRAPH_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

describe("install-codex CodeGraph MCP policy", () => {
  test("#given unavailable CodeGraph Node runtime #when installing omo #then disables only the codegraph MCP policy", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-codegraph-node-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-codegraph-node-"))
    const repoRoot = await createRepoWithBuiltComponentBins()
    const missingNode = join(await mkdtemp(join(tmpdir(), "omo-codex-codegraph-node-bin-")), "missing-node")

    // when
    await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      env: { CODEGRAPH_NODE_BIN: missingNode },
      astGrepInstaller: async () => ({ kind: "skipped", reason: "test" }),
      runCommand: async () => undefined,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toMatch(/\[plugins\."omo@sisyphuslabs"\][\s\S]*?enabled = true/)
    expect(configContent).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.codegraph\][\s\S]*?enabled = false/)
    expect(configContent).toMatch(/\[plugins\."omo@sisyphuslabs"\.mcp_servers\.context7\][\s\S]*?enabled = true/)
  }, { timeout: INSTALL_CODEX_CODEGRAPH_TEST_TIMEOUT_MS })
})
