import { describe, test, expect, mock } from "bun:test"
import { waitForSessionReady } from "./session-ready-waiter"

// Regression for #3839: oh-my-openagent@4.0.0 read `statusResult.data` only,
// but some OpenCode SDK/server versions return the status map at the top level
// (no `.data` wrapper). With the original code, the parsed map was always
// empty, `waitForSessionReady` timed out, and tmux panes were never spawned.
describe("waitForSessionReady – #3839 SDK response shape", () => {
  test("#given SDK returns wrapped { data: {...} } #when polled #then session is detected as ready", async () => {
    const sessionId = "ses_wrapped"
    const status = mock(async (_args: unknown) => ({
      data: { [sessionId]: { type: "busy" } },
    }))
    const client = { session: { status } } as never

    const ready = await waitForSessionReady({ client, sessionId })

    expect(ready).toBe(true)
    expect(status).toHaveBeenCalled()
  })

  test("#given SDK returns raw map (no .data wrapper) #when polled #then session is still detected as ready", async () => {
    const sessionId = "ses_raw"
    const status = mock(async (_args: unknown) => ({
      [sessionId]: { type: "busy" },
    }))
    const client = { session: { status } } as never

    const ready = await waitForSessionReady({ client, sessionId })

    expect(ready).toBe(true)
  })

  test("#given SDK raw map omits the session #when polled #then nothing falsely reads from undefined", async () => {
    const sessionId = "ses_absent"
    const status = mock(async (_args: unknown) => ({
      ses_other: { type: "busy" },
    }))
    const client = { session: { status } } as never

    // Should NOT throw a TypeError on `undefined.type` access — proves the
    // fallback expression is safely parsed by parseSessionStatusMap.
    let threw: unknown
    const racingTimeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 100)
    })
    const result = await Promise.race([
      waitForSessionReady({ client, sessionId }).catch((err) => {
        threw = err
        return false
      }),
      racingTimeout,
    ])

    expect(threw).toBeUndefined()
    expect(result).toBe(false)
  })
})
