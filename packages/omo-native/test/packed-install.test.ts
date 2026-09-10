import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

const packageRoot = join(import.meta.dir, "..")

describe("omo-ai packed install", () => {
  test("ships the Senpi patch installer and installs a Senpi that surfaces pre-replay results natively", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-ai-packed-install-"))
    try {
      const pack = Bun.spawnSync(["bun", "pm", "pack", "--ignore-scripts", "--destination", root], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" })
      expect(pack.exitCode).toBe(0)
      const tarball = [...new Bun.Glob("*.tgz").scanSync(root)][0]
      expect(tarball).toBeDefined()
      const listing = Bun.spawnSync(["tar", "-tzf", join(root, tarball!)], { stdout: "pipe", stderr: "pipe" })
      expect(listing.exitCode).toBe(0)
      const entries = new TextDecoder().decode(listing.stdout).split(/\r?\n/).filter(Boolean).map((entry) => entry.replaceAll("/", sep))
      expect(entries).toContain(join("package", "bin", "senpi-patch.mjs"))

      const consumer = join(root, "consumer")
      Bun.spawnSync(["mkdir", "-p", consumer], { stdout: "ignore", stderr: "ignore" })
      writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "omo-ai-consumer", private: true }))
      const install = Bun.spawnSync(["bun", "add", "--trust", join(root, tarball!)], { cwd: consumer, stdout: "pipe", stderr: "pipe" })
      expect(install.exitCode).toBe(0)
      const installedPackageRoot = join(consumer, "node_modules", "omo-ai")
      const installedScript = join(installedPackageRoot, "bin", "senpi-patch.mjs")
      expect(readFileSync(installedScript, "utf8")).toContain("claudeCodeVersionFloor")

      const consumerRequire = createRequire(join(installedPackageRoot, "package.json"))
      const searchPaths = consumerRequire.resolve.paths("@code-yeongyu/senpi") ?? []
      const senpiRoot = searchPaths.map((searchPath) => join(searchPath, "@code-yeongyu", "senpi")).find((candidate) => existsSync(join(candidate, "package.json")))
      expect(senpiRoot).toBeDefined()
      const sessionRegistryPump = readFileSync(join(senpiRoot!, "dist/core/extensions/builtin/claude-sdk-oauth/session-registry-pump.js"), "utf8")
      expect(sessionRegistryPump).toContain("sdkResultFailure(message)")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 240_000)
})
