/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createBuiltinMcpsComponent } from "./index"

// The installed host owns MCP declaration validation, so the real validator is the only proof that
// these declarations survive `pi.registerMcpServer`; the loader throws on the error string it returns.
const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { validateMcpServerDeclaration } = await import(
  pathToFileURL(join(senpiDistDir, "core", "extensions", "builtin", "mcp", "config-schema.js")).href
) as { validateMcpServerDeclaration: (name: string, raw: unknown) => string | null }

const silentLogger: ComponentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function registrations(env: Record<string, string | undefined>): Array<{ name: string; config: Record<string, unknown> }> {
  const pi = new FakeExtensionAPI()
  createBuiltinMcpsComponent({ env }).register(pi, { logger: silentLogger, config: { getFlag: () => undefined } })
  return pi.mcpServers
}

describe("builtin-mcps host declaration contract", () => {
  it.each([
    { label: "anonymous", env: {} },
    { label: "bearer", env: { CONTEXT7_API_KEY: "ctx7sk-live-secret" } },
  ])("#given the $label declarations #when the installed senpi validator runs #then every declaration is accepted", ({ env }) => {
    // given
    const declared = registrations(env)

    // when
    const errors = declared.map(({ name, config }) => validateMcpServerDeclaration(name, config))

    // then
    expect(declared.map(({ name }) => name)).toEqual(["context7", "grep_app"])
    expect(errors).toEqual([null, null])
  })
})
