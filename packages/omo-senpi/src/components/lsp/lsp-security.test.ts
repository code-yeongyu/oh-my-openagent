import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"
import { getMergedServers } from "@oh-my-opencode/lsp-core/lsp/config-loader"
import { runWithRequestContext } from "@oh-my-opencode/lsp-core/request-context"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { getConfigNotices } from "./adapter/migration-notices"
import { createLspComponent } from "./index"

describe("omo-senpi lsp project config trust", () => {
  it("#given untrusted project-local LSP config #when shared server config merges #then arbitrary project commands are not launched", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-untrusted-"))
    const originalCwd = process.cwd()
    const home = join(root, "home")
    const piConfigDir = join(root, ".pi")
    const sentinelPath = join(root, "project-lsp-command-executed")
    mkdirSync(piConfigDir)
    writeFileSync(
      join(piConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          "project-sentinel": {
            command: ["sh", "-c", `printf owned > ${JSON.stringify(sentinelPath)}`],
            extensions: [".sentinel"],
            priority: 1000,
          },
        },
      }),
    )

    try {
      process.chdir(root)

      // when
      const servers = withSenpiLspContext(root, home, () => getMergedServers())

      // then
      expect(servers.some((server) => server.id === "project-sentinel")).toBe(false)
      expect(existsSync(sentinelPath)).toBe(false)
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given untrusted project config overrides a builtin #when servers merge #then the builtin command remains selected", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-builtin-"))
    const originalCwd = process.cwd()
    const home = join(root, "home")
    const piConfigDir = join(root, ".pi")
    mkdirSync(piConfigDir)
    writeFileSync(
      join(piConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          typescript: {
            command: ["sh", "-c", "printf owned"],
            extensions: [".ts"],
            priority: 1000,
          },
        },
      }),
    )

    try {
      process.chdir(root)

      // when
      const servers = withSenpiLspContext(root, home, () => getMergedServers())

      // then
      const typescript = servers.find((server) => server.id === "typescript")
      expect(typescript?.source).toBe("project")
      expect(typescript?.command).toEqual(["typescript-language-server", "--stdio"])
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given project-local custom commands #when servers merge #then project-local commands remain ignored", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-trusted-"))
    const originalCwd = process.cwd()
    const home = join(root, "home")
    const piConfigDir = join(root, ".pi")
    mkdirSync(piConfigDir)
    writeFileSync(
      join(piConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          "trusted-project-server": {
            command: ["trusted-lsp", "--stdio"],
            extensions: [".trusted"],
            priority: 1000,
          },
        },
      }),
    )

    try {
      process.chdir(root)

      // when
      const servers = withSenpiLspContext(root, home, () => getMergedServers())

      // then
      expect(servers.some((server) => server.id === "trusted-project-server")).toBe(false)
      const notices: unknown = getConfigNotices()
      expect(notices).toEqual([
        {
          kind: "untrusted_project_lsp_command",
          serverIds: ["trusted-project-server"],
          configPath: join(process.cwd(), ".pi", "lsp-client.json"),
          userConfigPath: join(process.env.HOME ?? "", ".pi", "lsp-client.json"),
        },
      ])
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given project config customizes safe builtin fields #when servers merge #then command and env still come from the builtin", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-safe-project-"))
    const originalCwd = process.cwd()
    const home = join(root, "home")
    const piConfigDir = join(root, ".pi")
    mkdirSync(piConfigDir)
    writeFileSync(
      join(piConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          typescript: {
            command: ["sh", "-c", "printf owned"],
            env: { OWNED: "1" },
            extensions: [".tsx"],
            priority: 2000,
            initialization: { test: true },
          },
        },
      }),
    )

    try {
      process.chdir(root)

      // when
      const servers = withSenpiLspContext(root, home, () => getMergedServers())

      // then
      expect(servers[0]).toMatchObject({
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".tsx"],
        priority: 2000,
        initialization: { test: true },
        source: "project",
      })
      expect(servers[0]?.env).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given user LSP config has a custom command and env #when servers merge #then the user custom server is preserved", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-user-"))
    const projectRoot = join(root, "project")
    const originalHome = process.env.HOME
    const userPiConfigDir = join(root, ".pi")
    mkdirSync(projectRoot)
    mkdirSync(userPiConfigDir)
    writeFileSync(
      join(userPiConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          "user-custom": {
            command: ["user-lsp", "--stdio"],
            env: { USER_SAFE: "1" },
            extensions: [".user"],
            priority: 500,
          },
        },
      }),
    )

    try {
      // when
      const servers = withSenpiLspContext(projectRoot, root, () => getMergedServers())

      // then
      expect(servers[0]).toMatchObject({
        id: "user-custom",
        command: ["user-lsp", "--stdio"],
        env: { USER_SAFE: "1" },
        extensions: [".user"],
        priority: 500,
        source: "user",
      })
    } finally {
      restoreEnvValue("HOME", originalHome)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given project configs contain multiple unsafe commands #when the component registers #then exactly one migration warning is emitted", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-warning-"))
    const originalCwd = process.cwd()
    const piConfigDir = join(root, ".pi")
    const logger = new TestLogger()
    mkdirSync(piConfigDir)
    writeFileSync(
      join(piConfigDir, "lsp-client.json"),
      JSON.stringify({
        lsp: {
          alpha: { command: ["alpha-ls"], extensions: [".alpha"] },
          beta: { command: ["beta-ls"], extensions: [".beta"] },
        },
      }),
    )

    try {
      process.chdir(root)

      // when
      createLspComponent().register(new FakeExtensionAPI(), componentContext(logger))

      // then
      expect(logger.warnings).toEqual([
        {
          message: "omo-senpi ignored project-local LSP commands; move custom commands to the user .pi config",
          details: {
            kind: "untrusted_project_lsp_command",
            serverIds: ["alpha", "beta"],
            configPath: join(process.cwd(), ".pi", "lsp-client.json"),
            userConfigPath: join(process.env.HOME ?? "", ".pi", "lsp-client.json"),
          },
        },
      ])
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function withSenpiLspContext<T>(cwd: string, home: string, run: () => T): T {
  return runWithRequestContext(
    {
      cwd,
      projectConfigPaths: [join(cwd, ".pi", "lsp-client.json")],
      userConfigPath: join(home, ".pi", "lsp-client.json"),
      installDecisionsPath: join(home, ".pi", "lsp-install-decisions.json"),
      capabilities: { installDecisionTool: false },
    },
    run,
  )
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

class TestLogger implements ComponentLogger {
  readonly warnings: Array<{ readonly message: string; readonly details?: unknown }> = []

  info(): void {}

  warn(message: string, details?: unknown): void {
    this.warnings.push({ message, details })
  }

  error(): void {}
}

function componentContext(logger: ComponentLogger): ComponentContext {
  return {
    logger,
    config: {
      getFlag() {
        return undefined
      },
    },
  }
}
