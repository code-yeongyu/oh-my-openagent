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
      const installedFloor = join(installedPackageRoot, "bin", "lib", "claude-code-floor.js")
      expect(readFileSync(installedFloor, "utf8")).toContain("claudeCodeVersionFloor")

      const consumerRequire = createRequire(join(installedPackageRoot, "package.json"))
      const searchPaths = consumerRequire.resolve.paths("@code-yeongyu/senpi") ?? []
      const senpiRoot = searchPaths.map((searchPath) => join(searchPath, "@code-yeongyu", "senpi")).find((candidate) => existsSync(join(candidate, "package.json")))
      expect(senpiRoot).toBeDefined()
      const sessionRegistryPump = readFileSync(join(senpiRoot!, "dist/core/extensions/builtin/anthropic-subscription/session-registry-pump.js"), "utf8")
      expect(sessionRegistryPump).toContain("sdkResultFailure(message)")

      // omo#8247: the ~255 MiB checker npm payload is deliberately absent from a native install. The
      // extension resolves it from plugin/extensions/omo.js, and that lookup walks the same node_modules
      // chain as the package root, so the miss is proven here without the staged plugin payload (which
      // build:omo-native produces; package-shape.test.ts pins the downloader in the source bundle).
      const installedExtensionDir = join(installedPackageRoot, "plugin", "extensions")
      const extensionRequire = createRequire(join(installedExtensionDir, "omo.js"))
      expect(existsSync(join(installedPackageRoot, "node_modules", "@code-yeongyu", "comment-checker"))).toBe(false)
      expect(existsSync(join(consumer, "node_modules", "@code-yeongyu", "comment-checker"))).toBe(false)
      expect(() => extensionRequire.resolve("@code-yeongyu/comment-checker")).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 240_000)

  // #8713: with install scripts blocked (ignore-scripts=true, Bun's untrusted-postinstall default)
  // the first engine launch has to prepare the engine itself.
  test("prepares the engine on the first launch when install scripts never ran", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-ai-ignore-scripts-"))
    try {
      const pack = Bun.spawnSync(["bun", "pm", "pack", "--ignore-scripts", "--destination", root], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" })
      expect(pack.exitCode).toBe(0)
      const tarball = [...new Bun.Glob("*.tgz").scanSync(root)][0]
      expect(tarball).toBeDefined()
      const consumer = join(root, "consumer")
      const home = join(root, "home")
      Bun.spawnSync(["mkdir", "-p", consumer, home], { stdout: "ignore", stderr: "ignore" })
      writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "omo-ai-consumer", private: true }))
      const install = Bun.spawnSync(["bun", "add", "--ignore-scripts", "--backend", "copyfile", join(root, tarball!)], { cwd: consumer, stdout: "pipe", stderr: "pipe" })
      expect(install.exitCode).toBe(0)
      const installedPackageRoot = join(consumer, "node_modules", "omo-ai")
      const consumerRequire = createRequire(join(installedPackageRoot, "package.json"))
      const searchPaths = consumerRequire.resolve.paths("@code-yeongyu/senpi") ?? []
      const senpiRoot = searchPaths.map((searchPath) => join(searchPath, "@code-yeongyu", "senpi")).find((candidate) => existsSync(join(candidate, "package.json")))
      expect(senpiRoot).toBeDefined()
      const rpcMode = join(senpiRoot!, "dist", "modes", "rpc", "rpc-mode.js")
      const stamp = join(senpiRoot!, ".omo-engine-prepared")
      // The stamp is the precondition: a hardlinked Bun cache can already carry a rewritten rpc-mode.js.
      expect(existsSync(stamp)).toBe(false)

      const launch = Bun.spawnSync(["node", join(installedPackageRoot, "bin", "omo.js"), "--help"], {
        cwd: consumer,
        env: { ...process.env, HOME: home, USERPROFILE: home, OMO_RUNTIME: "node", OMO_CODING_AGENT_DIR: join(home, ".omo", "agent") },
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(new TextDecoder().decode(launch.stderr)).not.toContain("could not prepare the installed engine")
      expect(launch.exitCode).toBe(0)
      expect(readFileSync(rpcMode, "utf8")).toContain("invalid_stream_event")
      const omoVersion = JSON.parse(readFileSync(join(installedPackageRoot, "package.json"), "utf8")).version
      expect(readFileSync(stamp, "utf8").trim()).toBe(omoVersion)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 240_000)
})
