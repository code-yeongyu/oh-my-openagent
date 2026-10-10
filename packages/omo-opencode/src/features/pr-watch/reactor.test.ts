import { createOpencodeClient } from "@opencode-ai/sdk"
import { acquirePrWatchManager } from "./manager"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitHubPrWatchHost, type PrActivity, type PrDetails } from "./github"
import type { FingerprintBaseline, FingerprintRow } from "./fingerprints.mjs"
import { GitHubReadDeferred } from "./transport"
import { PrWatchRegistry } from "./registry"
import { PrWatchReactor } from "./reactor"
import { acknowledgePrWatchWake, pendingPrWatchWakes, recordPrWatchEvents, registerPrWatch, stopPrWatch } from "./state"

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function registry(): PrWatchRegistry {
  const dir = mkdtempSync(join(tmpdir(), "pr-watch-registry-")); directories.push(dir)
  return new PrWatchRegistry(join(dir, "state.json"))
}
class Host extends GitHubPrWatchHost {
  reads = { fingerprints: 0, details: 0, activity: 0 }
  status = "status-1"
  remarks = "remarks-1"
  running = false
  rateLimited = false
  missing = false
  fail = false
  deferred = false
  gate?: Promise<void>
  detail: PrDetails = { state: "OPEN", mergeable: "MERGEABLE", head: "head1", checks: [{ id: "run:1", name: "CI", status: "COMPLETED", conclusion: "SUCCESS", required: true }] }
  remarksData: PrActivity = { remarks: [] }
  async fingerprints(references: string[], previous: FingerprintBaseline): Promise<FingerprintRow[]> {
    this.reads.fingerprints++
    return references.map((key) => ({ key, result: this.rateLimited ? "rate_limited" : this.missing ? "unreadable" : "ok",
      statusFingerprint: this.status, remarksFingerprint: this.remarks,
      refreshStatus: this.running || this.status !== previous[key]?.statusFingerprint || this.missing,
      refreshRemarks: this.remarks !== previous[key]?.remarksFingerprint || this.missing,
    }))
  }
  async details(): Promise<PrDetails> {
    this.reads.details++
    await this.gate
    if (this.deferred) throw new GitHubReadDeferred(5000)
    if (this.fail) throw new Error("Host unreadable")
    return structuredClone(this.detail)
  }
  async activity(): Promise<PrActivity> { this.reads.activity++; return structuredClone(this.remarksData) }
}

