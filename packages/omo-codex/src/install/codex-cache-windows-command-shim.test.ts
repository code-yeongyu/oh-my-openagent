import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { linkCachedPluginBins, linkRootRuntimeBin } from "./codex-cache-bins"

for (const config of ["quoted-node-path", "without-node-path", "missing-config"] as const) {
  test(`#7473 generated Windows .cmd shims execute targets with ${config}`, async () => {
    if (process.platform !== "win32") return

    const root = await mkdtemp(join(tmpdir(), "omo windows shim "))
    try {
      const codexHome = join(root, "codex")
      const binDir = join(codexHome, "bin")
      const repoRoot = join(root, "repo")
      const pluginRoot = join(root, "plugin")
      const sentinel = "OMO_WINDOWS_SHIM_TARGET_RAN"
      const target = `console.log(${JSON.stringify(sentinel)})\n`
      await mkdir(codexHome, { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true })
      await mkdir(pluginRoot, { recursive: true })
      await writeFile(join(repoRoot, "dist", "cli", "index.js"), target)
      await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), target)
      await writeFile(join(pluginRoot, "target.cjs"), target)
      await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
        name: "windows-shim-fixture",
        bin: {
          "omo-ulw-loop": "target.cjs",
          ulw: "target.cjs",
          "omo-git-bash-hook": "target.cjs",
        },
      }))
      const node = Bun.which("node")
      if (node === null) throw new Error("Windows shim proof requires node on PATH")
      if (config !== "missing-config") {
        await writeFile(join(codexHome, "config.toml"), config === "quoted-node-path"
          ? `NODE_REPL_NODE_PATH = ${JSON.stringify(node.replaceAll("\\", "/"))}\n`
          : 'model = "synthetic-test-model"\n')
      }
      const runtime = await linkRootRuntimeBin({ repoRoot, binDir, codexHome, platform: "win32" })
      if (runtime === null) throw new Error("expected generated runtime wrapper")
      const commands = await linkCachedPluginBins({ pluginRoot, binDir, platform: "win32" })
      expect(commands).toHaveLength(3)
      const env = { ...process.env, CODEX_HOME: codexHome, OMO_RUNTIME: "node" }
      for (const key of Object.keys(env)) {
        if (key.toUpperCase() === "NODE_REPL_NODE_PATH") Reflect.deleteProperty(env, key)
      }

      for (const shim of [runtime, ...commands]) {
        const child = Bun.spawn(["cmd.exe", "/d", "/c", `${shim.name}.cmd`], {
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
        console.log(`#7473 ${config} ${shim.name}: exit=${exitCode} stdout=${JSON.stringify(stdout.trim())} stderr=${JSON.stringify(stderr.trim())}`)
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
        expect(stdout.trim()).toBe(sentinel)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}

test("generated Windows toolkit wrapper forwards ulw-loop arguments once and returns the ulw-loop exit code", async () => {
  if (process.platform !== "win32") return

  const root = await mkdtemp(join(tmpdir(), "omo windows toolkit ulw-loop "))
  try {
    const codexHome = join(root, "codex")
    const binDir = join(codexHome, "bin")
    const repoRoot = join(root, "repo")
    const pluginRoot = join(root, "plugin")
    await mkdir(codexHome, { recursive: true })
    await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(repoRoot, "dist", "cli", "index.js"), "process.exit(99)\n")
    await writeFile(join(pluginRoot, "ulw-loop.cjs"), "console.log(JSON.stringify(process.argv.slice(2)))\nprocess.exit(7)\n")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "windows-toolkit-ulw-loop-fixture",
      bin: { "omo-ulw-loop": "ulw-loop.cjs" },
    }))
    const runtime = await linkRootRuntimeBin({ repoRoot, binDir, codexHome, platform: "win32" })
    if (runtime === null) throw new Error("expected generated runtime wrapper")
    await linkCachedPluginBins({ pluginRoot, binDir, platform: "win32" })

    const child = Bun.spawn(["cmd.exe", "/d", "/c", `${runtime.name}.cmd`, "ulw-loop", "status", "--session-id", "s1", "--json"], {
      cwd: binDir,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect({ argv: JSON.parse(stdout.trim()), exitCode, stderr }).toEqual({
      argv: ["ulw-loop", "status", "--session-id", "s1", "--json"],
      exitCode: 7,
      stderr: "",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

for (const branch of ["OMO_RUNTIME=node", "no bun on PATH"] as const) {
  test(`generated Windows toolkit wrapper returns the node CLI exit code with ${branch}`, async () => {
    if (process.platform !== "win32") return

    const root = await mkdtemp(join(tmpdir(), "omo windows toolkit node "))
    try {
      const codexHome = join(root, "codex")
      const binDir = join(codexHome, "bin")
      const repoRoot = join(root, "repo")
      const profile = join(root, "profile")
      await mkdir(codexHome, { recursive: true })
      await mkdir(profile, { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli"), { recursive: true })
      await mkdir(join(repoRoot, "dist", "cli-node"), { recursive: true })
      await writeFile(join(repoRoot, "dist", "cli", "index.js"), "process.exit(99)\n")
      await writeFile(join(repoRoot, "dist", "cli-node", "index.js"), "console.log(JSON.stringify(process.argv.slice(2)))\nprocess.exit(7)\n")
      const node = Bun.which("node")
      if (node === null) throw new Error("Windows wrapper proof requires node on PATH")
      if (Bun.which("bun", { PATH: dirname(node) }) !== null) throw new Error("node's directory must not hold bun for the no-bun case")
      const runtime = await linkRootRuntimeBin({ repoRoot, binDir, codexHome, platform: "win32" })
      if (runtime === null) throw new Error("expected generated runtime wrapper")

      const env: Record<string, string | undefined> = { ...process.env, CODEX_HOME: codexHome }
      for (const key of Object.keys(env)) {
        const upper = key.toUpperCase()
        if (upper === "NODE_REPL_NODE_PATH" || upper === "BUN_BINARY" || upper === "OMO_RUNTIME") Reflect.deleteProperty(env, key)
        if (branch === "no bun on PATH" && (upper === "PATH" || upper === "USERPROFILE")) Reflect.deleteProperty(env, key)
      }
      if (branch === "OMO_RUNTIME=node") env.OMO_RUNTIME = "node"
      else {
        env.PATH = `${dirname(node)};${join(process.env.SystemRoot ?? "C:\\Windows", "System32")}`
        env.USERPROFILE = profile
      }

      const child = Bun.spawn(["cmd.exe", "/d", "/c", `${runtime.name}.cmd`, "doctor", "--json"], {
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

      expect({ argv: JSON.parse(stdout.trim()), exitCode, stderr }).toEqual({
        argv: ["doctor", "--json"],
        exitCode: 7,
        stderr: "",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}

