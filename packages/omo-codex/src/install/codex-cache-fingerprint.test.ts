import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveCommentCheckerBinary } from "../../../comment-checker-core/src/runner"
import { installCachedPlugin } from "./codex-cache-install"
import type { RunCommand } from "./types"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function specialEntries(root: string, directory = root): Promise<string[]> {
  const paths: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const entry = await lstat(path)
    if (entry.isDirectory()) paths.push(...await specialEntries(root, path))
    else if (!entry.isFile()) paths.push(relative(root, path))
  }
  return paths.sort()
}

async function assemblePlugin() {
  const root = await mkdtemp(join(tmpdir(), "codex-fingerprint-"))
  roots.push(root)
  const sourcePath = join(root, "source")
  const previous = join(root, "home", "plugins", "cache", "sisyphuslabs", "omo", "0.9.0")
  await mkdir(previous, { recursive: true })
  await writeFile(join(previous, "payload.txt"), "old plugin")
  const component = join(sourcePath, "components", "comment-checker")
  const shared = join(root, "shared-skills")
  await mkdir(shared, { recursive: true })
  await writeFile(join(shared, "package.json"), JSON.stringify({ name: "@oh-my-opencode/shared-skills" }))
  await writeFile(join(shared, "index.mjs"), "export const skills = []\n")
  await mkdir(join(shared, "node_modules", ".bin"), { recursive: true })
  await writeFile(join(shared, "node_modules", ".bin", "other-tool.cmd"), "@echo off\r\necho preserved\r\n")
  if (process.platform !== "win32") {
    await symlink("../../index.mjs", join(shared, "node_modules", ".bin", "linked-tool"))
  }
  await mkdir(join(component, "dist"), { recursive: true })
  await writeFile(join(sourcePath, "package.json"), JSON.stringify({ name: "omo", version: "1.0.0" }))
  await writeFile(join(component, "package.json"), JSON.stringify({
    name: "@code-yeongyu/codex-comment-checker",
    bin: { "omo-comment-checker": "dist/cli.js" },
  }))
  await writeFile(join(component, "dist", "cli.js"), "#!/usr/bin/env node\n")
  const runCommand: RunCommand = async (_command, _args, options) => {
    const modules = join(options.cwd, "node_modules")
    const checker = join(modules, "@code-yeongyu", "comment-checker")
    const platformName = `comment-checker-${process.platform}-${process.arch}`
    await mkdir(join(checker, "bin"), { recursive: true })
    await writeFile(join(checker, "package.json"), JSON.stringify({ name: "@code-yeongyu/comment-checker" }))
    await writeFile(join(checker, "bin", "comment-checker.js"), "#!/usr/bin/env node\n")
    await mkdir(join(modules, "@code-yeongyu", platformName, "bin"), { recursive: true })
    await writeFile(join(modules, "@code-yeongyu", platformName, "package.json"), JSON.stringify({ name: `@code-yeongyu/${platformName}` }))
    const binary = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
    await writeFile(join(modules, "@code-yeongyu", platformName, "bin", binary), "native checker fixture")
    await chmod(join(modules, "@code-yeongyu", platformName, "bin", binary), 0o755)
    await mkdir(join(modules, ".bin"), { recursive: true })
    await writeFile(join(modules, ".bin", "other-tool.cmd"), "@echo off\r\necho preserved\r\n")
    if (process.platform === "win32") {
      await writeFile(join(modules, ".bin", "comment-checker.cmd"), "@echo off\r\n")
    } else {
      await symlink("../@code-yeongyu/comment-checker/bin/comment-checker.js", join(modules, ".bin", "comment-checker"))
    }
    const workspace = join(options.cwd, "components", "comment-checker")
    await symlink(workspace, join(modules, "@code-yeongyu", "codex-comment-checker"), process.platform === "win32" ? "junction" : "dir")
    await mkdir(join(modules, "@oh-my-opencode"), { recursive: true })
    await symlink(shared, join(modules, "@oh-my-opencode", "shared-skills"), process.platform === "win32" ? "junction" : "dir")
  }
  const installed = await installCachedPlugin({
    buildSource: false,
    codexHome: join(root, "home"),
    marketplaceName: "sisyphuslabs",
    name: "omo",
    sourcePath,
    version: "1.0.0",
    runCommand,
  })
  await rm(shared, { recursive: true })
  expect(await readFile(join(installed.path, "node_modules", "@oh-my-opencode", "shared-skills", "index.mjs"), "utf8")).toBe("export const skills = []\n")
  expect(existsSync(previous)).toBe(false)
  return installed.path
}

