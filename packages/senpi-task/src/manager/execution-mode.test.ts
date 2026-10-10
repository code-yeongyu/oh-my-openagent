import { describe, expect, test } from "bun:test"

import {
  AUTO_HOST_CAPABILITIES,
  createExecutionModeGate,
  resolveAutoExecutionMode,
  resolveExecutionMode,
} from "./execution-mode"

describe("resolveExecutionMode", () => {
  test("#given a spec mode #when resolved #then the spec mode wins over every other source", () => {
    // given
    const sources = { specMode: "process" as const, agentMode: "in-process" as const, configMode: "in-process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given no spec mode but an agent mode #when resolved #then the agent mode wins over config", () => {
    // given
    const sources = { agentMode: "process" as const, configMode: "in-process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given only a config mode #when resolved #then the config mode is used", () => {
    // given
    const sources = { configMode: "process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given no source at all #when resolved #then it falls back to in-process", () => {
    // given
    const sources = {}

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("in-process")
  })
})

describe("resolveExecutionMode with a configured auto mode", () => {
  test("#given config auto and a resolved auto mode #when resolved #then the resolved mode is used", () => {
    // given
    const sources = { configMode: "auto" as const, autoMode: "process" as const }

    // when / then
    expect(resolveExecutionMode(sources)).toBe("process")
  })

  test("#given config auto that has not resolved yet #when resolved #then it falls back to in-process", () => {
    // given / when / then
    expect(resolveExecutionMode({ configMode: "auto" })).toBe("in-process")
  })

  test("#given config auto and an explicit spec or agent mode #when resolved #then the explicit mode still wins", () => {
    // given / when / then
    expect(resolveExecutionMode({ configMode: "auto", autoMode: "process", specMode: "in-process" })).toBe("in-process")
    expect(resolveExecutionMode({ configMode: "auto", autoMode: "process", agentMode: "in-process" })).toBe("in-process")
  })

  test("#given an explicit config mode and a resolved auto mode #when resolved #then the auto mode is ignored", () => {
    // given / when / then
    expect(resolveExecutionMode({ configMode: "in-process", autoMode: "process" })).toBe("in-process")
  })
})

describe("resolveAutoExecutionMode", () => {
  const posixHost = { platform: "darwin" as const, processRunner: "host" as const }

  test("#given a posix host runner and a daemon advertising the session capabilities #when resolved #then children run as daemon sessions", () => {
    // given / when / then
    expect(resolveAutoExecutionMode({ ...posixHost, capabilities: [...AUTO_HOST_CAPABILITIES, "multi_session"] })).toBe("process")
  })

  test("#given a daemon without generation_handoff #when resolved #then children stay in-process", () => {
    // given / when / then
    expect(resolveAutoExecutionMode({ ...posixHost, capabilities: ["session_context", "session_kind"] })).toBe("in-process")
  })

  test("#given no daemon at all #when resolved #then children stay in-process", () => {
    // given / when / then
    expect(resolveAutoExecutionMode({ ...posixHost, capabilities: undefined })).toBe("in-process")
  })

  test("#given win32 or the child-process runner #when resolved #then children stay in-process even with every capability", () => {
    // given / when / then
    expect(resolveAutoExecutionMode({ platform: "win32", processRunner: "host", capabilities: AUTO_HOST_CAPABILITIES })).toBe("in-process")
    expect(resolveAutoExecutionMode({ platform: "darwin", processRunner: "child-process", capabilities: AUTO_HOST_CAPABILITIES })).toBe("in-process")
  })
})

describe("createExecutionModeGate", () => {
  test("#given a gate #when ensure runs twice #then the daemon is asked exactly once and the answer is stable", async () => {
    // given
    let calls = 0
    const gate = createExecutionModeGate(() => {
      calls += 1
      return Promise.resolve("process" as const)
    })

    // when
    const first = await gate.ensure()
    const second = await gate.ensure()

    // then
    expect([first, second]).toEqual(["process", "process"])
    expect(calls).toBe(1)
    expect(gate.current()).toBe("process")
  })

  test("#given a gate that resolved to process #when the daemon later goes down #then the parent session keeps the resolved mode", async () => {
    // given
    let daemonAlive = true
    const gate = createExecutionModeGate(() =>
      daemonAlive ? Promise.resolve("process" as const) : Promise.reject(new Error("daemon is gone")),
    )
    await gate.ensure()

    // when
    daemonAlive = false

    // then
    expect(await gate.ensure()).toBe("process")
    expect(gate.current()).toBe("process")
  })

  test("#given a resolution that throws #when ensure runs #then the gate settles on in-process instead of rejecting", async () => {
    // given
    const gate = createExecutionModeGate(() => Promise.reject(new Error("host unavailable (capability)")))

    // when
    const mode = await gate.ensure()

    // then
    expect(mode).toBe("in-process")
    expect(gate.current()).toBe("in-process")
  })

  test("#given a gate that has never been ensured #when current is read #then it is undefined", () => {
    // given / when / then
    expect(createExecutionModeGate(() => Promise.resolve("process" as const)).current()).toBeUndefined()
  })

  test("#given a resolution that throws #when ensure runs #then onEnsureFailure sees the error once", async () => {
    // given
    const failures: unknown[] = []
    const gate = createExecutionModeGate(() => Promise.reject(new Error("boom")), { onEnsureFailure: (error) => failures.push(error) })

    // when
    await gate.ensure()
    await gate.ensure()

    // then
    expect(failures.map((error) => (error instanceof Error ? error.message : String(error)))).toEqual(["boom"])
  })
})

describe("ExecutionModeGate.warm (the task-host pre-warm)", () => {
  function scriptedGate(answers: readonly ("process" | "in-process" | Error)[]) {
    let calls = 0
    const warmFailures: unknown[] = []
    const ensureFailures: unknown[] = []
    const gate = createExecutionModeGate(
      () => {
        const answer = answers[Math.min(calls, answers.length - 1)]
        calls += 1
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? "in-process")
      },
      { onWarmFailure: (error) => warmFailures.push(error), onEnsureFailure: (error) => ensureFailures.push(error) },
    )
    return { gate, calls: () => calls, warmFailures, ensureFailures }
  }

  test("#given a warm that answered #when the first spawn ensures #then the answer is reused without asking again", async () => {
    // given
    const g = scriptedGate(["process"])
    await g.gate.warm()

    // when
    const mode = await g.gate.ensure()

    // then
    expect(mode).toBe("process")
    expect(g.gate.current()).toBe("process")
    expect(g.calls()).toBe(1)
  })

  test("#given a warm that failed #when the first spawn ensures #then the host is asked again and the failure never settled the session", async () => {
    // given
    const g = scriptedGate([new Error("cold start timed out"), "process"])
    await g.gate.warm()
    const afterWarm = g.gate.current()

    // when
    const mode = await g.gate.ensure()

    // then
    expect(afterWarm).toBeUndefined()
    expect(mode).toBe("process")
    expect(g.calls()).toBe(2)
    expect(g.warmFailures).toHaveLength(1)
    expect(g.ensureFailures).toEqual([])
  })

  test("#given a warm still in flight #when a spawn ensures #then it joins the warm instead of asking twice", async () => {
    // given
    const g = scriptedGate(["process"])
    const warming = g.gate.warm()

    // when
    const mode = await g.gate.ensure()
    await warming

    // then
    expect(mode).toBe("process")
    expect(g.calls()).toBe(1)
  })

  test("#given a warm in flight that fails #when a spawn joined it #then the spawn asks again rather than inheriting the failure", async () => {
    // given
    const g = scriptedGate([new Error("cold start timed out"), "process"])
    const warming = g.gate.warm()

    // when
    const mode = await g.gate.ensure()
    await warming

    // then
    expect(mode).toBe("process")
    expect(g.calls()).toBe(2)
  })

  test("#given a settled gate #when warm runs #then nothing is asked", async () => {
    // given
    const g = scriptedGate(["in-process"])
    await g.gate.ensure()

    // when
    await g.gate.warm()

    // then
    expect(g.calls()).toBe(1)
    expect(g.gate.current()).toBe("in-process")
  })
})

describe("execution-mode gate store admission", () => {
  test("#given a task store the index cannot take #when a spawn asks #then nothing is resolved and the spawn goes to the host runner", async () => {
    // given
    let resolves = 0
    const gate = createExecutionModeGate(() => {
      resolves += 1
      return Promise.resolve("process")
    }, { admit: () => Promise.resolve(false) })

    // when
    const mode = await gate.ensure()

    // then
    expect(mode).toBe("process")
    expect(resolves).toBe(0)
    expect(gate.current()).toBeUndefined()
  })

  test("#given a store the index takes after a failure #when the next spawn asks #then the gate resolves once and keeps it", async () => {
    // given
    const answers = [false, true, true]
    const order: string[] = []
    const gate = createExecutionModeGate(() => {
      order.push("resolve")
      return Promise.resolve("in-process")
    }, {
      admit: () => {
        order.push("admit")
        return Promise.resolve(answers.shift() ?? true)
      },
    })

    // when
    const first = await gate.ensure()
    const second = await gate.ensure()
    const third = await gate.ensure()

    // then
    expect([first, second, third]).toEqual(["process", "in-process", "in-process"])
    expect(order).toEqual(["admit", "admit", "resolve"])
  })
})
