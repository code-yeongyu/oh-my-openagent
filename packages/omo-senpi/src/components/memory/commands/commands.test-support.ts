// Test harness for the memory command suite: fake contexts, temp identities,
// seeded git repos, and overridable deps.

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  installHooks,
  type GitExec,
  type GitSeedFile,
} from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import type {
  ManualReflectionRequest,
  MemoryCommandContext,
  MemoryCommandDeps,
  MemoryCommandIdentity,
  MemoryCommandUi,
  NotifyLevel,
  ReflectionRequestReceipt,
} from "./types"

export const TEST_IDENTITY = "test-identity"

export interface FakeCommandUi extends MemoryCommandUi {
  readonly notifications: Array<{ message: string; level: NotifyLevel }>
  readonly confirms: Array<{ title: string; message: string }>
  readonly selects: Array<{ title: string; options: string[] }>
  confirmResult: boolean
  selectResult: string | undefined
}

export interface FakeCommandContext extends MemoryCommandContext {
  readonly ui: FakeCommandUi
  readonly order: string[]
  readonly sessionId: string
}

export function fakeCommandContext(options: {
  readonly sessionId?: string
  readonly hasUI?: boolean
  readonly agentDir?: string
  readonly withWaitForIdle?: boolean
} = {}): FakeCommandContext {
  const order: string[] = []
  const ui: FakeCommandUi = {
    notifications: [],
    confirms: [],
    selects: [],
    confirmResult: true,
    selectResult: undefined,
    notify(message, level = "info") {
      ui.notifications.push({ message, level })
    },
    confirm(title, message) {
      ui.confirms.push({ title, message })
      return Promise.resolve(ui.confirmResult)
    },
    select(title, options) {
      ui.selects.push({ title, options })
      return Promise.resolve(ui.selectResult)
    },
  }
  const sessionId = options.sessionId ?? "session-1"
  return {
    ui,
    order,
    sessionId,
    hasUI: options.hasUI ?? true,
    mode: (options.hasUI ?? true) ? "tui" : "print",
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
    sessionManager: { getSessionId: () => sessionId },
    ...(options.withWaitForIdle === false
      ? {}
      : {
          waitForIdle: () => {
            order.push("waitForIdle")
            return Promise.resolve()
          },
        }),
  }
}

/** Records relative ordering between ctx.waitForIdle and pi.sendUserMessage. */
export function trackSendOrder(pi: MemoryFakeExtensionAPI, ctx: FakeCommandContext): string[] {
  const original = pi.sendUserMessage.bind(pi)
  pi.sendUserMessage = (content, sendOptions) => {
    ctx.order.push("sendUserMessage")
    original(content, sendOptions)
  }
  return ctx.order
}

export async function tempIdentity(root?: string): Promise<{ root: string; identity: MemoryCommandIdentity }> {
  const identityRoot = root ?? (await mkdtemp(join(tmpdir(), "memory-commands-")))
  return {
    root: identityRoot,
    identity: {
      identity: TEST_IDENTITY,
      identityPaths: buildIdentityPaths(identityRoot, TEST_IDENTITY),
    },
  }
}

export async function seededRepo(
  identity: MemoryCommandIdentity,
  seedFiles: readonly GitSeedFile[],
  exec?: GitExec,
): Promise<GitMemoryRepo> {
  const repo = new GitMemoryRepo({
    dir: identity.identityPaths.repo,
    agentId: identity.identity,
    installHooks: (dir: string) => {
      installHooks(dir)
    },
    ...(exec === undefined ? {} : { exec }),
  })
  await repo.init({ seedFiles })
  return repo
}

export interface FakeDeps extends MemoryCommandDeps {
  readonly busts: string[]
  readonly reflectionRequests: ManualReflectionRequest[]
  receipt: ReflectionRequestReceipt
  alivePids: Set<number>
}

export function fakeDeps(
  identity: MemoryCommandIdentity | undefined,
  overrides: Partial<MemoryCommandDeps> = {},
): FakeDeps {
  const busts: string[] = []
  const reflectionRequests: ManualReflectionRequest[] = []
  const deps: FakeDeps = {
    busts,
    reflectionRequests,
    receipt: { disposition: "reserved", runId: "run-1" },
    alivePids: new Set<number>(),
    contextForSession: () => identity,
    resolveIdentity: () => identity,
    loadSettings: () => ({ settings: memorySettings(), configPath: "/tmp/omo.jsonc" }),
    bustPromptCache: () => busts.push("bust"),
    reflectionSink: {
      request: (request) => {
        reflectionRequests.push(request)
        return Promise.resolve(deps.receipt)
      },
    },
    isProcessAlive: (pid) => deps.alivePids.has(pid),
    now: () => 1_782_000_000_000,
    ...overrides,
  }
  return deps
}

export async function invoke(
  pi: MemoryFakeExtensionAPI,
  name: string,
  args: string,
  ctx: FakeCommandContext,
): Promise<string> {
  const registration = pi.commands.find((command) => command.name === name)
  if (registration === undefined) throw new Error(`command not registered: ${name}`)
  const handler = registration.options.handler as (args: string, ctx: MemoryCommandContext) => Promise<string>
  return handler(args, ctx)
}
