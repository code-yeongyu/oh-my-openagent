import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { McpClient, McpTransport } from "./types"
import { SkillMcpManager } from "./manager"
import { setStdioClientDependenciesForTesting } from "./stdio-client"
import { createSkillMcpTool } from "../../tools/skill-mcp/tools"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const transports: StdioServerParameters[] = []
const managers: SkillMcpManager[] = []
const notices: string[] = []
const roots: string[] = []
const synthetic = {
  OMO_TEST_OPAQUE: "synthetic-opaque-value",
  OMO_TEST_DSN: "synthetic-dsn-value",
  OMO_TEST_COOKIE: "synthetic-cookie-value",
  LC_SECRET: "synthetic-locale-value",
  GITHUB_TOKEN: "synthetic-github-value",
  NODE_ENV: "synthetic-node-env",
  JAVA_HOME: "synthetic-java-home",
}
const original = new Map<string, string | undefined>()
const fakeClient = (): McpClient => ({
  connect: async () => {},
  close: mock(async () => {}),
  listTools: async () => ({ tools: [] }),
  listResources: async () => ({ resources: [] }),
  listPrompts: async () => ({ prompts: [] }),
  callTool: async () => ({ content: [{ type: "text", text: "synthetic answer" }] }),
  readResource: async () => ({ contents: [] }),
  getPrompt: async () => ({ messages: [] }),
})
beforeEach(() => {
  transports.length = 0
  notices.length = 0
  for (const [name, value] of Object.entries(synthetic)) {
    original.set(name, process.env[name])
    process.env[name] = value
  }
  setStdioClientDependenciesForTesting({
    createClient: fakeClient,
    createTransport: (options): McpTransport => {
      transports.push(options)
      return { start: async () => {}, send: async () => {}, close: async () => {} }
    },
  })
})
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disconnectAll()
  setStdioClientDependenciesForTesting()
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  original.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
type Grant = { label: { project: string; skill: string; server: string }; names: readonly string[] }
function memoryStore() {
  let generation = 0
  const grants = new Map<string, Grant>()
  const listeners = new Set<() => void>()
  return {
    read: async () => ({ version: 1 as const, generation, grants: Object.fromEntries(grants) }),
    list: async () => Object.fromEntries(grants),
    digest: async () => String(generation),
    add: async (digest: string, grant: Grant) => {
      grants.set(digest, { ...grant, names: [...new Set([...(grants.get(digest)?.names ?? []), ...grant.names])].sort() })
      generation++
      for (const listener of listeners) listener()
    },
    revoke: async (digest: string) => {
      grants.delete(digest)
      generation++
      for (const listener of listeners) listener()
    },
    watch: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
function manager(grantStore = memoryStore()) {
  const m = new SkillMcpManager(Object.assign({}, {
    onEnvironmentNotice: (message: string) => notices.push(message),
    grantStore,
  }))
  managers.push(m)
  return m
}
const info = (scope: string) => ({
  sessionID: "synthetic-session", skillName: "synthetic-skill", serverName: "synthetic-server",
  scope, directory: "/synthetic/project",
  provenance: { kind: scope === "host" ? "host" : "project-auto", selectedRoot: "/synthetic/project/skills", projectRoot: "/synthetic/project" },
  sourcePath: "/synthetic/project/skills/SKILL.md",
})
const config = { command: "synthetic-command", env: { AUTH_HEADER: "${GITHUB_TOKEN}", LITERAL: "synthetic-literal" } }

describe("project MCP policy at the real manager boundary", () => {
  test.each(["project", "opencode-project", "host"])("withholds off-pattern ambient names and literal-left refs for %s", async (scope) => {
    // given
    const m = manager()
    // when
    await m.getOrCreateClient(info(scope), config)
    // then
    const env = transports[0]?.env ?? {}
    for (const name of ["OMO_TEST_OPAQUE", "OMO_TEST_DSN", "OMO_TEST_COOKIE", "LC_SECRET"]) expect(env[name]).toBeUndefined()
    expect(env.AUTH_HEADER).toBe("${GITHUB_TOKEN}")
    expect(env.LITERAL).toBe("synthetic-literal")
    expect(notices.join("\n")).toContain("GITHUB_TOKEN")
    expect(notices.join("\n")).toMatch(/\/omo-mcp-env-grant [a-zA-Z0-9_-]+/)
    for (const value of Object.values(synthetic)) expect(notices.join("\n")).not.toContain(value)
  })

  test("user policy keeps today's NODE_ENV and JAVA_HOME unchanged", async () => {
    // given
    const m = manager()
    // when
    await m.getOrCreateClient({ sessionID: "user", skillName: "user", serverName: "user", scope: "user" }, config)
    // then
    expect(transports[0]?.env?.NODE_ENV).toBe(synthetic.NODE_ENV)
    expect(transports[0]?.env?.JAVA_HOME).toBe(synthetic.JAVA_HOME)
    expect(transports[0]?.env?.AUTH_HEADER).toBe(synthetic.GITHUB_TOKEN)
    expect(notices).toEqual([])
  })

  test("racing capability discovery uses one decision and one child", async () => {
    // given
    const m = manager()
    const i = info("project")
    const context = { skillName: i.skillName, config }
    // when
    await Promise.all([m.listTools(i, context), m.listResources(i, context), m.listPrompts(i, context)])
    // then
    expect(transports).toHaveLength(1)
    expect(notices).toHaveLength(1)
  })

  test("changed declaration cannot reuse a client from the same skill and server name", async () => {
    // given
    const m = manager()
    await m.getOrCreateClient(info("project"), config)
    // when
    await m.getOrCreateClient(info("project"), { ...config, command: "changed-command" })
    // then
    expect(transports.map((t) => t.command)).toEqual(["synthetic-command", "changed-command"])
  })

  test("skill_mcp result includes the exact names-only grant action", async () => {
    // given
    const m = manager()
    const source = mkdtempSync(join(tmpdir(), "mcp-policy-source-"))
    roots.push(source)
    const path = join(source, "SKILL.md")
    writeFileSync(path, `---\nmcp:\n  synthetic-server:\n    command: synthetic-command\n    env:\n      AUTH_HEADER: "\${GITHUB_TOKEN}"\n      LITERAL: synthetic-literal\n---\nFixture\n`)
    const skill = {
      name: "synthetic-skill", scope: "project" as const,
      path,
      definition: { name: "synthetic-skill", template: "" },
      mcpConfig: { "synthetic-server": config },
    }
    const tool = createSkillMcpTool({ manager: m, getLoadedSkills: () => [skill], getSessionID: () => "synthetic-session" })
    // when
    const result = await tool.execute({ mcp_name: "synthetic-server", tool_name: "synthetic" }, {
      sessionID: "synthetic-session", messageID: "synthetic-message", agent: "synthetic",
      directory: "/synthetic/project", worktree: "/synthetic/project",
      abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
    })
    // then
    expect(result).toMatch(/\/omo-mcp-env-grant [a-zA-Z0-9_-]+/)
    expect(result).toContain("GITHUB_TOKEN")
    expect(result).not.toContain(synthetic.GITHUB_TOKEN)
  })

  test("grant saves only a displayed subset and re-resolves the retained raw reference", async () => {
    // given
    const store = memoryStore()
    const m = manager(store)
    await m.getOrCreateClient(info("host"), config)
    const id = notices[0]?.match(/\/omo-mcp-env-grant ([a-zA-Z0-9_-]+)/)?.[1]
    if (!id) throw new Error("No pending grant action")
    // when
    await m.grantEnvironment(id, ["GITHUB_TOKEN"])
    await m.getOrCreateClient(info("host"), config)
    // then
    expect(transports.at(-1)?.env?.AUTH_HEADER).toBe(synthetic.GITHUB_TOKEN)
    expect(transports.at(-1)?.env?.OMO_TEST_OPAQUE).toBeUndefined()
    expect(Object.values(await store.list())[0]?.names).toEqual(["GITHUB_TOKEN"])
    expect(JSON.stringify(await store.read())).not.toContain(synthetic.GITHUB_TOKEN)
  })

  test("grant rejects a name outside the exact displayed set without writing", async () => {
    // given
    const store = memoryStore()
    const m = manager(store)
    await m.getOrCreateClient(info("project"), config)
    const id = notices[0]?.match(/\/omo-mcp-env-grant ([a-zA-Z0-9_-]+)/)?.[1]
    if (!id) throw new Error("No pending grant action")
    // when / then
    await expect(m.grantEnvironment(id, ["UNDISPLAYED"])).rejects.toThrow()
    expect(await store.list()).toEqual({})
  })

  test("revoke converges to the latest snapshot before the next connection starts", async () => {
    // given
    const store = memoryStore()
    const m = manager(store)
    await m.getOrCreateClient(info("project"), config)
    const id = notices[0]?.match(/\/omo-mcp-env-grant ([a-zA-Z0-9_-]+)/)?.[1]
    if (!id) throw new Error("No pending grant action")
    await m.grantEnvironment(id, ["GITHUB_TOKEN"])
    await m.getOrCreateClient(info("project"), config)
    const [digest] = Object.keys(await store.list())
    if (!digest) throw new Error("Grant did not persist")
    // when
    await store.revoke(digest)
    await m.getOrCreateClient(info("project"), config)
    // then
    expect(transports.at(-1)?.env?.AUTH_HEADER).toBe("${GITHUB_TOKEN}")
    expect(await store.list()).toEqual({})
  })

  test("failed permanent grant writes never confirm or restore an environment value", async () => {
    // given
    const store = memoryStore()
    store.add = async () => { throw new Error("synthetic store write failure") }
    const m = manager(store)
    await m.getOrCreateClient(info("project"), config)
    const id = notices[0]?.match(/\/omo-mcp-env-grant ([a-zA-Z0-9_-]+)/)?.[1]
    if (!id) throw new Error("No pending grant action")
    // when / then
    await expect(m.grantEnvironment(id, ["GITHUB_TOKEN"])).rejects.toThrow("synthetic store write failure")
    await m.getOrCreateClient(info("project"), config)
    expect(transports.at(-1)?.env?.AUTH_HEADER).toBe("${GITHUB_TOKEN}")
    expect(await store.list()).toEqual({})
  })
})
