import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "bun:test"

import { handlePostEditDiagnosticsToolResult } from "./index"
import { getMergedServers } from "./lsp/config-loader"

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

async function withProjectLspCommandTrust<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const originalOmoTrust = process.env.OMO_SENPI_TRUST_PROJECT_LSP_COMMANDS
  const originalSenpiTrust = process.env.SENPI_TRUST_PROJECT_LSP_COMMANDS
  try {
    if (value === undefined) {
      delete process.env.OMO_SENPI_TRUST_PROJECT_LSP_COMMANDS
    } else {
      process.env.OMO_SENPI_TRUST_PROJECT_LSP_COMMANDS = value
    }
    delete process.env.SENPI_TRUST_PROJECT_LSP_COMMANDS
    return await run()
  } finally {
    restoreEnvValue("OMO_SENPI_TRUST_PROJECT_LSP_COMMANDS", originalOmoTrust)
    restoreEnvValue("SENPI_TRUST_PROJECT_LSP_COMMANDS", originalSenpiTrust)
  }
}

describe("omo-senpi lsp project config trust", () => {
  it("#given untrusted project-local LSP config #when default post-edit diagnostics runs #then arbitrary project commands are not launched", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-untrusted-"))
    const originalCwd = process.cwd()
    const piConfigDir = join(root, ".pi")
    const sentinelPath = join(root, "project-lsp-command-executed")
    const filePath = join(root, "sample.sentinel")
    mkdirSync(piConfigDir)
    writeFileSync(filePath, "export const value: string = 1\n")
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
    const event = {
      type: "tool_result",
      toolCallId: "write-1",
      toolName: "write",
      input: { path: filePath },
      content: [{ type: "text", text: "Wrote file successfully." }],
      isError: false,
    }

    try {
      process.chdir(root)

      // when
      await withProjectLspCommandTrust(undefined, async () => {
        await handlePostEditDiagnosticsToolResult(event)
      })

      // then
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
      const servers = await withProjectLspCommandTrust(undefined, async () => getMergedServers())

      // then
      const typescript = servers.find((server) => server.id === "typescript")
      expect(typescript?.source).toBe("builtin")
      expect(typescript?.command).toEqual(["typescript-language-server", "--stdio"])
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#given explicit project LSP trust #when servers merge #then project-local commands remain configurable", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-trusted-"))
    const originalCwd = process.cwd()
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
      const servers = await withProjectLspCommandTrust("1", async () => getMergedServers())

      // then
      expect(servers[0]).toMatchObject({
        id: "trusted-project-server",
        command: ["trusted-lsp", "--stdio"],
        extensions: [".trusted"],
        source: "project",
      })
    } finally {
      process.chdir(originalCwd)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
