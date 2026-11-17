// #14029: when the credential lock stays held for the whole wait, the account commands must name the holder and the
// one action that frees it. A bare lock timeout reached `omo login`/`whoami`/`logout` as "unexpected error".
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialLockPaths, withCredentialLock } from "./credential-lock"
import { SignInError } from "./protocol"

const API = "https://api.omo.dev"
const homes: string[] = []
const holders: Bun.Subprocess[] = []
afterEach(async () => {
  for (const holder of holders.splice(0)) {
    holder.kill("SIGKILL")
    await holder.exited
  }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function holdLock(
  argv0: string,
  heldForMs: number,
): { readonly home: string; readonly lock: string; readonly pid: number } {
  const home = mkdtempSync(join(tmpdir(), "credlock-held-"))
  homes.push(home)
  // argv0 names the holder the way `ps` reports it. A copied coreutils binary would not do: a multicall build (uutils)
  // dispatches on argv[0] and exits at once under any other name.
  const holder = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1_000_000)"], {
    argv0: join(home, argv0),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  holders.push(holder)
  const { directory, lock } = credentialLockPaths(API, home)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    lock,
    `cli-session ${crypto.randomUUID()}\n${holder.pid}\n${Date.now() - heldForMs}\n${crypto.randomUUID()}\nunavailable\n`,
  )
  return { home, lock, pid: holder.pid }
}

const refusal = (home: string): Promise<unknown> =>
  withCredentialLock(API, async () => "entered", home).then(
    (value) => value,
    (error: unknown) => error,
  )

describe("withCredentialLock when the lock stays held", () => {
  test("#given a keychain helper left holding the lock for two days, one still finishing, and another live process #when the wait runs out #then each refusal names the holder pid, the lock and the one action", async () => {
    const helper = holdLock("0123abcd-omo-keychain", 2 * 86_400_000)
    const finishing = holdLock("4567ef01-omo-keychain", 1_000)
    const other = holdLock("some-tool", 5_000)

    const [helperError, finishingError, otherError] = await Promise.all([
      refusal(helper.home),
      refusal(finishing.home),
      refusal(other.home),
    ])

    expect(finishingError).toBeInstanceOf(SignInError)
    const finishingMessage = (finishingError as SignInError).message
    expect(finishingMessage).toContain(`OmO keychain helper (pid ${finishing.pid})`)
    expect(finishingMessage).toContain("Try again in a minute")
    expect(finishingMessage).not.toContain("kill")

    expect(helperError).toBeInstanceOf(SignInError)
    const helperMessage = (helperError as SignInError).message
    expect(helperMessage).toContain(`OmO keychain helper (pid ${helper.pid})`)
    expect(helperMessage).toContain(helper.lock)
    expect(helperMessage).toContain("2 days")
    expect(helperMessage).toContain(`kill -9 ${helper.pid}`)

    expect(otherError).toBeInstanceOf(SignInError)
    const otherMessage = (otherError as SignInError).message
    expect(otherMessage).toContain(`pid ${other.pid}, some-tool`)
    expect(otherMessage).toContain(other.lock)
    expect(otherMessage).toContain(`kill ${other.pid}`)
    expect(otherMessage).not.toContain("kill -9")
  }, 40_000)
})
