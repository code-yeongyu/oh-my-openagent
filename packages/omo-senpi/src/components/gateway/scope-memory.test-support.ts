import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { GitMemoryRepo, resolveMemoryIdentity, resolveMemoryRoot } from "@oh-my-opencode/memory-core"

import { createGatewayHarness } from "../thread/gateway/testing/harness"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createGatewayComponent } from "./index"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"
import { GATEWAY_RULES_SESSION_OPS } from "./store-extension/session-ops"
import { resolveScopeMemoryIdentity } from "./scope-identity"

const logger = { info() {}, warn() {}, error() {} }

export async function scopeFixture(options: { relativeMemoryHome?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omo-t19-"))
  const env = { OMO_MEMORY_HOME: options.relativeMemoryHome ? "./memory" : join(root, "memory"), OMO_CODING_AGENT_DIR: root }
  const workspace = join(root, "workspace")
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./store-extension/index.ts", import.meta.url))],
    outdir: root, target: "bun", format: "esm", naming: "scope-extension.mjs",
  })
  if (!built.success) throw new Error(built.logs.map(String).join("\n"))
  const moduleUrl = pathToFileURL(join(root, "scope-extension.mjs")).href
  const harness = createGatewayHarness()
  const store = harness.store()
  const registered = await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl, sessionCallable: GATEWAY_RULES_SESSION_OPS })
  if (registered.kind !== "ok") throw new Error(JSON.stringify(registered))
  const pi = new FakeExtensionAPI()
  pi.cwd = workspace
  createGatewayComponent({
    agentDir: () => harness.agentDir,
    loadGatewaySection: () => ({ scopes: [{ id: "A" }, { id: "B" }] }),
    createStore: () => store, resolveModuleUrl: () => moduleUrl, env,
  }).register(pi, { logger, config: { getFlag: () => undefined } })
  const call = async <T>(op: string, args: unknown): Promise<T> => {
    const result = await store.extensionCall<T>(GATEWAY_RULES_EXTENSION_NAME, op, args)
    if (result.kind !== "ok") throw new Error(`${op}: ${JSON.stringify(result)}`)
    return result.value
  }
  /** An internal op as `session`'s own component runs it: the store stamps the caller. */
  const callAs = async <T>(session: string, op: string, args: unknown = {}): Promise<T> => {
    const result = await store.extensionSessionAwait<T>(GATEWAY_RULES_EXTENSION_NAME, op, args, { callerDurableId: session })
    if (result.kind !== "ok") throw new Error(`${op}: ${JSON.stringify(result)}`)
    return result.value
  }
  const members = async (scope: string, identity: string | null, list: readonly { session_durable_id: string; role: "lead" | "worker" }[], expected?: number) => {
    const version = expected ?? (await call<{ version: number }>("scopeMembersVersion", { scope })).version
    return call("scopeMembersCommitted", { scope, memory_identity: identity, members: list, expected_version: version, now: 1_000 })
  }
  const context = (session: string, cwd = workspace) => ({ cwd, sessionManager: { getSessionId: () => session, getBranch: () => [] } })
  const tool = pi.tools.find((entry) => entry.name === "gateway_learning")
  const learn = async (session: string, args: unknown, cwd = workspace) => {
    if (typeof tool?.execute !== "function") throw new Error("gateway_learning is not registered")
    return Reflect.apply(tool.execute, tool, ["test-call", args, undefined, undefined, context(session, cwd)])
  }
  const prompt = async (session: string, base = "PROJECT MEMORY", cwd = workspace) => {
    let current = base
    for (const entry of pi.handlers.filter((entry) => entry.event === "before_agent_start")) {
      const result = await entry.handler({ type: "before_agent_start", systemPrompt: current }, context(session, cwd))
      if (result !== undefined && result !== null && typeof result === "object" && typeof Reflect.get(result, "systemPrompt") === "string") current = String(Reflect.get(result, "systemPrompt"))
    }
    return current
  }
  const repo = (identity: string, scope = identity === "team-A" ? "A" : identity === "team-B" ? "B" : undefined) => {
    const resolved = scope === undefined ? resolveMemoryIdentity(identity, workspace, env)
      : resolveScopeMemoryIdentity(scope, identity, resolveMemoryRoot(env, root), workspace)
    return new GitMemoryRepo({ dir: resolved.paths.repo, agentId: resolved.id })
  }
  return {
    root, env, workspace, store, pi, call, callAs, members, context, learn, prompt, repo,
    async dispose() { await harness.dispose(); rmSync(root, { recursive: true, force: true }) },
  }
}

export type ScopeFixture = Awaited<ReturnType<typeof scopeFixture>>
