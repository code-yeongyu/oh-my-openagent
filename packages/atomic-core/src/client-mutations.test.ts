import { describe, expect, test } from "bun:test"

import { createReplaySpawn, exited, readFixture } from "./__fixtures__/replay-spawn"
import { ATOMIC_HOOK_VERBS, AtomicError, type AtomicHookAgent, createAtomicClient } from "./index"
import type { AtomicSpawnOutcome, AtomicSpawnRequest } from "./process"

const SUPPORTED = { major: 0, minor: 22, patch: 1, text: "0.22.1" }
const call = { cwd: "/tmp/atomic-fixture/repo" }
const INTENT_ID = "FIXT::fixture-author::1"

function clientRouting(respond: (request: AtomicSpawnRequest) => AtomicSpawnOutcome, version = SUPPORTED) {
  const replay = createReplaySpawn(respond)
  const client = createAtomicClient({ executable: "/opt/atomic/bin/atomic", spawn: replay.spawn, environment: {}, version })
  return { client, requests: replay.requests }
}

function intentListWithStatus(status: string): string {
  const list: unknown = JSON.parse(readFixture("intent-list-json.txt"))
  if (!Array.isArray(list)) throw new Error("intent list fixture is not an array")
  return JSON.stringify(list.map((entry: Record<string, unknown>) => ({ ...entry, status })))
}

async function rejection(promise: Promise<unknown>): Promise<AtomicError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof AtomicError)) throw new Error(`expected an AtomicError, got ${String(error)}`)
  return error
}

describe("atomic client vault mutations", () => {
  test("#given intent new succeeds #when the intent list contains the id #then the created summary is returned", async () => {
    // given
    const { client, requests } = clientRouting((request) =>
      request.args[1] === "new" ? exited(readFixture("intent-new.txt")) : exited(readFixture("intent-list-json.txt")),
    )

    // when
    const created = await client.intentNew({ ...call, title: "-dash title", kind: "feature" })

    // then
    expect(created.id).toBe(INTENT_ID)
    expect(requests.map((request) => request.args)).toEqual([
      ["intent", "new", "--kind=feature", "--", "-dash title"],
      ["intent", "list", "--json"],
    ])
  })

  test("#given intent new reports an id #when the list lacks it #then the outcome is indeterminate", async () => {
    // given
    const { client } = clientRouting((request) =>
      request.args[1] === "new" ? exited(readFixture("intent-new.txt")) : exited(readFixture("intent-list-empty-json.txt")),
    )

    // when
    const error = await rejection(client.intentNew({ ...call, title: "Fixture intent" }))

    // then
    expect([error.code, error.sideEffectsPossible]).toEqual(["operation_indeterminate", true])
  })

  test("#given a status change #when the read back matches or not #then success requires the typed read", async () => {
    // given
    const matching = clientRouting((request) =>
      request.args[1] === "update" ? exited(readFixture("intent-update-needs-review.txt")) : exited(intentListWithStatus("needs-review")),
    )
    const stale = clientRouting((request) =>
      request.args[1] === "update" ? exited(readFixture("intent-update-needs-review.txt")) : exited(intentListWithStatus("backlog")),
    )

    // when
    const updated = await matching.client.intentUpdateStatus({ ...call, id: INTENT_ID, status: "needs-review" })
    const error = await rejection(stale.client.intentUpdateStatus({ ...call, id: INTENT_ID, status: "needs-review" }))

    // then
    expect(updated.status).toBe("needs-review")
    expect(matching.requests[0]?.args).toEqual(["intent", "update", "--status=needs-review", "--", INTENT_ID])
    expect(error.code).toBe("operation_indeterminate")
  })

  test("#given an unknown session #when starting work #then the exit 128 failure is command_failed", async () => {
    // given
    const { client, requests } = clientRouting(() => exited("", 128, readFixture("intent-update-unknown-session.stderr.txt")))

    // when
    const error = await rejection(client.intentUpdateStatus({ ...call, id: INTENT_ID, status: "in_progress", sessionId: "ses_x" }))

    // then
    expect([error.code, error.sideEffectsPossible]).toEqual(["command_failed", true])
    expect(requests[0]?.args).toEqual(["intent", "update", "--status=in_progress", "--session-id=ses_x", "--", INTENT_ID])
  })

  test("#given validate and attest output #when parsed #then the conformance verdict is typed", async () => {
    // given
    const outputs: Record<string, string> = {
      "intent validate": "intent-validate-nonconforming.txt",
      "intent attest": "intent-attest.txt",
      "memory validate": "memory-validate.txt",
      "memory attest": "memory-attest.txt",
    }
    const { client } = clientRouting((request) => exited(readFixture(outputs[request.args.slice(0, 2).join(" ")] ?? "")))

    // when
    const verdicts = await Promise.all([
      client.intentValidate({ ...call, id: INTENT_ID }),
      client.intentAttest({ ...call, id: INTENT_ID }),
      client.memoryValidate({ ...call, id: "m1" }),
      client.memoryAttest({ ...call, id: "m1" }),
    ])

    // then
    expect(verdicts.map((verdict) => verdict.conforms)).toEqual([false, true, true, true])
    expect(verdicts[0]?.violations).toHaveLength(2)
  })

  test("#given memory new #when the text starts with a dash #then it stays one option value", async () => {
    // given
    const { client, requests } = clientRouting(() => exited(readFixture("memory-new-json.txt")))

    // when
    const created = await client.memoryNew({ ...call, kind: "lesson", text: "-not a flag", derivedFrom: ["urn:a", "urn:b"] })

    // then
    expect(created).toEqual(JSON.parse(readFixture("memory-new-json.txt")))
    expect(requests[0]?.args).toEqual(["memory", "new", "--kind=lesson", "--text=-not a flag", "--derived-from=urn:a,urn:b", "--json"])
  })
})

