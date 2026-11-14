import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createInstallSandbox, type InstallSandbox } from "./install-test-fixture"
import { localLauncherPath, renderLocalLauncher } from "./local-launcher"

// Launcher writes and spawns run in a sandbox (#13192, #13253): the launcher defaults to the real home and reads its
// engine, plugin and agent dir from the environment, so every case gets a scratch home and an explicit spawn env.
let sandbox: InstallSandbox
beforeEach(() => {
  sandbox = createInstallSandbox()
})
afterEach(async () => {
  await sandbox.dispose()
})

function makeHome(): string {
  return sandbox.home
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
        const path = sandbox.installLauncher(BASE)

        expect(path).toBe(localLauncherPath(home))
        expect(existsSync(path ?? "")).toBe(true)
        expect(readFileSync(path ?? "", "utf8")).toContain("omo-local-launcher")

        rmSync(home, { recursive: true, force: true })
      })

      test("#then reinstalling is idempotent", () => {
        const home = makeHome()
        sandbox.installLauncher(BASE)
        const second = sandbox.installLauncher(BASE)

        expect(second).toBe(localLauncherPath(home))

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file at that path is never overwritten", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(sandbox.installLauncher(BASE)).toBeUndefined()
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

        const unbuilt = sandbox.spawnSync(process.execPath, [launcher, "--version"])
        writeFileSync(join(pluginPath, "extensions", "omo.js"), "")
        const built = sandbox.spawnSync(process.execPath, [launcher, "--version"])
        rmSync(home, { recursive: true, force: true })

        expect(unbuilt.status).toBe(1)
        expect(unbuilt.stdout).not.toContain("ENGINE STARTED")
        expect(unbuilt.stderr).toContain("bun run build:senpi-plugin")
        expect(built.status).toBe(0)
        expect(built.stdout).toContain("ENGINE STARTED")
      })
    })

    describe("#when a spawn would reach outside the sandbox", () => {
      test("#then an engine path outside it is refused before the spawn", () => {
        expect(() =>
          sandbox.spawnSync(process.execPath, ["--version"], { OMO_SENPI_CLI_PATH: join(tmpdir(), "engine.mjs") }),
        ).toThrow("outside")
      })

      test("#then an agent dir outside it is refused before the spawn", () => {
        expect(() => sandbox.spawnSync(process.execPath, ["--version"], { OMO_CODING_AGENT_DIR: tmpdir() })).toThrow(
          "outside",
        )
      })

      test("#then the spawn env carries the scratch home and agent dir, not the caller's", () => {
        const probe = sandbox.spawnSync(process.execPath, [
          "-e",
          "console.log(JSON.stringify([process.env.HOME, process.env.OMO_CODING_AGENT_DIR, process.env.OMO_SENPI_CLI_PATH ?? null]))",
        ])
        expect(JSON.parse(probe.stdout)).toEqual([sandbox.home, sandbox.agentDir, null])
      })
    })

    describe("#when it is uninstalled", () => {
      test("#then only a generated launcher is removed", () => {
        const home = makeHome()
        sandbox.installLauncher(BASE)

        expect(sandbox.uninstallLauncher()).toBe(true)
        expect(existsSync(localLauncherPath(home))).toBe(false)
        expect(sandbox.uninstallLauncher()).toBe(false)

        rmSync(home, { recursive: true, force: true })
      })

      test("#then a foreign file survives", () => {
        const home = makeHome()
        const path = localLauncherPath(home)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "#!/bin/sh\necho mine\n")

        expect(sandbox.uninstallLauncher()).toBe(false)
        expect(existsSync(path)).toBe(true)

        rmSync(home, { recursive: true, force: true })
      })
    })
  })
})
