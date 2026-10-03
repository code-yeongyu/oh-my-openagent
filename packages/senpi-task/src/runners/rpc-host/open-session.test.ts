import { describe, expect, test } from "bun:test"

import { RunnerError } from "../in-process/runner-error"
import { HostSessionOpenError } from "./session-client"
import { openTaskHostSession } from "./open-session"

const spec = {
  task_id: "st_open",
  cwd: "/tmp/project",
  state_dir: "/tmp/state",
  prompt: "work",
  model: "test/model",
}

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
