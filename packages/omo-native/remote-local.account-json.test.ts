import { describe, expect, test } from "bun:test"

import { REMOTE_EXIT } from "./remote-exit"
import { accountNotice, type RemoteCommandDependencies } from "./remote-local"

function deps(accountShow: () => Promise<{ readonly exitCode: number; readonly stdout: string }>): {
  readonly dependencies: RemoteCommandDependencies
  readonly stdout: string[]
  readonly stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    dependencies: {
      accountShow,
      stateDir: "/unused",
      connect: () => Promise.reject(new Error("unused")),
      now: () => 0,
      output: (line) => stdout.push(line),
      write: () => {},
      error: (line) => stderr.push(line),
    },
  }
}

describe("accountNotice under --json (#15181)", () => {
  test("#given a signed-out account #when a --json verb hits the precondition #then stdout carries the parseable refusal and the exit stays unavailable", async () => {
    const { dependencies, stdout, stderr } = deps(() =>
      Promise.resolve({ exitCode: 1, stdout: JSON.stringify({ signedIn: false }) }),
    )

    const exit = await accountNotice(dependencies, true)

    expect(exit).toBe(REMOTE_EXIT.unavailable)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0])).toEqual({
      kind: "error",
      code: "host_unavailable",
      message: "Sign in to OmO first: run omo login (or sign in from the OmO desktop app).",
      next_action: "sign this device in to OmO, then retry",
      details: { reason: "signed_out" },
    })
  })

  test("#given a signed-out account #when a human verb hits the precondition #then the human notice stays on stderr", async () => {
    const { dependencies, stdout, stderr } = deps(() =>
      Promise.resolve({ exitCode: 1, stdout: JSON.stringify({ signedIn: false }) }),
    )

    const exit = await accountNotice(dependencies)

    expect(exit).toBe(REMOTE_EXIT.unavailable)
    expect(stdout).toEqual([])
    expect(stderr).toEqual(["Sign in to OmO first: run omo login (or sign in from the OmO desktop app)."])
  })

  test("#given a locked keychain #when a --json verb hits the precondition #then details.reason names the account-state kind", async () => {
    const { dependencies, stdout } = deps(() =>
      Promise.resolve({ exitCode: 7, stdout: JSON.stringify({ keychain: "locked" }) }),
    )

    expect(await accountNotice(dependencies, true)).toBe(REMOTE_EXIT.unavailable)
    expect(JSON.parse(stdout[0]).details).toEqual({ reason: "keychain_locked" })
  })

  test("#given a signed-in account #when the precondition runs #then nothing is printed", async () => {
    const { dependencies, stdout, stderr } = deps(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({ signedIn: true, device: { id: "d1", name: "dev" } }),
      }),
    )

    expect(await accountNotice(dependencies, true)).toBeUndefined()
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
  })
})
