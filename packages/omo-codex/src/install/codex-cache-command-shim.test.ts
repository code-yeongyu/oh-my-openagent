import { expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginBins, linkRootRuntimeBin } from "./codex-cache-bins"

const windowsTest = process.platform === "win32" ? test : test.skip

for (const surface of ["root", "cached"] as const) {
  for (const source of ["environment", "config"] as const) {
    windowsTest(`${surface} shim executes a quoted runtime path with spaces from ${source}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "omo quoted runtime "))
      try {
        const codexHome = join(root, "codex")
        const binDir = join(root, "bin")
        const repoRoot = join(root, "repo")
        await mkdir(codexHome, { recursive: true })
        await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
        await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true })
        const target = 'console.log(JSON.stringify(process.argv.slice(2)))\n'
        await writeFile(join(repoRoot, "dist", "cli", "index.js"), target)
        await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), target)
        await writeFile(join(repoRoot, "package.json"), JSON.stringify({ bin: { "omo-hook": "dist/cli/index.js" } }))
        const runtime = join(root, "bun.exe")
        await copyFile(process.execPath, runtime)
        if (source === "config") {
          await writeFile(join(codexHome, "config.toml"), `[mcp_servers.test.env]\nNODE_REPL_NODE_PATH = "${runtime.replaceAll("\\", "/")}"\n`)
        }
        const link = surface === "root"
          ? await linkRootRuntimeBin({ repoRoot, binDir, codexHome })
          : (await linkCachedPluginBins({ pluginRoot: repoRoot, binDir }))[0]
        if (!link) throw new Error("missing shim")
        const child = Bun.spawn(["cmd.exe", "/d", "/c", "call", link.path, "--probe", "two words"], {
          env: { ...process.env, CODEX_HOME: codexHome, NODE_REPL_NODE_PATH: source === "environment" ? `"${runtime}"` : "", OMO_RUNTIME: "node" },
          stdout: "pipe", stderr: "pipe",
        })
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
        expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
        expect(JSON.parse(stdout)).toEqual(["--probe", "two words"])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}
