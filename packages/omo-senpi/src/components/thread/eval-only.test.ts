import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Type } from "typebox"

import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "../../senpi-test-runtime"
import type { ThreadToolResult } from "./contracts"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { THREAD_FAMILY_PROMPT_GUIDELINES, THREAD_TOOL_METADATA } from "./metadata"
import { createThreadTools, registerThreadTools, type ThreadHost, type ThreadHostSession } from "./tools"

// The eval-only contract (oh-my-openagent#12903) is senpi's policy over omo's declarations, so it is
// proven on a real engine session from the pinned dist rather than on the FakeExtensionAPI.

const THREAD_TOOL_NAMES = THREAD_TOOL_METADATA.map((entry) => entry.name)
const EVAL_HINT = /inside an eval cell via tool\.thread_read\(/

type Session = Awaited<ReturnType<typeof createAgentSession>>["session"]
type ExtensionFactory = NonNullable<ConstructorParameters<typeof DefaultResourceLoader>[0]["extensionFactories"]>[number]

const roots: string[] = []
const stores: GatewayStore[] = []
const sessions: Session[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose()
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(root: string) {
  const peer: ThreadHostSession = { sessionId: "route-peer", durableSessionId: "dur-peer", cwd: root, name: "peer", status: "open" }
  const getMessages = mock(async () => [{ role: "user" as const, content: "hello" }])
  const host: ThreadHost = {
    socket: join(root, "thread-eval-only.sock"),
    listSessions: async () => [peer],
    openSession: async () => peer,
    getMessages,
    getState: async () => ({ isStreaming: false }),
    prompt: async () => ({ turnId: "turn-1" }),
    interrupt: async () => ({ interrupted: false }),
    setSessionName: async () => {},
    setModel: async (_sessionId: string, provider: string, id: string) => ({ provider, id, name: "Selected model" }),
    getAvailableModels: async () => [],
    setThinkingLevel: async () => {},
    getAvailableThinkingLevels: async () => ["off", "high"],
  }
  const agentDir = join(root, "gateway-agent")
  mkdirSync(agentDir)
  const store = createGatewayStore({ agentDir })
  stores.push(store)
  const stateDirectory = join(root, "thread-state")
  mkdirSync(stateDirectory)
  return { host, store, stateDirectory, getMessages, callerSessionId: () => "caller", callerWorkspaceRoot: () => root }
}

const evalStub: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "eval",
    label: "Eval",
    description: "Evaluate code",
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text" as const, text: "eval" }], details: {} }),
  })
}

async function openSession(options: { readonly withEval: boolean; readonly extraFactories?: readonly ExtensionFactory[] }) {
  const root = mkdtempSync(join(tmpdir(), "thread-eval-only-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const f = fixture(root)
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", enabledBuiltinExtensions: [] })
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  const threadFactory: ExtensionFactory = (pi) => {
    registerThreadTools(pi as unknown as Parameters<typeof registerThreadTools>[0], f)
  }
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [threadFactory, ...(options.withEval ? [evalStub] : []), ...(options.extraFactories ?? [])],
  })
  await loader.reload()
  expect(loader.getExtensions().errors).toEqual([])
  const { session } = await createAgentSession({
    cwd: root, agentDir, settingsManager, modelRegistry: registry, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root), autoTitleSessions: false,
  })
  sessions.push(session)
  await session.bindExtensions({ mode: "print" })
  return { session, f, root }
}

function threadResult(result: { details: unknown }): ThreadToolResult {
  return (result.details as { result: ThreadToolResult }).result
}

type Outcome = { readonly threw: { readonly code: unknown; readonly toolName: unknown } } | { readonly result: ThreadToolResult }

async function outcomeOf(session: Session, name: string, args: unknown): Promise<Outcome> {
  try {
    return { result: threadResult(await session.executeTool(name, args, { activateInactiveTool: true })) }
  } catch (error) {
    const typed = error as { code?: unknown; toolName?: unknown }
    return { threw: { code: typed.code, toolName: typed.toolName } }
  }
}