describe("atomic client hook dispatch", () => {
  const agents = Object.keys(ATOMIC_HOOK_VERBS) as AtomicHookAgent[]
  for (const agent of agents) {
    for (const verb of ATOMIC_HOOK_VERBS[agent]) {
      test(`#given the pinned ${agent} ${verb} payload #when dispatched #then argv and stdin match the shipped integration`, async () => {
        // given
        const payload: Record<string, unknown> = JSON.parse(readFixture(`${agent}-${verb}.json`))
        const { client, requests } = clientRouting(() => exited(""))
        const foreground = agent === "opencode" || (agent === "codex" && verb === "stop")

        // when
        await client.dispatchHook({ ...call, agent, verb, payload, timeoutMs: 30_000 })

        // then
        expect(requests[0]?.args).toEqual(["agent", "hooks", agent, verb, ...(foreground ? ["--foreground"] : [])])
        expect(requests[0]?.stdin).toBe(readFixture(`${agent}-${verb}.json`).trim())
        expect(requests[0]?.timeoutMs).toBe(30_000)
      })
    }
  }
})

describe("atomic client version gate", () => {
  test("#given a newer minor family #when reading and mutating #then reads run and mutations never spawn", async () => {
    // given
    const degraded = { major: 0, minor: 23, patch: 0, text: "0.23.0" }
    const { client, requests } = clientRouting(() => exited(readFixture("status-json.txt")), degraded)

    // when
    const status = await client.status(call)
    const error = await rejection(client.vaultSync(call))

    // then
    expect(client.compatibility).toBe("degraded")
    expect(status.view).toBe(JSON.parse(readFixture("status-json.txt")).view)
    expect(error.code).toBe("version_unsupported")
    expect(requests).toHaveLength(1)
  })

  test("#given a release older than 0.22.1 #when creating a client #then it is refused", () => {
    // given
    const versions = [
      { major: 0, minor: 22, patch: 0, text: "0.22.0" },
      { major: 0, minor: 21, patch: 9, text: "0.21.9" },
    ]

    // when
    const codes = versions.map((version) => {
      try {
        createAtomicClient({ executable: "/opt/atomic/bin/atomic", spawn: createReplaySpawn(() => exited("")).spawn, environment: {}, version })
        return "created"
      } catch (error) {
        return error instanceof AtomicError ? error.code : "other"
      }
    })

    // then
    expect(codes).toEqual(["version_unsupported", "version_unsupported"])
  })
})
