import { expect, test } from "bun:test"
import { copyFile, link, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginBins, linkRootRuntimeBin } from "./codex-cache-bins"

// #11230: "bang-node-path" names a Node path containing `!` and removes node from PATH, so only the configured
// path can run the target; the target echoes its argument, which carries a `!` through `%*` too.
for (const config of ["quoted-node-path", "without-node-path", "missing-config", "bang-node-path"] as const) {
  test(`#7473 generated Windows .cmd shims execute targets with ${config}`, async () => {
    if (process.platform !== "win32") return

    const root = await mkdtemp(join(tmpdir(), "omo windows shim "))
    try {
      const codexHome = join(root, "codex")
      const binDir = join(codexHome, "bin")
      const repoRoot = join(root, "repo")
      const pluginRoot = join(root, "plugin")
      const sentinel = "OMO_WINDOWS_SHIM_TARGET_RAN"
      const target = `console.log(${JSON.stringify(sentinel)} + (process.argv[2] ?? ""))\n`
      await mkdir(codexHome, { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true })
      await mkdir(pluginRoot, { recursive: true })
      await writeFile(join(repoRoot, "dist", "cli", "index.js"), target)
      await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), target)
      await writeFile(join(pluginRoot, "target.cjs"), target)
      await writeFile(
        join(pluginRoot, "package.json"),
        JSON.stringify({
          name: "windows-shim-fixture",
          bin: {
            "omo-ulw-loop": "target.cjs",
            ulw: "target.cjs",
            "omo-git-bash-hook": "target.cjs",
          },
        }),
      )
      const node = Bun.which("node")
      if (node === null) throw new Error("Windows shim proof requires node on PATH")
      let configuredNode = node
      if (config === "bang-node-path") {
        const bangDir = join(root, "node!bang")
        await mkdir(bangDir)
        configuredNode = join(bangDir, "node.exe")
        await link(node, configuredNode).catch(() => copyFile(node, configuredNode))
      }
      if (config !== "missing-config") {
        await writeFile(
          join(codexHome, "config.toml"),
          config === "quoted-node-path" || config === "bang-node-path"
            ? `NODE_REPL_NODE_PATH = ${JSON.stringify(configuredNode.replaceAll("\\", "/"))}\n`
            : 'model = "synthetic-test-model"\n',
        )
      }
      const runtime = await linkRootRuntimeBin({ repoRoot, binDir, codexHome, platform: "win32" })
      if (runtime === null) throw new Error("expected generated runtime wrapper")
      const commands = await linkCachedPluginBins({ pluginRoot, binDir, platform: "win32" })
      expect(commands).toHaveLength(3)
      const env = { ...process.env, CODEX_HOME: codexHome, OMO_RUNTIME: "node" }
      for (const key of Object.keys(env)) {
        const upper = key.toUpperCase()
        if (upper === "NODE_REPL_NODE_PATH" || (config === "bang-node-path" && upper === "PATH"))
          Reflect.deleteProperty(env, key)
      }
      if (config === "bang-node-path") env.Path = join(process.env.SystemRoot ?? "C:\\Windows", "System32")
      const argument = config === "bang-node-path" ? "arg!bang" : ""

      for (const shim of [runtime, ...commands]) {
        const child = Bun.spawn(["cmd.exe", "/d", "/c", `${shim.name}.cmd`, ...(argument ? [argument] : [])], {
          cwd: binDir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        console.log(
          `#7473 ${config} ${shim.name}: exit=${exitCode} stdout=${JSON.stringify(stdout.trim())} stderr=${JSON.stringify(stderr.trim())}`,
        )
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
        expect(stdout.trim()).toBe(sentinel + argument)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}
