import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SkillMcpManager } from "./manager"
import { createFileGrantStore } from "./env-grant-store"
import { declarationDigest } from "./project-env-policy"
import { resolveGrantsStorePath } from "./env-grants-store"
import { setStdioClientDependenciesForTesting } from "./stdio-client"

async function bounded<T>(promise: Promise<T>): Promise<T> {
  const timeout = Promise.withResolvers<T>()
  const timer = setTimeout(() => timeout.reject(new Error("Expected cross-process event did not arrive")), 10_000)
  try { return await Promise.race([promise, timeout.promise]) }
  finally { clearTimeout(timer) }
}

async function runWriter(root: string, operation: string): Promise<void> {
  const module = new URL("./env-grants-store.ts", import.meta.url).href
  const code = `import {addGrant,revoke} from ${JSON.stringify(module)}; ${operation}`
  const child = Bun.spawn([process.execPath, "-e", code], {
    cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: {
      PATH: process.env.PATH, HOME: root, SYSTEMROOT: process.env.SYSTEMROOT,
      TMPDIR: process.env.TMPDIR ?? root, TMP: process.env.TMP, TEMP: process.env.TEMP,
      RUN_TMP: process.env.RUN_TMP,
      NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE ?? join(root, "ncc"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ?? join(root, "bun-tc"),
    },
  })
  try {
    const code = await bounded(child.exited)
    if (code !== 0) throw new Error(`Synthetic writer exited ${code}: ${await new Response(child.stderr).text()}`)
  } finally {
    if (child.exitCode === null) { child.kill(); await child.exited }
  }
}

test("separate atomic writers converge and revoke closes a live legacy transport and pending materialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-cross-grants-"))
  const source = join(root, "project", "SKILL.md")
  mkdirSync(join(root, "project"))
  writeFileSync(source, "Synthetic source\n")
  const store = createFileGrantStore(join(root, "config"))
  const path = resolveGrantsStorePath(join(root, "config"))
  const info = {
    sessionID: "cross-process", skillName: "fixture", serverName: "fixture", scope: "project",
    directory: join(root, "project"), sourcePath: source,
  }
  const config = { command: "synthetic", env: { AUTH_HEADER: "${OMO_CROSS_TOKEN}" } }
  const identity = declarationDigest(info, config)
  const second = "b".repeat(64)
  const label = JSON.stringify({ project: root, skill: "fixture", server: "fixture" })
  const oldToken = process.env.OMO_CROSS_TOKEN
  process.env.OMO_CROSS_TOKEN = "synthetic-cross-value"
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const closed = Promise.withResolvers<void>()
  const observed = Promise.withResolvers<void>()
  const environments: (Record<string, string> | undefined)[] = []
  let connections = 0
  setStdioClientDependenciesForTesting({
    createTransport: (options) => {
      environments.push(options.env)
      return { start: async () => {}, send: async () => {}, close: async () => {} }
    },
    createClient: () => {
      const index = ++connections
      return {
        connect: async () => { if (index === 3) { started.resolve(); await release.promise } },
        close: async () => { if (index === 2) closed.resolve() },
        listTools: async () => ({ tools: [] }), listResources: async () => ({ resources: [] }),
        listPrompts: async () => ({ prompts: [] }), callTool: async () => ({ content: [] }),
        readResource: async () => ({ contents: [] }), getPrompt: async () => ({ messages: [] }),
      }
    },
  })
  const manager = new SkillMcpManager({ grantStore: store })
  const stop = store.watch((event) => { if ((event?.snapshot.generation ?? 0) >= 2) observed.resolve() })
  try {
    await manager.getOrCreateClient(info, config)
    expect(environments.at(-1)?.AUTH_HEADER).toBe("${OMO_CROSS_TOKEN}")
    await Promise.all([
      runWriter(root, `await addGrant(${JSON.stringify(path)},${JSON.stringify(identity)},${label},["OMO_CROSS_TOKEN"]);`),
      runWriter(root, `await addGrant(${JSON.stringify(path)},${JSON.stringify(second)},${label},["ODD_DSN"]);`),
    ])
    await bounded(observed.promise)
    await manager.getOrCreateClient(info, config)
    expect(environments.at(-1)?.AUTH_HEADER).toBe("synthetic-cross-value")
    const pending = manager.getOrCreateClient({ ...info, sessionID: "cross-process-pending" }, config)
    const rejected = pending.then(
      () => Promise.reject(new Error("Pending materialization resolved instead of failing on the policy change")),
      (error: unknown) => { expect(error instanceof Error ? error.message : String(error)).toContain("policy changed") },
    )
    await bounded(started.promise)
    await runWriter(root, `await revoke(${JSON.stringify(path)},${JSON.stringify(identity)});`)
    await bounded(Promise.all([closed.promise, rejected]))
    expect((await store.read()).grants[identity]).toBeUndefined()
    expect((await store.read()).grants[second]?.names).toEqual(["ODD_DSN"])
    await manager.getOrCreateClient(info, config)
    expect(environments.at(-1)?.AUTH_HEADER).toBe("${OMO_CROSS_TOKEN}")
  } finally {
    release.resolve()
    stop()
    await manager.disconnectAll()
    setStdioClientDependenciesForTesting()
    if (oldToken === undefined) delete process.env.OMO_CROSS_TOKEN
    else process.env.OMO_CROSS_TOKEN = oldToken
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
