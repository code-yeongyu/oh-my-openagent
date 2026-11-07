import { afterEach, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitHubPrWatchHost } from "./github"
import { execFileSync } from "node:child_process"
import { GitHubReadTransport } from "./transport"
import { PrWatchManager, projectGitHubHost } from "./manager"
import { PrWatchRegistry } from "./registry"
import { acknowledgePrWatchWake, pendingPrWatchWakes, recordPrWatchEvents, registerPrWatch, stopPrWatch } from "./state"

const directories: string[] = []
const managers: PrWatchManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pr-watch-manager-")); directories.push(directory)
  const path = join(directory, "private", "state.json")
  const receipts: { info: { id: string; role: string }; parts: unknown[] }[] = []
  const requests: string[] = []
  let failReceipt = false
  let dispatches = 0
  const client = createOpencodeClient({ baseUrl: "http://watch.test", fetch: async (input: Request) => {
    const url = new URL(input.url)
    requests.push(url.pathname)
    if (url.pathname.endsWith("/message")) return Response.json(failReceipt ? { message: "unavailable" } : receipts, { status: failReceipt ? 503 : 200 })
    if (url.pathname.endsWith("/prompt_async")) {
      dispatches++
      const body = await input.json()
      receipts.push({ info: { id: body.messageID, role: "user" }, parts: [] })
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/session/status") return Response.json({})
    throw new Error(`Unexpected SDK request ${url.pathname}`)
  } })
  const host = new GitHubPrWatchHost()
  const manager = () => {
    const result = new PrWatchManager({ client, directory }, path, undefined, host)
    managers.push(result)
    return result
  }
  const seed = async () => {
    const registry = new PrWatchRegistry(path)
    await registry.transaction(state => {
      const row = registerPrWatch(state, "acme/widget#1", `ses_${directory}`, "alice")
      recordPrWatchEvents(state, row, [{ key: "failure", kind: "check_failed", fact: "CI failed" }])
      row.active = false // final wake delivery must not require active polling
      state.nextPollAt = Date.now() + 60_000
    })
    return registry
  }
  return { manager, seed, receipts, requests, path, fail: (value: boolean) => { failReceipt = value }, dispatches: () => dispatches }
}

// Maintainer review #9693 explicitly requests manager-level restart/receipt/dispatch tests.
test("accepted SDK dispatch survives restart before acknowledgment without a second prompt", async () => {
  const f = fixture(), registry = await f.seed(), first = f.manager()
  await first.tick()
  expect(f.dispatches()).toBe(1)
  expect(pendingPrWatchWakes(registry.read())).toHaveLength(1)
  const receiptID = f.receipts[0]?.info.id
  expect(receiptID).toMatch(/^msg_[0-9a-f]{26}$/)
  await first.shutdown()
  const restarted = f.manager()
  await restarted.tick()
  expect(f.dispatches()).toBe(1)
  expect(pendingPrWatchWakes(registry.read())).toEqual([])
  expect(registry.read().registrations).toEqual({})
  expect(registry.read().snapshots).toEqual({})
})

test("receipt error is retryable and never interpreted as absence", async () => {
  const f = fixture(), registry = await f.seed(), manager = f.manager()
  f.fail(true)
  await manager.tick()
  expect(f.dispatches()).toBe(0)
  expect(pendingPrWatchWakes(registry.read())).toHaveLength(1)
  f.fail(false)
  await manager.tick()
  expect(f.dispatches()).toBe(1)
})

test("shutdown and session teardown never dispatch an outstanding wake", async () => {
  const f = fixture(), registry = await f.seed(), manager = f.manager()
  await manager.shutdown()
  await manager.tick()
  expect(f.dispatches()).toBe(0)
  const restarted = f.manager()
  const row = Object.values(registry.read().registrations)[0]
  if (!row) throw new Error("Missing seeded registration")
  await restarted.stopSession(row.sessionID)
  await restarted.tick()
  expect(f.dispatches()).toBe(0)
  expect(pendingPrWatchWakes(registry.read())).toEqual([])
})