describe("thread tools are eval-only, like bash", () => {
  test("#given an eval tool #when the family registers #then it is in the registry and the prompt but out of the direct tool list, and a direct call gets the eval redirect", async () => {
    // given
    const { session } = await openSession({ withEval: true })

    // when
    const registered = session.getAllTools().filter((tool) => THREAD_TOOL_NAMES.includes(tool.name))
    const active = session.getActiveToolNames()

    // then: registry
    expect(registered.map((tool) => tool.name)).toEqual(THREAD_TOOL_NAMES)
    expect(registered.every((tool) => tool.exposure === "eval")).toBe(true)
    // then: direct list
    expect(active).toContain("eval")
    expect(active.filter((name) => THREAD_TOOL_NAMES.includes(name))).toEqual([])
    // then: prompt still describes the family and its eval form
    expect(session.systemPrompt).toContain(THREAD_FAMILY_PROMPT_GUIDELINES)
    for (const name of THREAD_TOOL_NAMES) expect(session.systemPrompt).toContain(`tool.${name}(`)
    // then: a direct call is answered with the redirect, naming the tool
    expect(session.agent.removedToolHints.thread_read).toMatch(EVAL_HINT)
  })

  test("#given an eval tool #when the family is called the way an eval cell does #then it runs from the registry without joining the direct list and refuses with the same reason as a direct call", async () => {
    // given
    const { session, f, root } = await openSession({ withEval: true })
    const direct = createThreadTools(f).find((tool) => tool.name === "thread_read")
    if (!direct) throw new Error("thread_read is missing from the thread tool family")

    // when
    const listed = threadResult(await session.executeTool("thread_list", { all_scope: true }, { activateInactiveTool: true }))
    const viaEval = threadResult(await session.executeTool("thread_read", { thread: "missing" }, { activateInactiveTool: true }))
    const viaDirect = (await direct.execute("call-direct", { thread: "missing" }, undefined, undefined, {} as never)).details.result as ThreadToolResult

    // then: the call reached the tool and listed the fixture peer
    expect(listed).toMatchObject({ kind: "ok", scope: "all" })
    const threads = (listed as unknown as { threads: Array<{ thread_id: string; cwd: string }> }).threads
    expect(threads.map((thread) => thread.thread_id)).toEqual(["dur-peer"])
    expect(threads[0]?.cwd).toBe(root)
    // then: the eval path did not activate the tool
    expect(session.getActiveToolNames().filter((name) => THREAD_TOOL_NAMES.includes(name))).toEqual([])
    // then: the refusal is the tool's own typed failure, identical on both paths
    expect(viaEval).toMatchObject({ kind: "error", error: { code: "not_found" } })
    expect(viaEval).toEqual(viaDirect)
  })

  test("#given a tool_call hook that blocks thread_read #when it is called the way an eval cell does #then the hook refuses it before the host is reached", async () => {
    // given
    const reason = "blocked by the test's permission policy"
    const policy: ExtensionFactory = (pi) => {
      pi.on("tool_call", (event) => (event.toolName === "thread_read" ? { block: true, reason } : undefined))
    }
    const { session, f } = await openSession({ withEval: true, extraFactories: [policy] })

    // when / then: the hook's refusal surfaces as the call's error, naming the tool
    await expect(session.executeTool("thread_read", { thread: "peer" }, { activateInactiveTool: true })).rejects.toMatchObject({
      name: "ExecuteToolError", code: "blocked", toolName: "thread_read", message: reason,
    })
    expect(f.getMessages).not.toHaveBeenCalled()
  })

  test("#given params the schema rejects #when thread_read is called with and without an eval tool #then both engine paths refuse it the same way before the host is reached", async () => {
    // given
    const withEval = await openSession({ withEval: true })
    const withoutEval = await openSession({ withEval: false })
    const invalid = { thread: { nested: true } }

    // when
    const evalPath = await outcomeOf(withEval.session, "thread_read", invalid)
    const directPath = await outcomeOf(withoutEval.session, "thread_read", invalid)

    // then: refused as a typed failure, never run
    const refused =
      ("threw" in evalPath && evalPath.threw.code === "invalid_params" && evalPath.threw.toolName === "thread_read") ||
      ("result" in evalPath && evalPath.result.kind === "error" && evalPath.result.error.code === "invalid_arguments")
    expect(refused, JSON.stringify(evalPath)).toBe(true)
    expect(withEval.f.getMessages).not.toHaveBeenCalled()
    // then: the eval path is not a privileged bypass of what the direct path enforces
    expect(evalPath).toEqual(directPath)
  })

  test("#given no eval tool #when the family registers #then every tool is an ordinary direct tool with no redirect", async () => {
    // given
    const { session } = await openSession({ withEval: false })

    // when
    const active = session.getActiveToolNames()

    // then
    expect(active.filter((name) => THREAD_TOOL_NAMES.includes(name))).toEqual(THREAD_TOOL_NAMES)
    expect(session.agent.removedToolHints.thread_read).toBeUndefined()
    expect(session.systemPrompt).not.toContain("tool.thread_read(")
    expect(threadResult(await session.executeTool("thread_read", { thread: "missing" }))).toMatchObject({ kind: "error", error: { code: "not_found" } })
  })
})
