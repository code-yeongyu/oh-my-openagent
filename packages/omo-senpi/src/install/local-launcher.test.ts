import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { installLocalLauncher, localLauncherPath, renderLocalLauncher, uninstallLocalLauncher } from "./local-launcher"

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "omo-local-launcher-"))
}

// Compared over LF: a Windows checkout may hand the asset back with CRLF.
const ICON = readFileSync(
  resolve(fileURLToPath(new URL("../../../..", import.meta.url)), ".github/assets/omo-icon-light.svg"),
  "utf8",
).replaceAll("\r\n", "\n")
const LOGO_PREFIX = "data:image/svg+xml;base64,"

const BASE = {
  pluginPath: "/repo/packages/omo-senpi/plugin",
  senpiCliPath: "/repo/senpi/dist/cli.js",
  version: "9.9.9",
}

describe("local omo launcher", () => {
  describe("#given a sibling-store install", () => {
    describe("#when the launcher is rendered", () => {
      test("#then it hands the engine the same product identity as the published launcher", () => {
        const source = renderLocalLauncher(BASE)
        const brand = JSON.parse(source.match(/const brand = (\{.*\})/)?.[1] ?? "{}")

        // The provider sign-in result page shows this mark (senpi#4432).
        expect(typeof brand.logo).toBe("string")
        expect(brand.logo.startsWith(LOGO_PREFIX)).toBe(true)
        expect(Buffer.from(brand.logo.slice(LOGO_PREFIX.length), "base64").toString("utf8")).toBe(ICON)
        expect(brand).toEqual({
          name: "OmO",
          logo: brand.logo,
          command: "omo",
          displayVersion: "9.9.9",
          configDir: ".omo",
          flatLayout: false,
          envPrefix: "OMO",
          userAgent: "omo",
          originator: "omo",
          // A local sibling-store install points at the repo plugin dir and deliberately carries
          // no version: without one the engine treats the source as read-only and renders no
          // startup notes, which is what a dev install should do.
          changelog: {
            path: "/repo/packages/omo-senpi/plugin/CHANGELOG.md",
          },
          update: {
            packageName: "omo-ai",
            distTag: "latest",
            command: "bun add -g omo-ai",
            changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases",
          },
        })
        expect(source).toContain("omo is updated via bun: bun add -g omo-ai")
        expect(source).not.toContain("omo-ai@beta")
        expect(source).toContain("--extension")
        expect(source).toContain("OMO_SENPI_CLI_PATH")
        expect(source).toContain("OMO_PLUGIN_ROOT")
        expect(source).toContain("OMO_CODING_AGENT_DIR")
        expect(source).toContain("SENPI_CODING_AGENT_DIR")
        expect(source).toContain('join(homedir(), ".omo", "agent")')
      })

      test("#then a prerelease build stays on the beta channel", () => {
        const source = renderLocalLauncher({ ...BASE, version: "5.0.0-beta.90" })
        const brand = JSON.parse(source.match(/const brand = (\{.*\})/)?.[1] ?? "{}")

        expect(brand.update).toMatchObject({ distTag: "beta", command: "bun add -g omo-ai@beta" })
        expect(source).toContain("omo is updated via bun: bun add -g omo-ai@beta")
      })
    })

    describe("#when it is installed", () => {
      test("#then it lands executable on the user's PATH directory", () => {
        const home = makeHome()
        const path = installLocalLauncher({ ...BASE, homeDir: home })

        expect(path).toBe(localLauncherPath(home))
        expect(existsSync(path ?? "")).toBe(true)
        expect(readFileSync(path ?? "", "utf8")).toContain("omo-local-launcher")

        rmSync(home, { recursive: true, force: true })
      })

      test("#then reinstalling is idempotent", () => {
        const home = makeHome()
        installLocalLauncher({ ...BASE, homeDir: home })
        const second = installLocalLauncher({ ...BASE, homeDir: home })

        expect(second).toBe(localLauncherPath(home))

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file at that path is never overwritten", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(installLocalLauncher({ ...BASE, homeDir: home })).toBeUndefined()
        expect(readFileSync(path, "utf8")).toContain("echo mine")

        rmSync(home, { recursive: true, force: true })
      })
    })

    describe("#when the checkout's plugin is not built", () => {
      test("#then the launcher exits 1 naming the build command instead of starting the engine", () => {
        const home = makeHome()
        const pluginPath = join(home, "plugin")
        const engine = join(home, "engine.mjs")
        mkdirSync(join(pluginPath, "extensions"), { recursive: true })
        writeFileSync(engine, "process.stdout.write('ENGINE STARTED')\n")
        const launcher = join(home, "omo.mjs")
        writeFileSync(launcher, renderLocalLauncher({ ...BASE, pluginPath, senpiCliPath: engine }))

        const unbuilt = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" })
        writeFileSync(join(pluginPath, "extensions", "omo.js"), "")
        const built = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" })
        rmSync(home, { recursive: true, force: true })

        expect(unbuilt.status).toBe(1)
        expect(unbuilt.stdout).not.toContain("ENGINE STARTED")
        expect(unbuilt.stderr).toContain("bun run build:senpi-plugin")
        expect(built.status).toBe(0)
        expect(built.stdout).toContain("ENGINE STARTED")
      })
    })

    // #13232: the checkout moved past a plugin input since the last build. The launcher says so once and still starts.
    describe("#when the checkout's plugin build is older than its plugin sources", () => {
      const STAMP_MODULE = fileURLToPath(new URL("../../plugin/scripts/build-stamp.mjs", import.meta.url))

      function git(cwd: string, ...args: string[]): string {
        const result = spawnSync("git", args, { cwd, encoding: "utf8" })
        if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
        return result.stdout.trim()
      }

      function commitAll(root: string, message: string): void {
        git(root, "add", "-A")
        git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message)
      }

      // A built checkout stamped at its first commit, then a commit that changes a plugin input.
      function staleCheckout(withStampModule: boolean): { home: string; launcher: string } {
        const home = makeHome()
        const pluginPath = join(home, "packages", "omo-senpi", "plugin")
        const source = join(home, "packages", "omo-senpi", "src", "index.ts")
        mkdirSync(join(pluginPath, "extensions"), { recursive: true })
        mkdirSync(join(pluginPath, "scripts"), { recursive: true })
        mkdirSync(dirname(source), { recursive: true })
        writeFileSync(
          join(home, ".gitignore"),
          "/packages/omo-senpi/plugin/extensions/\n/packages/omo-senpi/plugin/.build-stamp\n",
        )
        writeFileSync(source, "export const a = 1\n")
        writeFileSync(
          join(home, "packages", "omo-senpi", "bundle-inputs.json"),
          `${JSON.stringify({ version: 1, files: ["packages/omo-senpi/src/index.ts"], directories: [] })}\n`,
        )
        if (withStampModule) writeFileSync(join(pluginPath, "scripts", "build-stamp.mjs"), readFileSync(STAMP_MODULE))
        git(home, "init", "-q", "-b", "dev")
        commitAll(home, "base")
        writeFileSync(join(pluginPath, "extensions", "omo.js"), "")
        writeFileSync(
          join(pluginPath, ".build-stamp"),
          `${JSON.stringify({ version: 1, commit: git(home, "rev-parse", "HEAD") })}\n`,
        )
        writeFileSync(source, "export const a = 2\n")
        commitAll(home, "change a plugin input")
        const engine = join(home, "engine.mjs")
        writeFileSync(engine, "process.stdout.write('ENGINE STARTED')\n")
        const launcher = join(home, "omo.mjs")
        writeFileSync(launcher, renderLocalLauncher({ ...BASE, pluginPath, senpiCliPath: engine }))
        return { home, launcher }
      }

      test("#then it warns once naming the build command and still starts the engine", () => {
        const { home, launcher } = staleCheckout(true)

        const run = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" })
        rmSync(home, { recursive: true, force: true })

        expect(run.status).toBe(0)
        expect(run.stdout).toContain("ENGINE STARTED")
        expect(run.stderr.match(/bun run build:senpi-plugin/g)?.length).toBe(1)
      })

      // The launcher is installed once and outlives the checkout's version: a checkout switched to a commit before
      // #13232 has no stamp module, and the launcher must start exactly as it did before.
      test("#then a checkout without the stamp module starts as before, with no warning", () => {
        const { home, launcher } = staleCheckout(false)

        const run = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" })
        rmSync(home, { recursive: true, force: true })

        expect(run.status).toBe(0)
        expect(run.stdout).toContain("ENGINE STARTED")
        expect(run.stderr).toBe("")
      })
    })

    describe("#when it is uninstalled", () => {
      test("#then only a generated launcher is removed", () => {
        const home = makeHome()
        installLocalLauncher({ ...BASE, homeDir: home })

        expect(uninstallLocalLauncher(home)).toBe(true)
        expect(existsSync(localLauncherPath(home))).toBe(false)
        expect(uninstallLocalLauncher(home)).toBe(false)

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file survives", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(uninstallLocalLauncher(home)).toBe(false)
        expect(existsSync(path)).toBe(true)

        rmSync(home, { recursive: true, force: true })
      })
    })
  })
})
