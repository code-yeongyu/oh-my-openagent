/// <reference types="bun-types" />

type CommonJsRequire = {
  (modulePath: string): unknown
  resolve(modulePath: string): string
  cache?: Record<string, unknown>
}

declare const require: CommonJsRequire

import { afterAll, beforeEach, mock } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import * as fs from "node:fs"
import type { LoadedSkill } from "../../../features/opencode-skill-loader/types"
import type { CommandInfo } from "../../slashcommand/types"
import type { SkillLoadOptions } from "../types"

const originalReadFileSync = fs.readFileSync.bind(fs)

type SkillToolFactory = typeof import("../tools").createSkillTool
type TestSkillLoadOptions = Omit<SkillLoadOptions, "directory"> & {
  readonly directory?: SkillLoadOptions["directory"]
}

let createSkillToolFactory: SkillToolFactory | undefined

function clearRequireCache(modulePath: string): void {
  const resolvedPath = require.resolve(modulePath)
  if (require.cache?.[resolvedPath]) {
    delete require.cache[resolvedPath]
  }
}

function requireFresh<TModule>(modulePath: string): TModule {
  clearRequireCache(modulePath)
  return require(modulePath) as TModule
}

beforeEach(() => {
  mock.restore()
  clearRequireCache("../tools")
  clearRequireCache("../skill-body")
  clearRequireCache("../../../features/opencode-skill-loader/skill-content")
  clearRequireCache("../../../../../skills-loader-core/src/features/opencode-skill-loader/skill-content")
  clearRequireCache("../../../../../skills-loader-core/src/features/opencode-skill-loader/loaded-skill-template-extractor")
  clearRequireCache("../../slashcommand/command-discovery")

  mock.module("node:fs", () => ({
    ...fs,
    readFileSync: (path: string, encoding?: string) => {
      if (typeof path === "string" && path.includes("/skills/")) {
        return `---
description: Test skill description
---
Test skill body content`
      }
      return originalReadFileSync(path, encoding as BufferEncoding)
    },
  }))

  createSkillToolFactory = requireFresh<typeof import("../tools")>("../tools").createSkillTool
})

afterAll(() => {
  mock.restore()
})

export function createSkillTool(
  options: TestSkillLoadOptions = {},
): ReturnType<SkillToolFactory> {
  if (!createSkillToolFactory) {
    throw new Error("createSkillTool test factory was not initialized")
  }
  return createSkillToolFactory({ directory: "/test", ...options })
}

export function createMockSkill(
  name: string,
  options: { readonly agent?: string; readonly scope?: LoadedSkill["scope"] } = {},
): LoadedSkill {
  return {
    name,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
      agent: options.agent,
    },
    scope: options.scope ?? "opencode-project",
  }
}

export function createMockSkillWithMcp(
  name: string,
  mcpServers: Record<string, unknown>,
): LoadedSkill {
  return {
    name,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
    },
    scope: "opencode-project",
    mcpConfig: mcpServers as LoadedSkill["mcpConfig"],
  }
}

export function createMockCommand(name: string, scope: CommandInfo["scope"]) {
  return {
    name,
    path: `/test/commands/${name}.md`,
    metadata: {
      name,
      description: `Test command ${name}`,
    },
    scope,
  }
}

export const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}
