import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Type } from "typebox"

import {
  designpowersThirdPartyRelativePaths,
  frontendSkillRoot,
  thirdPartyRelativePaths,
} from "../../shared-skills/scripts/frontend-refs-manifest.mjs"
import { FakeExtensionAPI } from "../test-support/fake-extension-api"
import extension from "./extension/index"
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "./senpi-test-runtime"

// Model-facing text must never name an eval-only tool as a direct call (#14034): a model that follows
// "call thread_list first" finds no thread_list in its tool list and decides the family never registered.
// Contract guarded: every registered eval-only tool named in a shipped promptGuidelines entry, tool
// description, parameter description or bundled skill is written in its eval form (`tool.<name>(`) or in a
// sentence that says eval.
//
// The eval-only names come from the real engine (the pinned senpi dist publishes a redirect hint per
// eval-only tool it registers) plus every omo tool declared with exposure "eval". Only names that carry
// an underscore are scanned: single-word ones (bash, grep, glob, exec, wait, monitor) are also shell
// commands and English words, so a bare token cannot tell a tool call from prose or a code sample.
// Frontend references materialized verbatim from pinned third-party upstreams are not omo's text to
// rewrite; the omo-authored router beside them (references/design/_INDEX.md) carries the eval form.

const PACKAGE_ROOT = join(import.meta.dir, "..")
const SKILL_ROOTS = [
  join(PACKAGE_ROOT, "skills"),
  join(PACKAGE_ROOT, "..", "shared-skills", "skills"),
  join(PACKAGE_ROOT, "src", "components", "x-search", "skill"),
]

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function engineEvalOnlyNames(): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "eval-only-mentions-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  // codemode's kernel leaves a temp dir behind (#9766); the stub below stands in for its eval tool.
  const settingsManager = SettingsManager.inMemory({
    defaultProjectTrust: "always",
    disabledBuiltinExtensions: ["codemode"],
  })
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        pi.registerTool({
          name: "eval",
          label: "Eval",
          description: "Evaluate code",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: "text" as const, text: "eval" }],
            details: {},
          }),
        })
      },
    ],
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    settingsManager,
    modelRegistry: new ModelRegistry(ModelRuntime.createSync({ modelsPath: null })),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    autoTitleSessions: false,
  })
  await session.bindExtensions({ mode: "print" })
  const names = Object.keys(session.agent.removedToolHints)
  session.dispose()
  await session.whenToolChildClosed()
  return names
}

interface ModelFacingText {
  readonly source: string
  readonly text: string
}

const THIRD_PARTY = new Set(
  [...thirdPartyRelativePaths(), ...designpowersThirdPartyRelativePaths()].map((path) => join(frontendSkillRoot, path)),
)

function shippedSkillTexts(): ModelFacingText[] {
  return SKILL_ROOTS.flatMap((root) =>
    [...new Bun.Glob("**/*.md").scanSync({ cwd: root })]
      .filter((file) => !THIRD_PARTY.has(join(root, file)))
      .map((file) => ({
        source: relative(PACKAGE_ROOT, join(root, file)),
        text: readFileSync(join(root, file), "utf8"),
      })),
  )
}

// A bare mention passes only when its own sentence says eval, so one "eval" on a long line cannot cover it.
function directMentions(names: readonly string[], texts: readonly ModelFacingText[]): string[] {
  const patterns = names.map((name) => ({ name, pattern: new RegExp(`(?<![\\w.])${name}(?!\\w)`) }))
  return texts.flatMap(({ source, text }) =>
    text.split("\n").flatMap((line, index) =>
      line
        .split(/(?<=[.!?;])\s+/)
        .filter((sentence) => !/\beval\b/i.test(sentence))
        .flatMap((sentence) =>
          patterns
            .filter(({ pattern }) => pattern.test(sentence))
            .map(({ name }) => `${source}:${index + 1} names ${name} without its eval form: ${sentence.trim()}`),
        ),
    ),
  )
}

interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly exposure: unknown
  readonly promptGuidelines: readonly string[]
  readonly parameterDescriptions: readonly string[]
}

function schemaDescriptions(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(schemaDescriptions)
  if (typeof schema !== "object" || schema === null) return []
  return Object.entries(schema).flatMap(([key, value]) =>
    key === "description" && typeof value === "string" ? [value] : schemaDescriptions(value),
  )
}

function registeredTool(record: Record<string, unknown>): RegisteredTool {
  const { name, description, exposure, promptGuidelines, parameters } = record
  if (typeof name !== "string" || typeof description !== "string") throw new Error("tool without name or description")
  const guidelines = Array.isArray(promptGuidelines)
    ? promptGuidelines.filter((entry) => typeof entry === "string")
    : []
  return {
    name,
    description,
    exposure,
    promptGuidelines: guidelines,
    parameterDescriptions: schemaDescriptions(parameters),
  }
}

describe("eval-only tools in model-facing text", () => {
  test("#given the registered eval-only tools #when shipped guidelines, descriptions and skills name one #then they name its eval form", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await extension(pi)
    const tools = pi.tools.map(registeredTool)
    const omoEvalOnly = tools.filter((tool) => tool.exposure === "eval").map((tool) => tool.name)
    const names = [...new Set([...(await engineEvalOnlyNames()), ...omoEvalOnly])].filter((name) => name.includes("_"))
    expect(names).toContain("thread_list")
    expect(names).toContain("generate_image")

    // when
    const toolTexts = tools.flatMap((tool) => [
      { source: `${tool.name} description`, text: tool.description },
      ...tool.promptGuidelines.map((text) => ({ source: `${tool.name} promptGuidelines`, text })),
      ...tool.parameterDescriptions.map((text) => ({ source: `${tool.name} parameters`, text })),
    ])
    const mentions = directMentions(names, [...toolTexts, ...shippedSkillTexts()])

    // then
    expect(mentions).toEqual([])
  })
})
