import { describe, expect, test } from "bun:test"

import { createReplaySpawn, exited, readFixture } from "./__fixtures__/replay-spawn"
import { type AtomicClient, type AtomicSpawnOutcome, AtomicError, createAtomicClient } from "./index"

const SUPPORTED = { major: 0, minor: 22, patch: 1, text: "0.22.1" }
const call = { cwd: "/tmp/atomic-fixture/repo" }

function clientReplaying(outcome: AtomicSpawnOutcome, version = SUPPORTED) {
  const replay = createReplaySpawn(() => outcome)
  const client = createAtomicClient({ executable: "/opt/atomic/bin/atomic", spawn: replay.spawn, environment: {}, version })
  return { client, requests: replay.requests }
}

async function rejection(promise: Promise<unknown>): Promise<AtomicError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof AtomicError)) throw new Error(`expected an AtomicError, got ${String(error)}`)
  return error
}

type ReadCase = {
  readonly name: string
  readonly fixture: string
  readonly argv: readonly string[]
  readonly invoke: (client: AtomicClient) => Promise<unknown>
}

const READ_CASES: readonly ReadCase[] = [
  { name: "status", fixture: "status-json.txt", argv: ["status", "--json"], invoke: (c) => c.status(call) },
  { name: "status with changes", fixture: "status-modified-json.txt", argv: ["status", "--json"], invoke: (c) => c.status(call) },
  { name: "diff", fixture: "diff-json.txt", argv: ["diff", "--json"], invoke: (c) => c.diff(call) },
  { name: "log", fixture: "log-json.txt", argv: ["log", "--format", "json", "--count=20"], invoke: (c) => c.log({ ...call, limit: 20 }) },
  { name: "change", fixture: "change-json.txt", argv: ["change", "--format", "json", "--", "HASH"], invoke: (c) => c.change({ ...call, hash: "HASH" }) },
  { name: "change with provenance", fixture: "change-provenance-json.txt", argv: ["change", "--format", "json", "--", "HASH"], invoke: (c) => c.change({ ...call, hash: "HASH" }) },
  { name: "view list", fixture: "view-list-json.txt", argv: ["view", "list", "--json"], invoke: (c) => c.viewList(call) },
  { name: "triage review", fixture: "triage-review-json.txt", argv: ["triage", "review", "--json", "--into=dev", "--", "feature"], invoke: (c) => c.triageReview({ ...call, view: "feature", into: "dev" }) },
  { name: "query search", fixture: "query-search-json.txt", argv: ["query", "search", "--json", "--limit=5", "--", "greet"], invoke: (c) => c.querySearch({ ...call, query: "greet", limit: 5 }) },
  { name: "query code", fixture: "query-code-json.txt", argv: ["query", "code", "--json", "--max-results=5", "--", "greet"], invoke: (c) => c.queryCode({ ...call, pattern: "greet", limit: 5 }) },
  { name: "query entities", fixture: "query-entities-json.txt", argv: ["query", "entities", "--json", "--", "src/greet.ts"], invoke: (c) => c.queryEntities({ ...call, filePath: "src/greet.ts" }) },
  { name: "query neighbors", fixture: "query-neighbors-json.txt", argv: ["query", "neighbors", "--json", "--depth=2", "--", "urn:x"], invoke: (c) => c.queryNeighbors({ ...call, nodeId: "urn:x", depth: 2 }) },
  { name: "vault context", fixture: "vault-context-json.txt", argv: ["vault", "context", "--json", "--files=src/a b.ts", "--limit=3", "--", "greet"], invoke: (c) => c.vaultContext({ ...call, query: ["greet"], files: ["src/a b.ts"], limit: 3 }) },
  { name: "intent list", fixture: "intent-list-json.txt", argv: ["intent", "list", "--json"], invoke: (c) => c.intentList(call) },
  { name: "intent show", fixture: "intent-show-json.txt", argv: ["intent", "show", "--json", "--", "FIXT::1"], invoke: (c) => c.intentShow({ ...call, id: "FIXT::1" }) },
  { name: "agent status", fixture: "agent-status-json.txt", argv: ["agent", "status", "--json"], invoke: (c) => c.agentStatus(call) },
  { name: "agent status with a session", fixture: "agent-status-session-json.txt", argv: ["agent", "status", "--json"], invoke: (c) => c.agentStatus(call) },
  { name: "lifecycle status", fixture: "agent-lifecycle-status-json.txt", argv: ["agent", "lifecycle", "status", "--json"], invoke: (c) => c.lifecycleStatus(call) },
]

describe("atomic client read contracts (0.22.1 fixtures)", () => {
  for (const readCase of READ_CASES) {
    test(`#given the pinned ${readCase.name} output #when read #then every captured field survives validation`, async () => {
      // given
      const fixture = readFixture(readCase.fixture)
      const { client, requests } = clientReplaying(exited(fixture))

      // when
      const result = await readCase.invoke(client)

      // then
      expect(result).toEqual(JSON.parse(fixture))
      expect(requests.map((request) => request.args)).toEqual([readCase.argv])
    })
  }
})

