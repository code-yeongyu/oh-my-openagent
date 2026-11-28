import { expect, test } from "bun:test"

import { createReplaySpawn, exited, readFixture } from "./__fixtures__/replay-spawn"
import { createAtomicClient } from "./client"
import { createAtomicContextService } from "./context"
import { createAtomicOperations } from "./operations"
import type { AtomicSpawnRequest } from "./process"

const scope = { cwd: "/checkout", repository: "/checkout", view: "dev", needsReindex: false }
const intentId = "FIXT::fixture-author::1"
const memoryId = "01m8ftn3zh35e1evsx9qj5jkzm"

function setup(respond: (request: AtomicSpawnRequest) => ReturnType<typeof exited>, assignedIntentId?: string) {
  const replay = createReplaySpawn(respond)
  const client = createAtomicClient({
    executable: "atomic",
    environment: {},
    version: { major: 0, minor: 22, patch: 1, text: "0.22.1" },
    spawn: replay.spawn,
  })
  const context = createAtomicContextService({
    client,
    policy: { enabled: true, limit: 5, budget_chars: 8000, timeout_ms: 1000, cache_ttl_ms: 10_000 },
    warn: () => {},
  })
  const operations = createAtomicOperations({ client, context, sessionId: "session", assignedIntentId })
  return {
    ...operations,
    requests: replay.requests,
    execute: (tool: string, input: unknown) => operations.execute({ tool, input, scope }),
  }
}

test("refuses to create an intent when the session already has an assignment", async () => {
  // given
  const { execute, requests } = setup(() => exited("unexpected spawn"), intentId)
  // when / then
  await expect(execute("atomic_intent", { operation: "new", title: "Duplicate" })).rejects.toMatchObject({
    code: "ownership_mismatch", sideEffectsPossible: false,
  })
  expect(requests).toHaveLength(0)
})

test("concurrent intent creation assigns exactly one intent and context reuses it", async () => {
  // given
  const { execute, assignedIntent, requests } = setup(({ args }) => {
    if (args[1] === "new") return exited(readFixture("intent-new.txt"))
    if (args[1] === "list") return exited(readFixture("intent-list-json.txt"))
    return exited(readFixture("vault-context-json.txt"))
  })
  const create = { operation: "new", title: "Fixture intent" }
  // when
  const creations = await Promise.allSettled([execute("atomic_intent", create), execute("atomic_intent", create)])
  const context = await execute("atomic_context", {})
  // then
  expect(creations.map(({ status }) => status)).toEqual(["fulfilled", "rejected"])
  expect(assignedIntent()).toBe(intentId)
  expect(context).toMatchObject({ stale: false })
  expect(requests.filter(({ args }) => args[1] === "new")).toHaveLength(1)
  expect(requests.at(-1)?.args).toContain(`--intent=${intentId}`)
})

test("submitting a review allows pinned signature omissions and only advances after attestation and validation", async () => {
  // given a replay whose intent status changes only when the requested status reaches the CLI
  let attested = false
  let status = "backlog"
  const { execute, requests } = setup(({ args }) => {
    switch (args[1]) {
      case "sync": return exited("")
      case "validate":
        return exited(readFixture(attested ? "intent-validate-conforming.txt" : "intent-validate-nonconforming.txt"))
      case "attest": attested = true; return exited(readFixture("intent-attest.txt"))
      case "update": status = args[2]?.split("=")[1] ?? status; return exited("")
      case "list": return exited(readFixture("intent-list-json.txt").replace("backlog", status))
      default: return exited("unexpected operation", 4)
    }
  })
  // when
  const intent = await execute("atomic_intent", { operation: "submit_review", intent_id: intentId })
  // then
  expect(intent).toMatchObject({ id: intentId, status: "needs-review" })
  expect(requests.map(({ args }) => args[1])).toEqual(["sync", "validate", "attest", "validate", "update", "list"])
})

test("submitting a review stops before attestation on an unrelated violation", async () => {
  // given
  const { execute, requests } = setup(({ args }) =>
    args[1] === "sync" ? exited("") : exited("conforms: no (1 violation(s))\n  ✗ [IntentShape] target (title): missing title\n"))
  // when / then
  await expect(execute("atomic_intent", { operation: "submit_review", intent_id: intentId })).rejects.toMatchObject({
    code: "review_blocked",
  })
  expect(requests.map(({ args }) => args[1])).toEqual(["sync", "validate"])
})

test("submitting a review refuses a report that omits one of its stated findings", async () => {
  // given
  const { execute, requests } = setup(({ args }) => args[1] === "sync" ? exited("") :
    exited(readFixture("intent-validate-nonconforming.txt").replace("2 violation", "3 violation")))
  // when / then
  await expect(execute("atomic_intent", { operation: "submit_review", intent_id: intentId })).rejects.toMatchObject({
    code: "invalid_response",
  })
  expect(requests.map(({ args }) => args[1])).toEqual(["sync", "validate"])
})

test("returns the created memory ID when its attestation fails and invalidates cached context", async () => {
  // given
  const { execute, requests } = setup(({ args }) =>
    args[0] === "vault" ? exited(readFixture("vault-context-json.txt")) :
      args[1] === "new" ? exited(readFixture("memory-new-json.txt")) : exited("", 4, "attestation failed"))
  await execute("atomic_context", {})
  // when
  const result = await execute("atomic_memory", { kind: "decision", text: "Use the verified repository." })
  await execute("atomic_context", {})
  // then
  expect(result).toMatchObject({
    kind: "partial", stage: "attest", memory: { id: memoryId }, error: { code: "command_failed" },
  })
  expect(requests.map(({ args }) => args.slice(0, 2))).toEqual([
    ["vault", "context"], ["memory", "new"], ["memory", "attest"], ["vault", "context"],
  ])
})

test("validates the newly attested memory and sync refreshes a previously cached context", async () => {
  // given
  const { execute, requests } = setup(({ args }) => {
    if (args[0] === "vault") return args[1] === "sync" ? exited("") : exited(readFixture("vault-context-json.txt"))
    return exited(readFixture(`memory-${args[1]}${args[1] === "new" ? "-json" : ""}.txt`))
  })
  await execute("atomic_context", {})
  // when
  await execute("atomic_sync", {})
  await execute("atomic_context", {})
  const result = await execute("atomic_memory", { kind: "decision", text: "Prefer isolated recording." })
  // then
  expect(result).toMatchObject({ kind: "created", memory: { id: memoryId } })
  expect(requests.map(({ args }) => args[1])).toEqual(["context", "sync", "context", "new", "attest", "validate"])
  expect(requests.at(-1)?.args.at(-1)).toBe(memoryId)
})

test.each([
  ["atomic_vcs", { operation: "record" }],
  ["atomic_vcs", { operation: "add" }],
  ["atomic_vcs", { operation: "status", limit: 1 }],
  ["atomic_query", { operation: "entities", query: "needle", file_path: "source.ts" }],
  ["atomic_sync", { cwd: "/different-checkout" }],
  ["atomic_context", { limit: 6 }],
] as const)("rejects invalid or conflicting %s arguments without spawning", async (tool, input) => {
  // given
  const { execute, requests } = setup(() => exited("unexpected spawn"))
  // when / then
  await expect(execute(tool, input)).rejects.toMatchObject({ code: "invalid_input" })
  expect(requests).toHaveLength(0)
})