test("corrupt and future registry cannot take down monitor construction or be overwritten", async () => {
  const f = fixture()
  await f.seed()
  for (const content of ['{bad json', '{"version":999}']) {
    writeFileSync(f.path, content)
    const manager = f.manager()
    await expect(manager.tick()).rejects.toThrow()
    expect(readFileSync(f.path, "utf8")).toBe(content)
    await manager.shutdown()
  }
})

test("500 acknowledged observations stay bounded, private and fully pruned on unwatch", async () => {
  const f = fixture(), registry = await f.seed()
  await registry.transaction(state => { for (const wake of pendingPrWatchWakes(state)) acknowledgePrWatchWake(state, wake.id) })
  const row = await registry.transaction(state => registerPrWatch(state, "acme/widget#2", "ses_bounds", "alice"))
  for (let i = 0; i < 500; i++) {
    await registry.transaction(state => {
      const wake = recordPrWatchEvents(state, row, [{ key: `failure-${i}`, kind: "check_failed", fact: "CI failed" }])
      if (!wake) throw new Error("Missing new observation")
      acknowledgePrWatchWake(state, wake.id)
    })
  }
  expect(Object.keys(registry.read().outbox)).toHaveLength(0)
  expect(registry.read().registrations[row.id]?.told).toHaveLength(1)
  expect(statSync(f.path).size).toBeLessThan(1500)
  if (process.platform !== "win32") {
    expect(statSync(join(f.path, "..")).mode & 0o777).toBe(0o700)
    expect(statSync(f.path).mode & 0o777).toBe(0o600)
  }
  await registry.transaction(state => stopPrWatch(state, row.id, "unwatched"))
  expect(registry.read().registrations).toEqual({})
})

