/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { generateStandaloneParity } from "../../../scripts/standalone-parity/generator"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createStandaloneParityComponent } from "./index"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function generatedFixture(openViking = false): Promise<{ readonly betaRoot: string; readonly parityRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-standalone-component-"))
  roots.push(root)
  const source = join(root, "source")
  const parityRoot = join(root, "standalone-parity")
  await mkdir(join(source, "skills", "personal"), { recursive: true })
  await mkdir(join(source, "commands"), { recursive: true })
  await writeFile(join(source, "skills", "personal", "SKILL.md"), "---\nname: personal\ndescription: personal\n---\nbody")
  await writeFile(join(source, "commands", "hello.md"), "---\ndescription: hello\n---\nHi $1 then $2: $ARGUMENTS")
  await writeFile(join(source, "AGENTS.md"), "# Context")
  const pluginRoot = join(source, "openviking-plugin")
  const credentialPath = join(source, "ovcli.conf")
  if (openViking) {
    await mkdir(join(pluginRoot, "servers"), { recursive: true })
    await mkdir(join(pluginRoot, "lib"), { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@openviking/opencode-plugin", version: "0.2.4" }))
    await writeFile(join(pluginRoot, "servers", "mcp-proxy.mjs"), "process.stdin.resume()\n")
    await writeFile(join(pluginRoot, "lib", "config.mjs"), [
      "export function loadConfig() { return {} }",
      "export function resolveDataDir(pluginRoot) { return pluginRoot }",
      "",
    ].join("\n"))
    await writeFile(join(pluginRoot, "lib", "memory-session.mjs"), [
      "export const calls = []",
      "export function createMemorySessionManager() {",
      "  return {",
      "    init: async () => calls.push('init'),",
      "    handleEvent: async (event) => calls.push(`event:${event.type}`),",
      "    flushSession: async (id) => calls.push(`flush:${id}`),",
      "    flushAll: async () => calls.push('flushAll'),",
      "    getMappedSessionId: (id) => `ov-${id}`",
      "  }",
      "}",
      "",
    ].join("\n"))
    await writeFile(join(pluginRoot, "lib", "session-inject.mjs"), [
      "export function createSessionInject() {",
      "  return { injectSessionContext: async (_input, output) => output.parts.unshift({ type: 'text', text: '<openviking-context source=\"session-start\">\\nprofile\\n</openviking-context>' }) }",
      "}",
      "",
    ].join("\n"))
    await writeFile(join(pluginRoot, "lib", "memory-recall.mjs"), [
      "export function createMemoryRecall() {",
      "  return { injectRelevantMemories: async (_input, output) => output.parts.unshift({ type: 'text', text: '<openviking-context source=\"recall\">\\nrecalled\\n</openviking-context>' }) }",
      "}",
      "",
    ].join("\n"))
    await writeFile(credentialPath, "{}")
  }
  await generateStandaloneParity({
    outputRoot: parityRoot,
    skillRoots: [join(source, "skills")],
    commandRoots: [join(source, "commands")],
    instructionPaths: [join(source, "AGENTS.md")],
    openVikingPluginRoot: openViking ? pluginRoot : undefined,
    openVikingCredentialPath: openViking ? credentialPath : undefined,
  })
  return { betaRoot: root, parityRoot }
}

const context = {
  logger: { info() {}, warn() {}, error() {} },
  config: { getFlag: () => undefined },
}

describe("createStandaloneParityComponent", () => {
  test("#given a verified beta payload #when resources are discovered under the beta HOME #then exposes copied skills and generated commands", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)

    // when
    const resources = await pi.dispatch("resources_discover", { type: "resources_discover" })

    // then
    expect(resources).toEqual([{ skillPaths: [join(parityRoot, "skills", "personal")] }])
    expect(pi.commands.map((command) => command.name)).toEqual(["hello"])
  })

  test("#given a verified payload outside the beta HOME #when registered #then exposes no generated resource", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "other") }).register(pi, context)

    // when
    const resources = await pi.dispatch("resources_discover", { type: "resources_discover" })

    // then
    expect(resources).toEqual([])
    expect(pi.commands).toEqual([])
  })

  test("#given a generated command #when invoked with positional arguments #then renders positional and complete arguments", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)
    const handler = pi.commands[0]?.options.handler

    // when
    if (typeof handler !== "function") throw new Error("generated command handler missing")
    handler("first second")

    // then
    expect(pi.userMessages).toEqual([{ content: "Hi first then second: first second", options: undefined }])
  })

  test("#given a packaged OpenViking proxy #when the component registers MCP servers #then resolves its parity-root placeholder", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture(true)
    const pi = new FakeExtensionAPI()

    // when
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)

    // then
    expect(pi.mcpServers).toEqual([{
      name: "openviking",
      config: {
        type: "stdio",
        command: "node",
        args: [join(parityRoot, "openviking-plugin", "servers", "mcp-proxy.mjs")],
        env: { OPENVIKING_CLI_CONFIG_FILE: join(betaRoot, "source", "ovcli.conf") },
      },
    }])
  })

  test("#given a packaged OpenViking runtime #when lifecycle events fire #then the component loads and drives the pinned implementation", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture(true)
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)

    // when
    await pi.dispatch("session_start", {}, { sessionId: "session-1" })
    const results = await pi.dispatch("before_agent_start", { systemPrompt: "BASE", prompt: "question" }, { sessionId: "session-1" })
    await pi.dispatch("message_end", { message: { id: "assistant-1", role: "assistant", content: "answer" } }, { sessionId: "session-1" })
    await pi.dispatch("session_compact", { accepted: true }, { sessionId: "session-1" })
    await pi.dispatch("session_shutdown", {}, { sessionId: "session-1" })

    // then
    const result = results[0]
    const systemPrompt = result === null || typeof result !== "object" ? "" : Reflect.get(result, "systemPrompt")
    expect(systemPrompt).toContain("profile\n\nrecalled")
    const sessionModule: unknown = await import(pathToFileURL(join(parityRoot, "openviking-plugin", "lib", "memory-session.mjs")).href)
    const calls = sessionModule === null || typeof sessionModule !== "object" ? undefined : Reflect.get(sessionModule, "calls")
    expect(calls).toEqual([
      "init",
      "event:session.created",
      "event:message.updated",
      "event:message.part.updated",
      "flush:session-1",
      "event:session.compacted",
      "event:session.deleted",
      "flushAll",
    ])
  })

  test("#given quoted command arguments #when invoked #then quoted values remain one positional argument", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)
    const handler = pi.commands[0]?.options.handler

    // when
    if (typeof handler !== "function") throw new Error("generated command handler missing")
    handler('"first value" second')

    // then
    expect(pi.userMessages).toEqual([{ content: 'Hi first value then second: "first value" second', options: undefined }])
  })

  test("#given instructions already injected #when another agent turn starts #then the sentinel block remains single-copy", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    const pi = new FakeExtensionAPI()
    await createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)
    const first = await pi.dispatch("before_agent_start", { systemPrompt: "BASE" })
    const firstResult = first[0]
    const systemPrompt = firstResult === null || typeof firstResult !== "object" ? "" : Reflect.get(firstResult, "systemPrompt")

    // when
    const second = await pi.dispatch("before_agent_start", { systemPrompt })

    // then
    const secondResult = second[0]
    const reinjected = secondResult === null || typeof secondResult !== "object" ? "" : Reflect.get(secondResult, "systemPrompt")
    expect(typeof reinjected === "string" ? reinjected.match(/<!-- omo-standalone-parity:instructions -->/gu)?.length : 0).toBe(1)
  })

  test("#given a payload whose generated file hash is invalid #when registering #then fails closed without exposing resources", async () => {
    // given
    const { betaRoot, parityRoot } = await generatedFixture()
    await writeFile(join(parityRoot, "instructions.md"), "tampered")
    const pi = new FakeExtensionAPI()

    // when
    await expect(createStandaloneParityComponent({ betaRoot, parityRoot, homeDir: join(betaRoot, "home") }).register(pi, context)).resolves.toBeUndefined()
    const resources = await pi.dispatch("resources_discover", { type: "resources_discover" })

    // then
    expect(resources).toEqual([])
    expect(pi.commands).toEqual([])
    expect(pi.mcpServers).toEqual([])
  })
})
