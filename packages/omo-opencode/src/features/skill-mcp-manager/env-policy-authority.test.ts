import { afterEach, expect, test } from "bun:test"
import { SkillMcpManager } from "./manager"
import type { GrantStore, EnvGrant } from "./index"
import { setStdioClientDependenciesForTesting } from "./stdio-client"
import { setHttpClientDependenciesForTesting } from "./http-client"
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"

const managers: SkillMcpManager[] = []
let restoreToken: string | undefined
let tokenChanged = false
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disconnectAll()
  setStdioClientDependenciesForTesting()
  setHttpClientDependenciesForTesting()
  if (tokenChanged) {
    if (restoreToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = restoreToken
    tokenChanged = false
  }
})
function fixture() {
  restoreToken = process.env.GITHUB_TOKEN
  tokenChanged = true
  process.env.GITHUB_TOKEN = "synthetic-first-value"
  const transports: StdioServerParameters[] = []
  const urls: string[] = []
  const createClient = () => ({
    connect: async () => {}, close: async () => {},
    listTools: async () => ({ tools: [] }), listResources: async () => ({ resources: [] }),
    listPrompts: async () => ({ prompts: [] }), callTool: async () => ({ content: [] }),
    readResource: async () => ({ contents: [] }), getPrompt: async () => ({ messages: [] }),
  })
  const closed: string[] = []
  const transport = (label = "") => ({ start: async () => {}, send: async () => {}, close: async () => { closed.push(label) } })
  setStdioClientDependenciesForTesting({
    createClient, createTransport: (options) => { transports.push(options); return transport(options.command) },
  })
  setHttpClientDependenciesForTesting({
    createClient, createTransport: (url) => { urls.push(url.toString()); return transport() },
  })
  let generation = 0
  const grants: Record<string, EnvGrant> = {}
  const listeners = new Set<() => void | Promise<void>>()
  const store: GrantStore = {
    read: async () => ({ version: 1, generation, grants: { ...grants } }),
    list: async () => ({ ...grants }), digest: async () => String(generation),
    add: async (digest, grant) => {
      grants[digest] = grant; generation++
      await Promise.all([...listeners].map((listener) => listener()))
    },
    revoke: async (digest) => { delete grants[digest]; generation++ },
    watch: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const notices: string[] = []
  const manager = new SkillMcpManager(Object.assign({}, { grantStore: store, onEnvironmentNotice: (message: string) => notices.push(message) }))
  managers.push(manager)
  const info = {
    sessionID: "synthetic-authority", skillName: "fixture", serverName: "fixture", scope: "project",
    directory: "/synthetic/first", sourcePath: "/synthetic/first/SKILL.md",
  }
  const config = { command: "synthetic-command", env: { AUTH_HEADER: "${GITHUB_TOKEN}", NODE_OPTIONS: "--conditions=synthetic-first" } }
  const grant = async () => {
    const id = notices.at(-1)?.match(/\/omo-mcp-env-grant ([a-zA-Z0-9_-]+)/)?.[1]
    if (!id) throw new Error("No exact grant command")
    await manager.grantEnvironment(id, ["GITHUB_TOKEN"])
  }
  return { manager, info, config, store, transports, closed, urls, notices, grant }
}

test.each(["repository", "command", "NODE_OPTIONS"])("a grant cannot cross a changed %s authority", async (change) => {
  // given
  const f = fixture()
  await f.manager.getOrCreateClient(f.info, f.config)
  await f.grant()
  await f.manager.getOrCreateClient(f.info, f.config)
  expect(f.transports.at(-1)?.env?.AUTH_HEADER).toBe("synthetic-first-value")
  // when
  const info = change === "repository" ? { ...f.info, directory: "/synthetic/second", sourcePath: "/synthetic/second/SKILL.md" } : f.info
  const config = change === "command" ? { ...f.config, command: "changed-command" } :
    change === "NODE_OPTIONS" ? { ...f.config, env: { ...f.config.env, NODE_OPTIONS: "--conditions=synthetic-second" } } : f.config
  await f.manager.getOrCreateClient(info, config)
  // then
  expect(f.transports.at(-1)?.env?.AUTH_HEADER).toBe("${GITHUB_TOKEN}")
  expect(f.notices.at(-1)).toContain("GITHUB_TOKEN")
  expect(Object.keys(await f.store.list())).toHaveLength(1)
})

test("ambient token rotation preserves the declaration grant but re-resolves at materialization", async () => {
  // given
  const f = fixture()
  await f.manager.getOrCreateClient(f.info, f.config)
  await f.grant()
  await f.manager.getOrCreateClient(f.info, f.config)
  const noticeCount = f.notices.length
  const identities = Object.keys(await f.store.list())
  // when
  process.env.GITHUB_TOKEN = "synthetic-rotated-value"
  await f.manager.disconnectAll()
  await f.manager.getOrCreateClient(f.info, f.config)
  // then
  expect(f.transports.at(-1)?.env?.AUTH_HEADER).toBe("synthetic-rotated-value")
  expect(f.notices).toHaveLength(noticeCount)
  expect(Object.keys(await f.store.list())).toEqual(identities)
})

test("changing a remote URL asks again instead of reusing the granted client", async () => {
  // given
  const f = fixture()
  const config = { type: "http" as const, url: "https://first.invalid/mcp", headers: { Authorization: "${GITHUB_TOKEN}" } }
  await f.manager.getOrCreateClient(f.info, config)
  await f.grant()
  await f.manager.getOrCreateClient(f.info, config)
  expect(f.manager.getEnvironmentNotice(f.info)).toBeUndefined()
  // when
  await f.manager.getOrCreateClient(f.info, { ...config, url: "https://second.invalid/mcp" })
  // then
  expect(f.urls.at(-1)).toBe("https://second.invalid/mcp")
  expect(f.notices.at(-1)).toContain("GITHUB_TOKEN")
  expect(Object.keys(await f.store.list())).toHaveLength(1)
})

test("a shared authority decision exposes its notice to both requesting sessions", async () => {
  // given
  const f = fixture()
  const other = { ...f.info, sessionID: "synthetic-other-session" }
  // when
  await Promise.all([
    f.manager.getOrCreateClient(f.info, f.config),
    f.manager.getOrCreateClient(other, f.config),
  ])
  // then
  expect(f.notices).toHaveLength(1)
  expect(f.manager.getEnvironmentNotice(f.info)).toContain("GITHUB_TOKEN")
  expect(f.manager.getEnvironmentNotice(other)).toContain("GITHUB_TOKEN")
})

test("legacy user-policy clients with different provenance records cannot reuse one child", async () => {
  // given
  const f = fixture()
  const first = { ...f.info, scope: "user", provenance: { kind: "user" as const, selectedRoot: "/synthetic/user-first" } }
  const second = { ...first, provenance: { ...first.provenance, selectedRoot: "/synthetic/user-second" } }
  await f.manager.getOrCreateClient(first, f.config)
  // when
  await f.manager.getOrCreateClient(second, { ...f.config, command: "second-user-command" })
  // then
  expect(f.transports.map((transport) => transport.command)).toEqual(["synthetic-command", "second-user-command"])
  expect(f.transports.map((transport) => transport.env?.AUTH_HEADER)).toEqual(["synthetic-first-value", "synthetic-first-value"])
  expect(f.notices).toEqual([])
})

test("one grant write re-scopes only the server whose environment changed", async () => {
  // given: three live project MCP servers; only "fixture" has a withheld name (#10693 review M1)
  const { manager, info, config, transports, closed, notices, grant } = fixture()
  const others = ["alpha", "beta"].map((name) => ({
    info: { ...info, skillName: name, serverName: name, sourcePath: `/synthetic/first/${name}/SKILL.md` },
    config: { command: `synthetic-${name}` },
  }))
  for (const other of others) await manager.getOrCreateClient(other.info, other.config)
  await manager.getOrCreateClient(info, config)
  const live = () => transports.length - closed.length
  expect(live()).toBe(3)
  const noticesBefore = notices.length
  // when: one grant write bumps the shared store generation
  await grant()
  await manager.getOrCreateClient(info, config)
  for (const other of others) await manager.getOrCreateClient(other.info, other.config)
  // then: still exactly three live processes; only the granted server restarted, the others kept theirs
  expect(live()).toBe(3)
  expect(transports.filter((options) => options.command === "synthetic-command")).toHaveLength(2)
  expect(closed).toEqual(["synthetic-command"])
  for (const other of others) expect(transports.filter((options) => options.command === other.config.command)).toHaveLength(1)
  expect(notices.slice(noticesBefore).filter((message) => /server (alpha|beta) /.test(message))).toEqual([])
})