test("two OS processes preserve registrations and share one poll and durable delivery", async () => {
  const f = fixture(), registry = await f.seed()
  // This starts actual child runtimes, not two objects sharing an in-memory queue.
  const modulePath = (name: string) => JSON.stringify(join(import.meta.dir, name))
  const script = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { createOpencodeClient } from '@opencode-ai/sdk';
    import { execFileSync } from "node:child_process"
import { GitHubReadTransport } from "./transport"
import { PrWatchManager, projectGitHubHost } from ${modulePath("manager.ts")};
    import { PrWatchRegistry } from ${modulePath("registry.ts")};
    import { registerPrWatch } from ${modulePath("state.ts")};
    import { GitHubPrWatchHost } from ${modulePath("github.ts")};
    const path = process.argv[1], session = process.argv[2];
    const registry = new PrWatchRegistry(path);
    await registry.transaction(state => { registerPrWatch(state, 'acme/widget#1', session, 'alice'); });
    const host = new GitHubPrWatchHost();
    host.fingerprints = async () => { const counter = path + '.polls'; let n = 0; try { n = Number(readFileSync(counter, 'utf8')); } catch {} writeFileSync(counter, String(n + 1)); return []; };
    host.details = async () => ({ state: 'OPEN', head: 'head', mergeable: 'MERGEABLE', checks: [] });
    host.activity = async () => ({ remarks: [] });
    const receipts = path + '.receipts';
    const client = createOpencodeClient({ baseUrl: 'http://child.test', fetch: async request => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/message')) { let data = []; try { data = JSON.parse(readFileSync(receipts, 'utf8')); } catch {} return Response.json(data); }
      if (url.pathname === '/session/status') return Response.json({});
      if (url.pathname.endsWith('/prompt_async')) { const countPath = path + '.dispatches'; let count = 0; try { count = Number(readFileSync(countPath, 'utf8')); } catch {} writeFileSync(countPath, String(count + 1)); const body = await request.json(); writeFileSync(receipts, JSON.stringify([{ info: { id: body.messageID, role: 'user' }, parts: [] }])); return new Response(null, { status: 204 }); }
      throw new Error(url.pathname);
    }});
    const manager = new PrWatchManager({ client, directory: ${JSON.stringify(join(f.path, ".."))} }, path, undefined, host);
    await manager.tick();
    await manager.shutdown();
  `
  await registry.transaction(state => { state.nextPollAt = 0 })
  const children = ["ses_child_one", "ses_child_two"].map(session => Bun.spawn([process.execPath, "--eval", script, f.path, session], { stdout: "pipe", stderr: "pipe" }))
  const outcomes = await Promise.all(children.map(async child => ({ exit: await child.exited, error: await new Response(child.stderr).text() })))
  expect(outcomes).toEqual([{ exit: 0, error: "" }, { exit: 0, error: "" }])
  expect(Object.values(registry.read().registrations).map(row => row.sessionID).sort()).toEqual(["ses_child_one", "ses_child_two"])
  expect(Number(readFileSync(`${f.path}.polls`, "utf8"))).toBe(1)
  expect(JSON.parse(readFileSync(`${f.path}.receipts`, "utf8"))).toHaveLength(1)
  expect(Number(readFileSync(`${f.path}.dispatches`, "utf8"))).toBe(1)
  expect(pendingPrWatchWakes(registry.read())).toEqual([])
}, 15_000)


test("GHES host is inferred from the project and explicit mismatched URLs fail before authentication", async () => {
  const f = fixture(), directory = join(f.path, "../project")
  const oldHost = process.env.GH_HOST
  delete process.env.GH_HOST
  try {
    execFileSync("git", ["init", "--quiet", directory])
    execFileSync("git", ["-C", directory, "remote", "add", "origin", "git@git.example.com:acme/widget.git"])
    expect(projectGitHubHost(directory)).toBe("git.example.com")
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
    const host = new GitHubPrWatchHost(new GitHubReadTransport({ host: projectGitHubHost(directory) }))
    let actors = 0
    host.actor = async () => { actors++; return "alice" }
    const manager = new PrWatchManager({ client, directory }, f.path, undefined, host)
    managers.push(manager)
    await expect(manager.watch("https://github.com/acme/widget/pull/1", "ses_host")).rejects.toThrow("PR host differs")
    expect(actors).toBe(0)
    const registration = await manager.watch("https://git.example.com/acme/widget/pull/1", "ses_host")
    expect(registration.reference).toBe("acme/widget#1")
    expect(registration.host).toBe("git.example.com")
  } finally {
    if (oldHost === undefined) delete process.env.GH_HOST
    else process.env.GH_HOST = oldHost
  }
})


test("legacy pending wake keeps its original hash-shaped receipt identity", async () => {
  const f = fixture(), registry = await f.seed()
  const wake = pendingPrWatchWakes(registry.read())[0]
  if (!wake) throw new Error("Missing legacy pending wake")
  f.receipts.push({ info: { id: `msg_${wake.id.slice(0, 32)}`, role: "user" }, parts: [] })
  await f.manager().tick()
  expect(f.dispatches()).toBe(0)
  expect(pendingPrWatchWakes(registry.read())).toEqual([])
})

test("new delivery id sorts after the session's latest user message", async () => {
  const f = fixture(), registry = await f.seed()
  const time = ((BigInt(Date.now()) + 1000n) * 0x1000n) & 0xffffffffffffn
  const latest = `msg_${time.toString(16).padStart(12, "0")}zzzzzzzzzzzzzz`
  f.receipts.push({ info: { id: latest, role: "user" }, parts: [] })
  await f.manager().tick()
  expect(f.dispatches()).toBe(1)
  const pending = pendingPrWatchWakes(registry.read())[0]
  if (!pending?.messageID) throw new Error("Missing persisted delivery id")
  expect(pending.messageID > latest).toBe(true)
  expect(pending.messageID).toMatch(/^msg_[0-9a-f]{26}$/)
})


test("idle legacy delivered wakes, stopped registrations and snapshots are pruned on boot", async () => {
  const f = fixture(), registry = await f.seed()
  const old = registry.read()
  for (const wake of Object.values(old.outbox)) wake.status = "delivered"
  old.snapshots["orphan/repo#1"] = { transition: 500 }
  writeFileSync(f.path, JSON.stringify(old))
  const manager = f.manager()
  // Constructor schedules immediately even though this file has no active or pending work.
  for (let i = 0; i < 100 && Object.keys(registry.read().outbox).length; i++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(registry.read().outbox).toEqual({})
  expect(registry.read().registrations).toEqual({})
  expect(registry.read().snapshots).toEqual({})
  expect(f.dispatches()).toBe(0)
  await manager.shutdown()
})
