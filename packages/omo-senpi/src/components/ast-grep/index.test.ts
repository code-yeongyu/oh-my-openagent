/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createAstGrepComponent } from "./index"

const tempDirs: string[] = []

async function makeStagedEntry(): Promise<string> {
  const runtimeDir = await mkdtemp(join(tmpdir(), "omo-senpi-ast-grep-runtime-"))
  tempDirs.push(runtimeDir)
  const entry = join(runtimeDir, "cli.js")
  await writeFile(entry, "#!/usr/bin/env node\n", "utf8")
  await chmod(entry, 0o755)
  return entry
}

function recordingLogger(): ComponentLogger & { readonly entries: Array<{ level: string; message: string; details?: unknown }> } {
  const entries: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

function fakeContext(logger: ComponentLogger = recordingLogger()) {
  return {
    logger,
    config: { getFlag: () => undefined },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("createAstGrepComponent", () => {
  it.each([
    { context: "parent", env: {} },
    { context: "child", env: { SENPI_CODING_AGENT_SESSION_DIR: "/tmp/senpi-child" } },
  ])("#given a staged runtime in a $context session #when registered #then declares the lazy Anthropic-safe _ast_grep MCP server", async ({ env }) => {
    const entry = await makeStagedEntry()
    const pi = new FakeExtensionAPI()
    const component = createAstGrepComponent({
      env,
      nodeExecutable: "/usr/local/bin/node",
      resolveCwd: () => "/workspace/project",
      resolveEntry: () => entry,
    })

    await component.register(pi, fakeContext())

    expect(pi.mcpServers).toEqual([
      {
        name: "_ast_grep",
        config: {
          type: "stdio",
          command: "/usr/local/bin/node",
          args: [entry, "mcp"],
          env: { OMO_AST_GREP_PROJECT_CWD: "/workspace/project", BUN_BE_BUN: "1" },
          enabled: true,
          lifecycle: "lazy",
        },
      },
    ])
  })

  it("#given OMO_AST_GREP_PROJECT_CWD #when registered #then passes the explicit project cwd through", async () => {
    const entry = await makeStagedEntry()
    const pi = new FakeExtensionAPI()
    const component = createAstGrepComponent({
      env: { OMO_AST_GREP_PROJECT_CWD: "/explicit/project" },
      resolveCwd: () => "/fallback/project",
      resolveEntry: () => entry,
    })

    await component.register(pi, fakeContext())

    expect(pi.mcpServers[0]?.config.env).toEqual({ OMO_AST_GREP_PROJECT_CWD: "/explicit/project", BUN_BE_BUN: "1" })
  })

  it("#given the staged entry is absent #when registered #then skips cleanly and warns", async () => {
    const logger = recordingLogger()
    const pi = new FakeExtensionAPI()
    const missingEntry = join(tmpdir(), `missing-omo-ast-grep-${process.pid}-${Date.now()}`, "cli.js")
    const component = createAstGrepComponent({ resolveEntry: () => missingEntry })

    expect(component.register(pi, fakeContext(logger))).toBeUndefined()

    expect(pi.mcpServers).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "omo-senpi ast-grep skipped: staged MCP runtime is missing",
        details: { component: "ast-grep", entry: missingEntry },
      },
    ])
  })
})
