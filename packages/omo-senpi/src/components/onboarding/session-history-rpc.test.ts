import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createOnboardingComponent } from "./component"
import { createSessionHistoryScanner, nodeSessionHistoryFs, type SessionHistoryOptions, type SessionHistoryScanner } from "./session-history"
import { claudeSessionLine, createTempDirectories, encodeRecord, writeTranscript } from "./session-history/test-support"
import {
  OMO_SESSION_PROJECTS_RPC_METHOD,
  OMO_SESSION_THREADS_RPC_EVENT,
  OMO_SESSION_THREADS_RPC_METHOD,
  registerSessionHistoryRpc,
} from "./session-history-rpc"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")
const EVENT_TIMEOUT_MS = 10_000

type Handler = (data: unknown) => unknown | Promise<unknown>

/**
 * A host exposing only the rpc surface. Every other member throws when touched, so a handler that
 * reached for a model turn, a message, a tool or a socket-backed host API would fail the test.
 */
function rpcOnlyHost() {
  const handlers = new Map<string, Handler>()
  const emits: Array<{ name: string; data: unknown }> = []
  const listeners: Array<() => void> = []
  const rpc = {
    handle: (name: string, handler: Handler) => void handlers.set(name, handler),
    emit: (name: string, data: unknown) => {
      emits.push({ name, data })
      for (const listener of listeners) listener()
    },
  }
  const pi = new Proxy({ rpc } as Record<string, unknown>, {
    get(target, key) {
      if (key === "rpc") return target.rpc
      throw new Error(`session-history rpc touched pi.${String(key)}`)
    },
  }) as unknown as SenpiExtensionAPI
  const terminal = (scanId: () => string | undefined) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited ${EVENT_TIMEOUT_MS}ms for a done/failed event, never fired`)), EVENT_TIMEOUT_MS)
      listeners.push(() => {
        const last = emits.at(-1)?.data as { scanId?: string; kind?: string } | undefined
        if (last !== undefined && last.scanId === scanId() && (last.kind === "done" || last.kind === "failed")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })
  return { pi, handlers, emits, terminal }
}

async function homes() {
  return { claude: await temp.make("claude-home-"), codex: await temp.make("codex-home-") }
}

const codexSession = (id: string, cwd: string, prompt: string) =>
  [encodeRecord({ type: "session_meta", payload: { id, cwd } }), encodeRecord({ type: "event_msg", timestamp: "2026-08-24T10:00:00.000Z", payload: { type: "user_message", message: prompt } })].join("\n")
const rolloutPath = (codexHome: string, name: string) => join(codexHome, "sessions", "2026", "08", "24", name)

function deterministicScanner(seen: Array<SessionHistoryOptions> = []) {
  return (options: SessionHistoryOptions): SessionHistoryScanner => {
    seen.push(options)
    return createSessionHistoryScanner({ ...options, omoSessionsRoots: [], now: () => nowMs })
  }
}

describe("onboarding session-history rpc", () => {
  it("#given the onboarding component #when registered #then both engine methods are served", () => {
    // given
    const pi = new FakeExtensionAPI()
    const handled: Array<string> = []
    ;(pi as unknown as { rpc: unknown }).rpc = { emit: () => {}, handle: (name: string) => void handled.push(name) }

    // when
    createOnboardingComponent().register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => false } })

    // then
    expect(handled).toEqual(expect.arrayContaining([OMO_SESSION_PROJECTS_RPC_METHOD, OMO_SESSION_THREADS_RPC_METHOD]))
  })

  it("#given the desktop's projects request #when answered #then it is the engine scan for exactly what the desktop named", async () => {
    // given
    const { claude, codex } = await homes()
    const imported = await temp.make("workspace-imported-")
    const fresh = await temp.make("workspace-fresh-")
    const appState = await temp.make("desktop-state-")
    await writeTranscript({ filePath: join(claude, "projects", "-a", "a.jsonl"), contents: claudeSessionLine(imported), mtimeMs: Date.parse("2026-08-01T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claude, "projects", "-b", "b.jsonl"), contents: claudeSessionLine(fresh), mtimeMs: Date.parse("2026-08-02T00:00:00.000Z") })
    await writeTranscript({ filePath: join(claude, "projects", "-c", "c.jsonl"), contents: claudeSessionLine(appState), mtimeMs: Date.parse("2026-08-03T00:00:00.000Z") })
    const host = rpcOnlyHost()
    const seen: Array<SessionHistoryOptions> = []
    registerSessionHistoryRpc(host.pi, { createScanner: deterministicScanner(seen) })
    const request = {
      homes: [{ source: "claudeAgent" as const, homePath: claude }, { source: "codex" as const, homePath: codex }],
      importedProjects: [{ id: "project-1", workspaceRoot: imported }],
      excludedDirectories: [appState],
      managedWorktreeDirectories: [],
    }

    // when
    const reply = await host.handlers.get(OMO_SESSION_PROJECTS_RPC_METHOD)?.(request)

    // then
    expect(seen).toEqual([{ homes: request.homes, importedProjects: request.importedProjects, excludedDirectories: [appState], managedWorktreeDirectories: [] }])
    expect(reply).toEqual({
      candidates: [
        { path: fresh, title: expect.any(String), sources: ["claudeAgent"], threadCount: 1, lastActiveAt: "2026-08-02T00:00:00.000Z", alreadyImported: false, git: null },
        { path: imported, title: expect.any(String), projectId: "project-1", sources: ["claudeAgent"], threadCount: 1, lastActiveAt: "2026-08-01T00:00:00.000Z", alreadyImported: true, git: null },
      ],
      scannedAt: new Date(nowMs).toISOString(),
      counts: { found: 3, read: 3, cap: expect.any(Number) },
    })
    expect(host.emits).toEqual([])
  })

  it("#given a malformed request #when either method is called #then it answers unavailable without scanning", async () => {
    // given
    const host = rpcOnlyHost()
    const seen: Array<SessionHistoryOptions> = []
    registerSessionHistoryRpc(host.pi, { createScanner: deterministicScanner(seen) })

    // when
    const projects = await host.handlers.get(OMO_SESSION_PROJECTS_RPC_METHOD)?.({ homes: [{ source: "gemini", homePath: "/x" }], importedProjects: [], excludedDirectories: [], managedWorktreeDirectories: [] })
    const sessions = await host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.({ homes: [], completed: [], excludedDirectories: [], managedWorktreeDirectories: [] })

    // then
    expect(projects).toEqual({ kind: "unavailable", reason: expect.any(String) })
    expect(sessions).toEqual({ kind: "unavailable", reason: expect.any(String) })
    expect(seen).toEqual([])
    expect(host.emits).toEqual([])
  })

  it("#given a scan that throws #when projects is called #then it answers unavailable with the reason", async () => {
    // given
    const host = rpcOnlyHost()
    registerSessionHistoryRpc(host.pi, {
      createScanner: (options: SessionHistoryOptions) => ({ ...createSessionHistoryScanner(options), scanProjects: () => Promise.reject(new Error("disk gone")) }),
    })

    // when
    const reply = await host.handlers.get(OMO_SESSION_PROJECTS_RPC_METHOD)?.({ homes: [], importedProjects: [], excludedDirectories: [], managedWorktreeDirectories: [] })

    // then
    expect(reply).toEqual({ kind: "unavailable", reason: "disk gone" })
  })

  it("#given the desktop's sessions request #when answered #then it replies a scanId before any event, then pushes each outcome in wire shape and ends with done", async () => {
    // given
    const { claude, codex } = await homes()
    const workspace = await temp.make("workspace-")
    const done = rolloutPath(codex, "rollout-done.jsonl")
    const fresh = rolloutPath(codex, "rollout-fresh.jsonl")
    const copy = rolloutPath(codex, "rollout-copy.jsonl")
    await writeTranscript({ filePath: done, contents: codexSession("done-session", workspace, "Old work"), mtimeMs: nowMs - 1_000 })
    await writeTranscript({ filePath: fresh, contents: codexSession("fresh-session", workspace, "New work"), mtimeMs: nowMs - 2_000 })
    await writeTranscript({ filePath: copy, contents: codexSession("fresh-session", workspace, "New work"), mtimeMs: nowMs - 3_000 })
    const doneStats = await nodeSessionHistoryFs.stat(done)
    const freshStats = await nodeSessionHistoryFs.stat(fresh)
    const completed = { provider: "codex", providerSessionId: "done-session", filePath: done, size: doneStats.size, mtimeMs: doneStats.mtimeMs, device: doneStats.dev, inode: doneStats.ino, birthtimeMs: doneStats.birthtimeMs }
    const host = rpcOnlyHost()
    registerSessionHistoryRpc(host.pi, { createScanner: deterministicScanner(), newScanId: () => "scan-1" })
    let scanId: string | undefined
    const finished = host.terminal(() => scanId)

    // when
    const reply = await host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.({
      workspaceRoot: workspace,
      homes: [{ source: "claudeAgent", homePath: claude }, { source: "codex", homePath: codex }],
      completed: [completed],
      excludedDirectories: [],
      managedWorktreeDirectories: [],
    })
    const emittedAtReply = host.emits.length
    scanId = (reply as { scanId: string }).scanId
    await finished

    // then
    expect(reply).toEqual({ scanId: "scan-1" })
    expect(emittedAtReply).toBe(0)
    expect(host.emits.every((emit) => emit.name === OMO_SESSION_THREADS_RPC_EVENT)).toBe(true)
    expect(host.emits.map((emit) => emit.data)).toEqual([
      { scanId: "scan-1", kind: "outcome", outcome: { _tag: "AlreadyImported", source: { ...completed, homePath: codex } } },
      {
        scanId: "scan-1",
        kind: "outcome",
        outcome: {
          _tag: "Importable",
          thread: {
            source: "codex",
            providerSessionId: "fresh-session",
            title: "New work",
            model: null,
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            messages: [{ role: "user", text: "New work", createdAt: expect.any(String) }],
          },
          source: { provider: "codex", homePath: codex, providerSessionId: "fresh-session", filePath: fresh, size: freshStats.size, mtimeMs: freshStats.mtimeMs, device: freshStats.dev, inode: freshStats.ino, birthtimeMs: freshStats.birthtimeMs },
        },
      },
      { scanId: "scan-1", kind: "outcome", outcome: { _tag: "Duplicate", source: expect.objectContaining({ filePath: copy, providerSessionId: "fresh-session", homePath: codex }) } },
      { scanId: "scan-1", kind: "done" },
    ])
  })

  it("#given a scan that fails mid-way #when sessions runs #then the outcomes so far are followed by failed with the reason", async () => {
    // given
    const host = rpcOnlyHost()
    registerSessionHistoryRpc(host.pi, {
      newScanId: () => "scan-2",
      createScanner: (options: SessionHistoryOptions) => ({
        ...createSessionHistoryScanner(options),
        recentSessions: () => ({
          counts: () => ({ found: 1, read: 0, cap: 100 }),
          async *[Symbol.asyncIterator]() {
            yield { _tag: "Skipped" as const }
            throw new Error("transcript vanished")
          },
        }),
      }),
    })
    const finished = host.terminal(() => "scan-2")

    // when
    const reply = await host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.({ workspaceRoot: "/w", homes: [], completed: [], excludedDirectories: [], managedWorktreeDirectories: [] })
    await finished

    // then
    expect(reply).toEqual({ scanId: "scan-2" })
    expect(host.emits.map((emit) => emit.data)).toEqual([
      { scanId: "scan-2", kind: "outcome", outcome: { _tag: "Skipped" } },
      { scanId: "scan-2", kind: "failed", reason: "transcript vanished" },
    ])
  })

  it("#given two concurrent scans #when both run #then each scan's events carry only its own scanId", async () => {
    // given
    const host = rpcOnlyHost()
    let next = 0
    registerSessionHistoryRpc(host.pi, { createScanner: deterministicScanner(), newScanId: () => `scan-${++next}` })
    const request = { workspaceRoot: await temp.make("empty-"), homes: [], completed: [], excludedDirectories: [], managedWorktreeDirectories: [] }
    const first = host.terminal(() => "scan-1")
    const second = host.terminal(() => "scan-2")

    // when
    const replies = await Promise.all([host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.(request), host.handlers.get(OMO_SESSION_THREADS_RPC_METHOD)?.(request)])
    await Promise.all([first, second])

    // then
    expect(replies).toEqual([{ scanId: "scan-1" }, { scanId: "scan-2" }])
    expect(host.emits.map((emit) => emit.data)).toEqual(expect.arrayContaining([{ scanId: "scan-1", kind: "done" }, { scanId: "scan-2", kind: "done" }]))
    expect(host.emits).toHaveLength(2)
  })
})
