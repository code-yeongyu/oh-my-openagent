import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  OMO_OMP_PACKAGE_NAME,
  ensurePluginArtifacts,
  resolveInstallContext,
  runOmpInstaller,
  runOmpUninstaller,
} from "./install-omp"

function makeFakePlugin(repoRoot: string): string {
  const pluginPath = join(repoRoot, "packages", "omo-omp", "plugin")
  for (const artifact of [
    join(pluginPath, "extensions", "omo.js"),
    join(pluginPath, "runtime", "lsp-daemon", "dist", "cli.js"),
    join(pluginPath, "skills", "ultrawork", "SKILL.md"),
    join(pluginPath, "scripts", "install.mjs"),
  ]) {
    mkdirSync(dirname(artifact), { recursive: true })
    writeFileSync(artifact, "stub")
  }
  const runtimeDir = join(pluginPath, "runtime", "ast-grep-mcp")
  mkdirSync(runtimeDir, { recursive: true })
  const runtimeBody = "#!/usr/bin/env node\n// stub runtime"
  writeFileSync(join(runtimeDir, "cli.js"), runtimeBody)
  writeFileSync(join(runtimeDir, "manifest.json"), JSON.stringify({
    sha256: createHash("sha256").update(runtimeBody).digest("hex"),
    mode: 0o755,
    stagedAtUtc: "2026-08-11T00:00:00.000Z",
  }))
  return pluginPath
}

function makeContext(overrides: Record<string, unknown> = {}): ReturnType<typeof resolveInstallContext> & {
  recorded: Array<{ command: string; args: readonly string[] }>
} {
  const repoRoot = overrides.repoRoot as string
  const recorded: Array<{ command: string; args: readonly string[] }> = []
  const context = resolveInstallContext({
    repoRoot,
    pluginPath: join(repoRoot, "packages", "omo-omp", "plugin"),
    agentDir: join(repoRoot, "agent"),
    ompBin: overrides.ompBin as string | undefined,
    runCommand: async (command, args) => {
      recorded.push({ command, args })
    },
  })
  return Object.assign(context, { recorded }) as ReturnType<typeof resolveInstallContext> & {
    recorded: Array<{ command: string; args: readonly string[] }>
  }
}

async function withFakeRepo(fn: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(join(tmpdir(), "omo-omp-install-"))
  try {
    await fn(repoRoot)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
}

describe("omo-omp installer", () => {
  test("#given default options #when resolving context #then it points at the omp agent dir", () => {
    const context = resolveInstallContext({
      repoRoot: process.cwd(),
      pluginPath: resolve(process.cwd(), "packages", "omo-omp", "plugin"),
      agentDir: "/tmp/x",
      ompBin: "omp",
    })
    expect(context.agentDir).toBe(resolve("/tmp/x"))
    expect(context.ompBin).toBe("omp")
    expect(context.allowBuild).toBe(false)
  })

  test("#given a packed plugin #when installing with the omp CLI available #then omp plugin install is invoked", async () => {
    await withFakeRepo(async (repoRoot) => {
      makeFakePlugin(repoRoot)
      const context = makeContext({ repoRoot, ompBin: "omp" })
      const result = await runOmpInstaller({
        repoRoot,
        pluginPath: context.pluginPath,
        agentDir: context.agentDir,
        ompBin: "omp",
        runCommand: context.runCommand,
        platform: "win32",
      })
      expect(result.ok).toBe(true)
      expect(result.registration).toBe("omp-cli")
      expect(context.recorded.some((entry) => entry.args[0] === "plugin" && entry.args[1] === "install")).toBe(true)
    })
  })

  test("#given a packed plugin #when installing without the omp CLI #then config.yml extensions are written with a backup", async () => {
    await withFakeRepo(async (repoRoot) => {
      makeFakePlugin(repoRoot)
      const context = makeContext({ repoRoot, ompBin: "__no_such_omp_bin__" })
      const result = await runOmpInstaller({
        repoRoot,
        pluginPath: context.pluginPath,
        agentDir: context.agentDir,
        ompBin: "__no_such_omp_bin__",
        runCommand: context.runCommand,
        platform: "win32",
      })
      expect(result.ok).toBe(true)
      expect(result.registration).toBe("config-yml")
      const configPath = join(context.agentDir, "config.yml")
      const config = await readFile(configPath, "utf8")
      expect(config).toContain("extensions:")
      expect(config).toContain(context.pluginPath.replaceAll("\\", "/"))
    })
  })

  test("#given an existing config.yml with extensions #when uninstalling via config fallback #then the entry is removed", async () => {
    await withFakeRepo(async (repoRoot) => {
      makeFakePlugin(repoRoot)
      const context = makeContext({ repoRoot, ompBin: "__no_such_omp_bin__" })
      const configPath = join(context.agentDir, "config.yml")
      mkdirSync(context.agentDir, { recursive: true })
      const entry = context.pluginPath
      await writeFile(configPath, `theme:\n  dark: opencode\nextensions:\n  - ${entry}\n`)
      const result = await runOmpUninstaller({
        repoRoot,
        pluginPath: context.pluginPath,
        agentDir: context.agentDir,
        ompBin: "__no_such_omp_bin__",
        runCommand: context.runCommand,
        platform: "win32",
      })
      expect(result.ok).toBe(true)
      const config = await readFile(configPath, "utf8")
      expect(config).not.toContain(entry)
      expect(config).toContain("theme:")
    })
  })

  test("#given a plugin missing required artifacts #when staging #then installation fails with a clear error", async () => {
    await withFakeRepo(async (repoRoot) => {
      const context = makeContext({ repoRoot, ompBin: "omp" })
      const result = await runOmpInstaller({
        repoRoot,
        pluginPath: context.pluginPath,
        agentDir: context.agentDir,
        ompBin: "omp",
        runCommand: context.runCommand,
        platform: "win32",
        allowBuild: false,
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain("missing required runtime artifacts")
    })
  })

  test("#given an ast-grep manifest with a wrong hash #when staging #then integrity verification fails", async () => {
    await withFakeRepo(async (repoRoot) => {
      const pluginPath = makeFakePlugin(repoRoot)
      await writeFile(join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"), JSON.stringify({
        sha256: "ffff".repeat(16),
        mode: 0o755,
        stagedAtUtc: "2026-08-11T00:00:00.000Z",
      }))
      const context = makeContext({ repoRoot, ompBin: "omp" })
      const result = await runOmpInstaller({
        repoRoot,
        pluginPath: context.pluginPath,
        agentDir: context.agentDir,
        ompBin: "omp",
        runCommand: context.runCommand,
        platform: "win32",
        allowBuild: false,
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain("sha256 mismatch")
    })
  })

  test("#given the package name #when audited #then it matches the plugin manifest name", () => {
    expect(OMO_OMP_PACKAGE_NAME).toBe("@code-yeongyu/omo-omp")
    const pluginManifest = JSON.parse(String(readFileSync(
      resolve(import.meta.dir, "..", "..", "..", "..", "packages", "omo-omp", "plugin", "package.json"),
    )))
    expect(pluginManifest.name).toBe(OMO_OMP_PACKAGE_NAME)
  })
})

function dirname(path: string): string {
  return path.split(/[\\/]/).slice(0, -1).join("/") || "/"
}
