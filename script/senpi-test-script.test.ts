/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSenpiInstaller } from "../packages/omo-senpi/src/install/install-senpi"

const packageManifestPath = new URL("../package.json", import.meta.url)
const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

function readPackageScript(name: string): string {
  const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8")) as {
    readonly scripts?: Record<string, string>
  }
  const script = manifest.scripts?.[name]
  if (typeof script !== "string") throw new Error(`missing package script ${name}`)
  return script
}

function readRootManifest(): {
  readonly files?: readonly string[]
  readonly scripts?: Record<string, string>
} {
  return JSON.parse(readFileSync(packageManifestPath, "utf8")) as {
    readonly files?: readonly string[]
    readonly scripts?: Record<string, string>
  }
}

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("Senpi compatibility test script", () => {
  test("#given published root package #when payload contract is inspected #then senpi payload is contained while local build stays available", () => {
    // #given
    const manifest = readRootManifest()
    const files = manifest.files ?? []
    const buildOrchestrator = readFileSync(new URL("./build.ts", import.meta.url), "utf8")
    const prepublishOnlyScript = manifest.scripts?.prepublishOnly ?? ""

    // #when
    const shipsPluginTree = files.includes("packages/omo-senpi/plugin")
    const hasStandaloneBuildScript = manifest.scripts?.["build:senpi-plugin"] === [
      "bun run build:lsp-daemon",
      "bun run build:senpi-plugin:stage",
    ].join(" && ")
    const hasStageScript = manifest.scripts?.["build:senpi-plugin:stage"] === [
      "node packages/omo-senpi/plugin/scripts/stage-lsp-daemon-runtime.mjs",
      "node packages/omo-senpi/plugin/scripts/build-extension.mjs",
      "node packages/omo-senpi/plugin/scripts/sync-skills.mjs",
      "node packages/omo-senpi/plugin/scripts/embed-directive.mjs --check",
      "node packages/omo-senpi/plugin/scripts/build-install.mjs",
    ].join(" && ")
    const senpiNode = /id: "senpi-plugin"[\s\S]*?args: \["run", "build:senpi-plugin:stage"\][\s\S]*?deps: \["lsp-daemon"\]/.test(
      buildOrchestrator,
    )

    // #then
    expect(
      shipsPluginTree,
      "root npm files must NOT ship packages/omo-senpi/plugin while the senpi platform flag is disabled for release",
    ).toBe(false)
    expect(hasStandaloneBuildScript, "standalone Senpi build must build the shared daemon once before staging").toBe(true)
    expect(hasStageScript, "root scripts must expose a stage-only Senpi artifact build").toBe(true)
    expect(buildOrchestrator, "the build orchestrator must generate Senpi plugin artifacts before publishing").toContain(
      "build:senpi-plugin:stage",
    )
    expect(senpiNode, "build graph senpi-plugin must depend on lsp-daemon and call only the stage script").toBe(true)
    expect(prepublishOnlyScript, "prepublishOnly must route through build, which includes the Senpi plugin build").toContain(
      "bun run build",
    )
  })

  test("#given a packed-layout root with only senpi plugin artifacts #when installer runs #then settings points at that shipped plugin tree", async () => {
    // #given
    const tempRoot = await mkdtemp(join(tmpdir(), "omo-senpi-packed-root-"))
    const agentDir = await mkdtemp(join(tmpdir(), "omo-senpi-packed-agent-"))
    try {
      const pluginRoot = join(tempRoot, "packages", "omo-senpi", "plugin")
      await mkdir(join(pluginRoot, "extensions"), { recursive: true })
      await mkdir(join(pluginRoot, "skills", "ultrawork"), { recursive: true })
      await mkdir(join(pluginRoot, "skills", "ulw-loop"), { recursive: true })
      await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
      await writeFile(join(pluginRoot, "extensions", "omo.js"), "export default {}\n")
      await writeFile(join(pluginRoot, "skills", "ultrawork", "SKILL.md"), "# Ultrawork\n")
      await writeFile(join(pluginRoot, "skills", "ulw-loop", "SKILL.md"), "# ULW Loop\n")
      await mkdir(join(pluginRoot, "scripts"), { recursive: true })
      await writeFile(join(pluginRoot, "scripts", "install.mjs"), "#!/usr/bin/env node\n")
      await mkdir(join(pluginRoot, "runtime", "lsp-daemon", "dist"), { recursive: true })
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "cli.js"), "console.log('cli')\n")
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "index.js"), "export {}\n")
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "index.d.ts"), "export {}\n")
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "daemon-client.js"), "export {}\n")
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "daemon-client.d.ts"), "export {}\n")
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", "package.json"), JSON.stringify({ version: "0.1.0" }))
      await writeFile(join(pluginRoot, "runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"), "{}\n")

      const commands: string[] = []

      // #when
      const result = await runSenpiInstaller({
        repoRoot: tempRoot,
        agentDir,
        runCommand: async (command, args) => {
          commands.push([command, ...args].join(" "))
        },
      })

      // #then
      const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>
      expect(result.pluginPath).toBe(pluginRoot)
      expect(settings.packages).toEqual([pluginRoot])
      expect(commands, "packed installs must use shipped artifacts without requiring source rebuild scripts").toEqual([])
    } finally {
      await Promise.all([rm(tempRoot, { recursive: true, force: true }), rm(agentDir, { recursive: true, force: true })])
    }
  })

  test("#given root scripts #when test:senpi is inspected #then it runs the hermetic adapter gate in order", () => {
    // #given
    const script = readPackageScript("test:senpi")

    // #when
    const expectedCommands = [
      "bun run build:senpi-plugin",
      "tsgo --noEmit -p packages/omo-senpi/tsconfig.json",
      "bun test packages/omo-senpi",
    ]
    const commandIndexes = expectedCommands.map((command) => script.indexOf(command))
    let isOrdered = true
    for (let index = 0; index < commandIndexes.length; index += 1) {
      const current = commandIndexes[index]
      const previous = index === 0 ? -1 : commandIndexes[index - 1]
      if (current === undefined || previous === undefined || current < 0 || current <= previous) isOrdered = false
    }

    // #then
    expect(isOrdered, "test:senpi must build the daemon, stage artifacts, typecheck, then run package tests").toBe(true)
    expect(script, "test:senpi must stay hermetic and not run a live senpi install").not.toContain("senpi install")
  })

  test("#given CI workflow #when inspected #then senpi compatibility is a merge-blocking matrix job", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const senpiJob = sliceWorkflowSection(workflow, "  senpi-compatibility:", "  lazycodex-published-smoke:")
    const needsReferences = workflow.match(/needs: \[[^\]]*senpi-compatibility[^\]]*\]/g) ?? []

    // #then
    expect(senpiJob).toContain("os: [ubuntu-latest, macos-latest, windows-latest]")
    expect(senpiJob).toContain('node-version: "24"')
    expect(senpiJob).toContain('bun-version: "1.3.12"')
    expect(senpiJob).toContain("bun run build:senpi-plugin")
    expect(senpiJob).toContain("npm pack --pack-destination")
    expect(senpiJob).toContain("npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts")
    expect(senpiJob).toContain("tsgo --noEmit -p packages/omo-senpi/tsconfig.json")
    expect(senpiJob).toContain("bun test packages/omo-senpi")
    expect(senpiJob).not.toContain("senpi install")
    expect(needsReferences.length, "senpi-compatibility must be included in both downstream needs lists").toBeGreaterThanOrEqual(2)
  })
})
