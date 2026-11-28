import { expect, test } from "bun:test"

import { createReplaySpawn, exited, readFixture } from "./__fixtures__/replay-spawn"
import { createAtomicClient } from "./client"
import { createAtomicContextService, type AtomicContextDiagnostic } from "./context"

function setup(output = () => exited(readFixture("vault-context-json.txt"))) {
  const replay = createReplaySpawn(output)
  const client = createAtomicClient({
    executable: "atomic",
    environment: {},
    version: { major: 0, minor: 22, patch: 1, text: "0.22.1" },
    spawn: replay.spawn,
  })
  const warnings: AtomicContextDiagnostic[] = []
  const clock = { time: 0 }
  const service = createAtomicContextService({
    client,
    policy: { enabled: true, limit: 5, budget_chars: 256, timeout_ms: 1000, cache_ttl_ms: 10 },
    warn: ({ code }) => warnings.push(code),
    now: () => clock.time,
  })
  const scope = { cwd: "/checkout", repository: "/checkout", view: "dev", needsReindex: false }
  const request = { scope, sessionId: "session", query: "type  checker", files: ["b.ts", "a.ts"] }
  return { service, request, clock, warnings, requests: replay.requests }
}

test("coalesces matching context requests and refreshes them at TTL expiry", async () => {
  // given
  const { service, request, clock, requests } = setup()
  // when
  const [initial, equivalent] = await Promise.all([
    service.inject(request),
    service.inject({ ...request, query: " type checker ", files: ["a.ts", "b.ts"] }),
  ])
  await service.inject(request)
  const beforeExpiry = requests.length
  clock.time = 10
  await service.inject(request)
  // then
  expect(initial?.reference).toHaveLength(256)
  expect(equivalent).toEqual(initial)
  expect([beforeExpiry, requests.length]).toEqual([1, 2])
})

test("separates views and intents, then invalidates every view in the repository", async () => {
  // given
  const { service, request, requests } = setup()
  const alternatives = [
    request,
    { ...request, scope: { ...request.scope, view: "member" } },
    { ...request, intentId: "intent-a" },
  ]
  // when
  await Promise.all(alternatives.map(service.inject))
  const before = requests.length
  service.invalidate(request.scope.repository)
  await Promise.all(alternatives.map(service.inject))
  // then
  expect([before, requests.length]).toEqual([3, 6])
})

test("does not return or repopulate outdated context when invalidated during retrieval", async () => {
  // given
  const { service, request, requests } = setup()
  // when
  const obsolete = service.inject(request)
  service.invalidate(request.scope.repository)
  const fresh = await service.inject(request)
  // then
  expect(await obsolete).toBeUndefined()
  expect(fresh?.stale).toBe(false)
  expect(requests).toHaveLength(2)
})

test("delivers available context with a stale flag and one diagnostic without auto-reindex", async () => {
  // given
  const { service, request, requests, warnings } = setup()
  const stale = { ...request, scope: { ...request.scope, needsReindex: true } }
  // when
  const first = await service.inject(stale)
  const second = await service.inject(stale)
  // then
  expect([first?.stale, second?.stale]).toEqual([true, true])
  expect(warnings).toEqual(["stale_index"])
  expect(requests.map(({ args }) => args.slice(0, 2))).toEqual([["vault", "context"]])
})

test("malformed context fails open, is not cached and warns once per session", async () => {
  // given
  const { service, request, requests, warnings } = setup(() => exited("not JSON"))
  // when
  const results = [await service.inject(request), await service.inject(request)]
  // then
  expect(results).toEqual([undefined, undefined])
  expect(requests).toHaveLength(2)
  expect(warnings).toEqual(["invalid_response"])
})