test("assembled plugin contains only regular files and directories after npm creates links", async () => {
  const plugin = await assemblePlugin()
  expect(await specialEntries(plugin)).toEqual([])
})

test("assembled plugin removes npm bin symlinks while preserving regular third-party command shims", async () => {
  const plugin = await assemblePlugin()
  expect(await readFile(join(plugin, "node_modules", ".bin", "other-tool.cmd"), "utf8")).toBe("@echo off\r\necho preserved\r\n")
  const dependencyBins = join(plugin, "node_modules", "@oh-my-opencode", "shared-skills", "node_modules", ".bin")
  expect(await readFile(join(dependencyBins, "other-tool.cmd"), "utf8")).toBe("@echo off\r\necho preserved\r\n")
  if (process.platform !== "win32") {
    await expect(lstat(join(plugin, "node_modules", ".bin", "comment-checker"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(join(dependencyBins, "linked-tool"))).rejects.toMatchObject({ code: "ENOENT" })
  }
  expect(await specialEntries(plugin)).toEqual([])
})

test.if(process.platform !== "win32")("special file aborts assembly before replacing the active plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-special-file-"))
  roots.push(root)
  const sourcePath = join(root, "source")
  const codexHome = join(root, "home")
  const previous = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0")
  await mkdir(sourcePath, { recursive: true })
  await mkdir(previous, { recursive: true })
  await writeFile(join(previous, "payload.txt"), "previous working plugin")
  await writeFile(join(sourcePath, "package.json"), JSON.stringify({ name: "omo", version: "1.0.0" }))
  await expect(installCachedPlugin({
    buildSource: false,
    codexHome,
    marketplaceName: "sisyphuslabs",
    name: "omo",
    sourcePath,
    version: "1.0.0",
    runCommand: async (_command, _args, options) => {
      const child = Bun.spawn(["mkfifo", join(options.cwd, "bad.pipe")])
      expect(await child.exited).toBe(0)
    },
  })).rejects.toThrow("bad.pipe")
  expect(await readFile(join(previous, "payload.txt"), "utf8")).toBe("previous working plugin")
  expect(await readdir(join(previous, ".."))).toEqual(["1.0.0"])
})

test("assembled comment hook still resolves its CLI and optional native checker without npm bin links", async () => {
  const plugin = await assemblePlugin()
  const cli = join(plugin, "components", "comment-checker", "dist", "cli.js")
  expect((await lstat(cli)).isFile()).toBe(true)
  const binaryName = process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
  const binary = resolveCommentCheckerBinary({
    binaryName,
    cachedBinaryPath: null,
    existsSync,
    importMetaUrl: pathToFileURL(cli).href,
  })
  expect(binary).toBe(join(plugin, "node_modules", "@code-yeongyu", `comment-checker-${process.platform}-${process.arch}`, "bin", binaryName))
  if (binary === null) throw new Error("native checker was not resolved")
  expect(await readFile(binary, "utf8")).toBe("native checker fixture")
  expect((await lstat(join(plugin, "node_modules", "@code-yeongyu", "codex-comment-checker"))).isDirectory()).toBe(true)
  expect(await specialEntries(plugin)).toEqual([])
})
