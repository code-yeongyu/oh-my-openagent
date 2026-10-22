import dgram from "node:dgram"
import { stat } from "node:fs/promises"
import net from "node:net"
import { join } from "node:path"
import tls from "node:tls"
import { afterEach, describe, expect, it } from "bun:test"

import { createSessionDigestStore, type SessionDigestStore } from "./digest-store"
import { scanSessionHistory } from "./scan-session-history"
import { collect, createTempDirectories, encodeRecord, writeTranscript } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")

async function fixture() {
  const claude = await temp.make("events-claude-")
  const codex = await temp.make("events-codex-")
  const workspace = await temp.make("events-workspace-")
  const stateDir = await temp.make("events-state-")
  await writeTranscript({ filePath: join(codex, "sessions", "2026", "08", "24", "rollout-one.jsonl"), mtimeMs: nowMs - 1_000, contents: [
    encodeRecord({ type: "session_meta", payload: { id: "codex-one", cwd: workspace } }),
    encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "Ship the feature" } }),
  ].join("\n") })
  const homes = [{ source: "claudeAgent" as const, homePath: claude }, { source: "codex" as const, homePath: codex }]
  return { homes, workspace, stateDir }
}

describe("scanSessionHistory events (onboarding scan contract, issue A1)", () => {
  it("#given one project with one recent session #when scanned #then emits per-source events in order", async () => {
    // given
    const { homes, workspace, stateDir } = await fixture()

    // when
    const events = await collect(scanSessionHistory({ scanId: "scan-1", homes, omoSessionsRoots: [], now: () => nowMs, digestStore: createSessionDigestStore({ stateDir }) }))

    // then
    expect(events.map((event) => `${event.kind}:${event.source}`)).toEqual([
      "source_started:projects", "item:projects", "source_done:projects",
      "source_started:sessions", "item:sessions", "source_done:sessions",
    ])
    expect(events.every((event) => event.scanId === "scan-1" && typeof event.elapsedMs === "number" && event.elapsedMs >= 0)).toBe(true)
    expect(events[1]?.item).toMatchObject({ path: workspace, sources: ["codex"], threadCount: 1 })
    expect(events[2]?.counts).toEqual({ found: 1, read: 1, cap: 15_000 })
    expect(events[4]?.item).toEqual({ sessionKey: "codex:codex-one", source: "codex", providerSessionId: "codex-one", cwd: workspace, title: "Ship the feature", lastActiveAt: new Date(nowMs - 1_000).toISOString(), digestBytes: expect.any(Number) })
    expect(events[5]?.counts).toEqual({ found: 1, read: 1, cap: 100 })
  })

  it("#given a digest store that fails #when scanned #then reports sessions as failed and keeps projects", async () => {
    // given
    const { homes } = await fixture()
    const failingStore: SessionDigestStore = { put: async () => { throw new Error("disk full") }, list: async () => [], drop: async () => {} }

    // when
    const events = await collect(scanSessionHistory({ scanId: "scan-2", homes, omoSessionsRoots: [], now: () => nowMs, digestStore: failingStore }))

    // then
    expect(events.map((event) => `${event.kind}:${event.source}`)).toEqual(["source_started:projects", "item:projects", "source_done:projects", "source_started:sessions", "source_failed:sessions"])
    expect(events.at(-1)).toMatchObject({ kind: "source_failed", source: "sessions", error: "disk full" })
  })

  it("#given a scan id #when digests are stored #then they persist privately on disk under the scan id", async () => {
    // given
    const { homes, stateDir } = await fixture()
    await collect(scanSessionHistory({ scanId: "scan-3", homes, omoSessionsRoots: [], now: () => nowMs, digestStore: createSessionDigestStore({ stateDir }) }))

    // when
    const reopened = await createSessionDigestStore({ stateDir }).list("scan-3")
    const scanDir = join(stateDir, "onboarding", "scans", "scan-3")

    // then
    expect(reopened.map((digest) => digest.sessionKey)).toEqual(["codex:codex-one"])
    // Windows has no POSIX permission bits, so the owner-only modes are only observable elsewhere.
    if (process.platform !== "win32") {
      expect((await stat(scanDir)).mode & 0o777).toBe(0o700)
      expect((await stat(join(scanDir, "digests.jsonl"))).mode & 0o777).toBe(0o600)
    }
    await expect(createSessionDigestStore({ stateDir }).list("../escape")).rejects.toThrow("invalid scanId")
  })

  it("#given no model configured and no network #when scanned #then completes without opening a socket", async () => {
    // given
    const { homes, stateDir } = await fixture()
    const attempts: Array<string> = []
    const originals = { connect: net.Socket.prototype.connect, tlsConnect: tls.connect, createSocket: dgram.createSocket, fetch: globalThis.fetch, bunConnect: Bun.connect }
    net.Socket.prototype.connect = function blockedConnect(this: net.Socket) { attempts.push("net.Socket.connect"); throw new Error("socket blocked") } as typeof net.Socket.prototype.connect
    tls.connect = (() => { attempts.push("tls.connect"); throw new Error("socket blocked") }) as typeof tls.connect
    dgram.createSocket = (() => { attempts.push("dgram.createSocket"); throw new Error("socket blocked") }) as typeof dgram.createSocket
    globalThis.fetch = Object.assign(async () => { attempts.push("fetch"); throw new Error("network blocked") }, { preconnect: () => {} }) as typeof fetch
    Bun.connect = (async () => { attempts.push("Bun.connect"); throw new Error("socket blocked") }) as typeof Bun.connect

    // when
    let events: Awaited<ReturnType<typeof collect<unknown>>> = []
    try {
      events = await collect(scanSessionHistory({ scanId: "scan-offline", homes, omoSessionsRoots: [], env: {}, now: () => nowMs, digestStore: createSessionDigestStore({ stateDir }) }))
    } finally {
      net.Socket.prototype.connect = originals.connect
      tls.connect = originals.tlsConnect
      dgram.createSocket = originals.createSocket
      globalThis.fetch = originals.fetch
      Bun.connect = originals.bunConnect
    }

    // then
    expect(attempts).toEqual([])
    expect(events.filter((event) => (event as { kind: string }).kind === "source_done")).toHaveLength(2)
  })
})