describe("atomic client failure mapping", () => {
  test("#given a usage error block on exit 2 #when status runs #then it is command_failed naming the CLI code", async () => {
    // given
    const { client } = clientReplaying(exited("", 2, readFixture("usage-unknown-arg.stderr.txt")))

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("command_failed")
    expect(error.message).toContain("unknown-arg")
  })

  test("#given the same usage block with exit 0 #when log runs #then it still fails instead of parsing stdout", async () => {
    // given
    const { client } = clientReplaying(exited(readFixture("log-json.txt"), 0, readFixture("usage-invalid-value.stderr.txt")))

    // when
    const error = await rejection(client.log(call))

    // then
    expect(error.code).toBe("command_failed")
    expect(error.message).toContain("invalid-value")
  })

  test("#given exit 3 outside a repository #when status runs #then it is not_repository", async () => {
    // given
    const { client } = clientReplaying(exited("", 3, readFixture("not-repository.stderr.txt")))

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("not_repository")
    expect(error.retryable).toBe(false)
  })

  test("#given truncated JSON #when status runs #then it is invalid_response", async () => {
    // given
    const fixture = readFixture("status-json.txt")
    const { client } = clientReplaying(exited(fixture.slice(0, fixture.length / 2)))

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("invalid_response")
  })

  test("#given an error object with exit 0 #when status runs #then it is command_failed", async () => {
    // given
    const { client } = clientReplaying(exited(JSON.stringify({ error: { code: "INTERNAL" } })))

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("command_failed")
  })

  test("#given a document missing required fields #when diff runs #then it is invalid_response", async () => {
    // given
    const { client } = clientReplaying(exited(JSON.stringify({ schema_version: 1, view: "dev" })))

    // when
    const error = await rejection(client.diff(call))

    // then
    expect(error.code).toBe("invalid_response")
  })

  test("#given an unsupported schema_version #when status runs #then it is invalid_response", async () => {
    // given
    const document = { ...JSON.parse(readFixture("status-json.txt")), schema_version: 2 }
    const { client } = clientReplaying(exited(JSON.stringify(document)))

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("invalid_response")
  })

  test("#given the executable vanished #when spawning fails with ENOENT #then it is binary_missing", async () => {
    // given
    const { client } = clientReplaying({ kind: "spawn_failed", errorCode: "ENOENT", message: "spawn ENOENT" })

    // when
    const error = await rejection(client.status(call))

    // then
    expect(error.code).toBe("binary_missing")
  })

  test("#given a timeout #when a read or a mutation times out #then only the read is retryable", async () => {
    // given
    const { client } = clientReplaying({ kind: "timeout" })

    // when
    const read = await rejection(client.status(call))
    const mutation = await rejection(client.vaultSync(call))

    // then
    expect([read.code, read.retryable, read.sideEffectsPossible]).toEqual(["timeout", true, false])
    expect([mutation.code, mutation.retryable, mutation.sideEffectsPossible]).toEqual(["timeout", false, true])
  })

  test("#given an output overflow or cancellation #when reading #then each maps to its own code", async () => {
    // given
    const overflow = clientReplaying({ kind: "output_limit", stream: "stdout" }).client
    const cancelled = clientReplaying({ kind: "cancelled" }).client

    // when
    const errors = await Promise.all([rejection(overflow.diff(call)), rejection(cancelled.diff(call))])

    // then
    expect(errors.map((error) => error.code)).toEqual(["output_limit", "cancelled"])
  })

  test("#given a path escaping the repository #when queried #then unsafe_path is raised without spawning", async () => {
    // given
    const { client, requests } = clientReplaying(exited("[]"))

    // when
    const errors = await Promise.all([
      rejection(client.queryEntities({ ...call, filePath: "../outside.ts" })),
      rejection(client.queryEntities({ ...call, filePath: "/etc/passwd" })),
      rejection(client.vaultContext({ ...call, files: ["src/../../x"] })),
    ])

    // then
    expect(errors.map((error) => error.code)).toEqual(["unsafe_path", "unsafe_path", "unsafe_path"])
    expect(requests).toEqual([])
  })

  test("#given hostile query text #when searched #then it is passed as one argument after --", async () => {
    // given
    const hostile = "--help; rm -rf ~ $(whoami) 'q' | cat"
    const { client, requests } = clientReplaying(exited("[]"))

    // when
    await client.querySearch({ ...call, query: hostile })

    // then
    expect(requests[0]?.args).toEqual(["query", "search", "--json", "--", hostile])
  })

  test("#given vault context #when called #then the context budget and 128 KiB output cap apply", async () => {
    // given
    const { client, requests } = clientReplaying(exited(readFixture("vault-context-json.txt")))

    // when
    await client.vaultContext(call)

    // then
    expect(requests[0]?.timeoutMs).toBe(1000)
    expect(requests[0]?.outputLimitBytes).toBe(128 * 1024)
  })
})
