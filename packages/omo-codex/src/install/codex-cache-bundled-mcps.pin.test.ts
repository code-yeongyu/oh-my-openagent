import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { copyBundledMcpRuntimeDists } from "./codex-cache-bundled-mcps"

describe("copyBundledMcpRuntimeDists", () => {
  test("#given the current Codex MCP manifest #when copying bundled runtimes #then it pins the copied runtime set", async () => {
    // given
    const tempRoot = await mkdtemp(join(tmpdir(), "codex-bundled-mcps-"))
    const sourceRoot = join(tempRoot, "packages", "omo-codex", "plugin")
    const pluginRoot = join(tempRoot, "cache", "plugin")
    const runtimeRoots = [
      "../../ast-grep-mcp/dist",
      "../../git-bash-mcp/dist",
      "../../lsp-daemon/dist",
      "../../lsp-tools-mcp/dist",
    ] as const

    try {
      await mkdir(sourceRoot, { recursive: true })
      await writeFile(
        join(sourceRoot, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            ast_grep: { args: ["../../ast-grep-mcp/dist/cli.js", "mcp"] },
            git_bash: { args: ["../../git-bash-mcp/dist/cli.js", "mcp"] },
            lsp: { args: ["../../lsp-daemon/dist/cli.js", "mcp"] },
          },
        }),
      )

      for (const runtimeRoot of runtimeRoots) {
        const distRoot = join(sourceRoot, runtimeRoot)
        await mkdir(distRoot, { recursive: true })
        await writeFile(join(distRoot, "cli.js"), `console.log(${JSON.stringify(runtimeRoot)})\n`)
      }

      // when
      await copyBundledMcpRuntimeDists({ pluginRoot, sourceRoot })

      // then
      const copiedComponents = await readdir(join(pluginRoot, "components"))
      expect(copiedComponents.sort()).toEqual(["ast-grep-mcp", "git-bash-mcp", "lsp-daemon"])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
