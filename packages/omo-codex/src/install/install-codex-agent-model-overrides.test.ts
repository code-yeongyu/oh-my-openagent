/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"

const temporaryDirectories: string[] = []
const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function makeInstallerFixture(marketplaceName: string): Promise<{
  readonly binDir: string
  readonly codexHome: string
  readonly homeDir: string
  readonly projectDirectory: string
  readonly repoRoot: string
}> {
  const repoRoot = await createRepoWithBuiltComponentBins({
    includeComponentBins: false,
    includeRootCliDist: false,
  })
  temporaryDirectories.push(repoRoot)
  const codexHome = await mkdtemp(join(tmpdir(), "omo-agent-override-codex-"))
  const binDir = await mkdtemp(join(tmpdir(), "omo-agent-override-bin-"))
  const homeDir = await mkdtemp(join(tmpdir(), "omo-agent-override-home-"))
  const projectDirectory = await mkdtemp(join(tmpdir(), "omo-agent-override-project-"))
  temporaryDirectories.push(codexHome, binDir, homeDir, projectDirectory)
  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const pluginRoot = join(codexPackageRoot, "plugin")
  await writeFile(
    join(codexPackageRoot, "marketplace.json"),
    JSON.stringify({ name: marketplaceName, plugins: [{ name: "omo", source: "./plugins/omo" }] }),
  )
  await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true })
  await writeFile(
    join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"),
    'name = "explorer"\nmodel = "bundled"\nmodel_reasoning_effort = "medium"\nservice_tier = "standard"\n',
  )
  await mkdir(join(projectDirectory, ".omo"), { recursive: true })
  await writeFile(
    join(projectDirectory, ".omo", "omo.jsonc"),
    JSON.stringify({
      "[codex]": {
        agents: {
          explorer: {
            model: "openai/gpt-5.6-sol",
            reasoning: "xhigh",
            provider_options: { service_tier: "priority" },
          },
          missing_dynamic_role: { model: "openai/gpt-5.6-terra" },
          malformed_role: { reasoning: "turbo", provider_options: { service_tier: 7 } },
        },
      },
    }),
  )
  return { binDir, codexHome, homeDir, projectDirectory, repoRoot }
}

async function installFixture(marketplaceName: string): Promise<{
  readonly agentContent: string
  readonly logs: readonly string[]
}> {
  const fixture = await makeInstallerFixture(marketplaceName)
  const logs: string[] = []
  await runCodexInstaller({
    ...fixture,
    astGrepInstaller: skipAstGrepInstall,
    env: { HOME: fixture.homeDir, OMO_CODEX_DISABLE_POSTHOG: "1" },
    gitBashResolver: () => ({
      checkedPaths: ["C:\\Program Files\\Git\\bin\\bash.exe"],
      found: true,
      path: "C:\\Program Files\\Git\\bin\\bash.exe",
      source: "program-files",
    }),
    log: (message) => logs.push(message),
    platform: "win32",
    runCommand: async () => undefined,
  })
  return {
    agentContent: await readFile(join(fixture.codexHome, "agents", "explorer.toml"), "utf8"),
    logs,
  }
}

describe("Codex installer agent model overrides", () => {
  test("applies the effective Codex view only to the sisyphuslabs/omo plugin and warns for dynamic unknown names", async () => {
    const result = await installFixture("sisyphuslabs")

    expect(result.agentContent).toContain('model = "openai/gpt-5.6-sol"')
    expect(result.agentContent).toContain('model_reasoning_effort = "xhigh"')
    expect(result.agentContent).toContain('service_tier = "priority"')
    expect(result.logs.some((line) => line.includes("agents.missing_dynamic_role"))).toBe(true)
    expect(result.logs.some((line) => line.includes("agents.malformed_role.reasoning") && line.includes("unsupported"))).toBe(true)
    expect(result.logs.some((line) => line.includes("agents.malformed_role.provider_options.service_tier"))).toBe(true)
  })

  test("does not propagate OMO agent overrides into another marketplace identity", async () => {
    const result = await installFixture("foreign-marketplace")

    expect(result.agentContent).toContain('model = "bundled"')
    expect(result.agentContent).toContain('model_reasoning_effort = "medium"')
    expect(result.agentContent).toContain('service_tier = "standard"')
    expect(result.logs.some((line) => line.includes("missing_dynamic_role"))).toBe(false)
  })
})