// #9493 explicitly requests consumer read-count, restart, stale-read and wake-dedupe regressions.
describe("persistent PR watch reactor", () => {
  test("multiple sessions share one fingerprint/detail/activity read and unchanged passes read neither detail part", async () => {
    const store = registry(), host = new Host(), reactor = new PrWatchReactor(store, host)
    await store.transaction((state) => { registerPrWatch(state, "acme/widget#1", "one", "alice", 0); registerPrWatch(state, "ACME/WIDGET#1", "two", "alice", 0) })
    await reactor.pass(100)
    expect(host.reads).toEqual({ fingerprints: 1, details: 1, activity: 1 })
    expect(pendingPrWatchWakes(store.read()).length).toBe(2)
    await reactor.pass(200)
    expect(host.reads).toEqual({ fingerprints: 2, details: 1, activity: 1 })
    host.running = true
    await reactor.pass(300)
    expect(host.reads).toEqual({ fingerprints: 3, details: 2, activity: 1 })
    host.running = false; host.remarks = "remarks-2"
    await reactor.pass(400)
    expect(host.reads).toEqual({ fingerprints: 4, details: 2, activity: 2 })
  })
  test("a new revision that is already green wakes once even when the previous revision was green", async () => {
    const store = registry(), host = new Host(), reactor = new PrWatchReactor(store, host)
    await store.transaction(state => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    await reactor.pass(100)
    await store.transaction(state => { for (const wake of pendingPrWatchWakes(state)) acknowledgePrWatchWake(state, wake.id) })
    host.detail.head = "head2"; host.detail.checks[0]!.id = "run:2"; host.status = "status-2"
    await reactor.pass(200)
    const wakes = pendingPrWatchWakes(store.read())
    expect(wakes.length).toBe(1)
    expect(wakes[0]!.events).toEqual([{ key: "green:head2:2", kind: "checks_passed", fact: "Required checks passed on head2 (all checks are used when GitHub marks none required)." }])
    await reactor.pass(300)
    expect(pendingPrWatchWakes(store.read()).length).toBe(1)
  })
  test("restart retains queued transition and its atomic progress; a durable acknowledgment prevents replay", async () => {
    const store = registry(), host = new Host()
    await store.transaction((state) => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    await new PrWatchReactor(store, host).pass(100)
    const reopened = new PrWatchRegistry(store.path)
    const wakes = pendingPrWatchWakes(reopened.read())
    expect(wakes.length).toBe(1)
    expect(reopened.read().registrations[wakes[0]!.watchID]!.told).toEqual(wakes[0]!.events.map((event) => event.key))
    await reopened.transaction((state) => acknowledgePrWatchWake(state, wakes[0]!.id))
    await new PrWatchReactor(reopened, host).pass(200)
    expect(pendingPrWatchWakes(new PrWatchRegistry(store.path).read())).toEqual([])
  })
  test("unwatch or rewatch during a host read drops the old generation instead of waking the new session", async () => {
    const store = registry(), host = new Host()
    const old = await store.transaction((state) => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    let release!: () => void
    host.gate = new Promise<void>((resolve) => { release = resolve })
    const pass = new PrWatchReactor(store, host).pass(100)
    await store.transaction((state) => { stopPrWatch(state, old.id, "unwatched"); registerPrWatch(state, "acme/widget#1", "one", "alice", 150) })
    release(); await pass
    expect(pendingPrWatchWakes(store.read())).toEqual([])
    expect(store.read().registrations[old.id]!.generation).toBe(3)
  })
  test("rate limits skip without failing a watch; unreadable fallback stops after 15 minutes with a queued reason", async () => {
    const store = registry(), host = new Host()
    const registration = await store.transaction((state) => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    host.rateLimited = true
    await new PrWatchReactor(store, host).pass(100)
    expect(host.reads).toEqual({ fingerprints: 1, details: 0, activity: 0 })
    expect(store.read().registrations[registration.id]!.unreadableSince).toBeUndefined()
    host.rateLimited = false; host.missing = true; host.fail = true
    const reactor = new PrWatchReactor(store, host)
    await reactor.pass(200); await reactor.pass(200 + 15 * 60_000)
    const state = new PrWatchRegistry(store.path).read()
    expect(state.registrations[registration.id]!.reason).toBe("host_unreadable_fifteen_minutes")
    expect(pendingPrWatchWakes(state)[0]!.events[0]!.fact).toContain("Host unreadable")
  })
  test("deferred GitHub reads preserve acknowledged baseline and do not start unreadability timeout", async () => {
    const store = registry(), host = new Host(), reactor = new PrWatchReactor(store, host)
    const registration = await store.transaction(state => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    await reactor.pass(100)
    const baseline = store.read().snapshots[registration.reference]
    host.status = "changed"; host.deferred = true
    await reactor.pass(200)
    expect(store.read().snapshots[registration.reference]).toEqual(baseline)
    expect(store.read().registrations[registration.id]!.unreadableSince).toBeUndefined()
  })
  test("ten consecutive comment-only wakes stop with reason, and actor comments do not generate a wake", async () => {
    const store = registry(), host = new Host()
    const registration = await store.transaction((state) => registerPrWatch(state, "acme/widget#1", "one", "alice", 0))
    host.detail.checks = []
    host.remarksData.remarks = [{ id: "own", author: "Alice", updatedAt: "2026-10-07T00:00:00Z", url: "https://github.com/acme/widget/pull/1", kind: "comment" }]
    await new PrWatchReactor(store, host).pass(100)
    expect(pendingPrWatchWakes(store.read())).toEqual([])
    for (let i = 0; i < 10; i++) await store.transaction((state) => recordPrWatchEvents(state, registration, [{ key: `remark:${i}`, kind: "comment", fact: `external comment ${i}` }]))
    const state = store.read()
    expect(state.registrations[registration.id]!.active).toBe(false)
    expect(state.registrations[registration.id]!.reason).toBe("ten_consecutive_comment_only_wakes")
    expect(pendingPrWatchWakes(state).length).toBe(10)
  })
  test("corrupt durable state fails loudly and is never silently overwritten", () => {
    const store = registry()
    writeFileSync(store.path, '{"version":999}')
    expect(() => store.read()).toThrow()
  })
})


test("project plugin instances share host registry/poller until the last owner releases", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-watch-host-")); directories.push(dir)
  process.env.XDG_DATA_HOME = dir
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
  const one = acquirePrWatchManager({ client, directory: join(dir, "project-one") })
  const two = acquirePrWatchManager({ client, directory: join(dir, "project-two") })
  expect(two).toBe(one)
  expect(one.registry.path.startsWith(dir)).toBe(true)
  await one.shutdown()
  const three = acquirePrWatchManager({ client, directory: join(dir, "project-three") })
  expect(three).toBe(two)
  await two.shutdown(); await three.shutdown()
  const restarted = acquirePrWatchManager({ client, directory: join(dir, "project-one") })
  expect(restarted).not.toBe(one)
  expect(restarted.registry.path).toBe(one.registry.path)
  await restarted.shutdown()
})
