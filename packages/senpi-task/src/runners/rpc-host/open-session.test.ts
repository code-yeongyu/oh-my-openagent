import { describe, expect, test } from "bun:test"

import { RunnerError } from "../in-process/runner-error"
import { HostSessionOpenError } from "./session-client"
import { openTaskHostSession } from "./open-session"
import type { HostSessionOpenInput } from "./session-transport"

const spec = {
  task_id: "st_open",
  cwd: "/tmp/project",
  state_dir: "/tmp/state",
  prompt: "work",
  model: "test/model",
}

describe("openTaskHostSession suffix and post-start model (#9722)", () => {
  test("#given a model pin with a thinking-level suffix #when the session opens #then the base id and level go to the host, never the decorated string", async () => {
    // given
    const openedInputs: HostSessionOpenInput[] = []
    const client = {
      open: (input: HostSessionOpenInput) => {
        openedInputs.push(input)
        return Promise.resolve({ sessionId: "sess-1", attached: false, instanceId: "i-1", engineVersion: "v" })
      },
      getState: () => Promise.resolve({ sessionId: "sess-1", model: { provider: "test", id: "model" } }),
    }

    // when
    const opened = await openTaskHostSession({
      client,
      spec: { ...spec, model: "test/model:medium" },
      sessionPath: "/tmp/session.jsonl",
    })

    // then
    expect(openedInputs).toHaveLength(1)
    expect(openedInputs[0]).toMatchObject({ provider: "test", modelId: "model", thinkingLevel: "medium" })
    expect(opened.reportedModel).toEqual({ provider: "test", id: "model" })
  })

  test("#given a fresh open whose host state reports a different model #when the session opens #then the spawn fails typed as model_unavailable and the channel is closed (#9722)", async () => {
    // given
    let closeCalls = 0
    const client = {
      open: () => Promise.resolve({ sessionId: "sess-1", attached: false, instanceId: "i-1", engineVersion: "v" }),
      getState: () => Promise.resolve({ sessionId: "sess-1", model: { provider: "test", id: "substitute" } }),
      close: () => {
        closeCalls += 1
        return Promise.resolve()
      },
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(failure instanceof Error ? failure.message : "").toContain("test/substitute")
    expect(failure instanceof Error ? failure.message : "").toContain("test/model")
    expect(closeCalls).toBe(1)
  })

  test("#given a fresh open whose state read fails #when the session opens #then the spawn fails closed and the channel is closed (#9722)", async () => {
    // given
    let closeCalls = 0
    const client = {
      open: () => Promise.resolve({ sessionId: "sess-1", attached: false, instanceId: "i-1", engineVersion: "v" }),
      getState: () => Promise.reject(new Error("state unavailable")),
      close: () => {
        closeCalls += 1
        return Promise.resolve()
      },
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(closeCalls).toBe(1)
  })

  test("#given a pinned fresh open whose state carries no model #when the session opens #then it fails closed as unverified (#9722)", async () => {
    // given
    let closeCalls = 0
    const client = {
      open: () => Promise.resolve({ sessionId: "sess-1", attached: false, instanceId: "i-1", engineVersion: "v" }),
      getState: () => Promise.resolve({ sessionId: "sess-1" }),
      close: () => {
        closeCalls += 1
        return Promise.resolve()
      },
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(failure instanceof Error ? failure.message : "").toContain("unverified")
    expect(closeCalls).toBe(1)
  })

  test("#given a reattach that rejoins a live session #when the session opens #then no model re-assertion reaches the host (#9722)", async () => {
    // given
    let stateReads = 0
    const client = {
      open: () => Promise.resolve({ sessionId: "sess-1", attached: true, instanceId: "i-1", engineVersion: "v" }),
      getState: () => {
        stateReads += 1
        return Promise.resolve({ sessionId: "sess-1", model: { provider: "test", id: "other" } })
      },
    }

    // when
    const opened = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })

    // then
    expect(opened.attached).toBe(true)
    expect(stateReads).toBe(0)
  })
})

describe("openTaskHostSession failure classification", () => {
  test("#given open_session reaches the client deadline #when the session opens #then it raises the closed open_timed_out reason", async () => {
    // given
    const client = {
      open: () => Promise.reject(new Error("Timeout waiting for response to open_session. Stderr: secret")),
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure : undefined).toMatchObject({
      kind: "session_unavailable",
      reason: "open_timed_out",
    })
  })

  test("#given the host refuses open_session with a closed code #when the session opens #then that code is preserved", async () => {
    // given
    const client = {
      open: () => Promise.reject(
        new HostSessionOpenError("host_memory_pressure", "/tmp/session.jsonl", "private detail"),
      ),
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBe("host_memory_pressure")
  })

  test("#given the host returns an unknown code #when the session opens #then the reason is omitted", async () => {
    // given
    const client = {
      open: () => Promise.reject(
        new HostSessionOpenError("api_key_sk_private", "/tmp/session.jsonl", "private detail"),
      ),
    }

    // when
    const failure = await openTaskHostSession({ client, spec, sessionPath: "/tmp/session.jsonl" })
      .catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure) ? failure.failure.reason : undefined).toBeUndefined()
  })
})
