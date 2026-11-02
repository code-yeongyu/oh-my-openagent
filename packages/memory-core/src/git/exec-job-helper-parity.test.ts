import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { buildIdentityPaths } from "../identity"
import { GitAbortedError, GitNotFoundError, GitTimeoutError } from "./errors"
import { createNodeGitExec, type GitExecOptions, type GitExecResult } from "./exec"
import {
  ParkServer,
  environmentWith,
  forwardSlashes,
  gitOpEntries,
  identityRepo,
  jobHelperPath,
  requireJobHelperWhenDemanded,
  runsJobHelperRows,
  writeHook,
} from "./job-helper-fixtures.test-support"
import { settlesWithin } from "./settles-within.test-support"

requireJobHelperWhenDemanded()

// Row T12 (design v4.2 section 16): the helper path keeps today's exec contract. Each case runs the same command
// through the helper and through today's direct spawn and compares what a caller sees.
const roots: string[] = []
const parks: ParkServer[] = []
afterEach(async () => {
  for (const park of parks.splice(0)) await park.close()
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

const viaHelper = (lingerMs?: number) => createNodeGitExec({ jobHelper: { path: jobHelperPath(), ...(lingerMs === undefined ? {} : { lingerMs }) } })
const direct = () => createNodeGitExec()

async function both(argv: readonly string[], options: GitExecOptions): Promise<readonly [GitExecResult, GitExecResult]> {
  return [await viaHelper().run(argv, options), await direct().run(argv, options)]
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

async function repo(agentId: string) {
  const fixture = await identityRepo("job-helper-t12-", agentId)
  roots.push(fixture.root)
  return fixture
}

describe.skipIf(!runsJobHelperRows)("T12: exec parity through the helper (design v4.2 section 16)", () => {
  test("#given arguments with spaces, quotes, trailing backslashes, an empty one and non-BMP text #when git echoes them back #then the helper's argv is byte-identical to a direct spawn", async () => {
    const { paths } = await repo("t12-argv")
    const argv = ["rev-parse", "--sq-quote", "plain", "two words", "q\"uote", "trail\\", "trail space\\", "", "tab\there", "\u{1F600} non-bmp", "back\\\\\"slash"]
    const [helper, plain] = await both(argv, { cwd: paths.repo, timeoutMs: 30_000 })
    expect({ code: helper.code, stdout: helper.stdout }).toEqual({ code: 0, stdout: plain.stdout })
    expect(helper.stdout).toContain("'two words'")
  }, 60_000)

  test("#given stdin larger than a pipe buffer and raw cat-file --batch output #when both paths run #then the bytes are identical", async () => {
    const { paths } = await repo("t12-bytes")
    const large = Buffer.alloc(1 << 20, "memory\n")
    const [helperHash, plainHash] = await both(["hash-object", "--stdin"], { cwd: paths.repo, timeoutMs: 30_000, stdin: large })
    expect({ code: helperHash.code, stdout: helperHash.stdout }).toEqual({ code: 0, stdout: plainHash.stdout })

    const binary = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256))
    const written = await viaHelper().run(["hash-object", "-w", "--stdin"], { cwd: paths.repo, timeoutMs: 30_000, stdin: binary })
    const [helperBatch, plainBatch] = await both(["cat-file", "--batch"], { cwd: paths.repo, timeoutMs: 30_000, stdin: `${written.stdout.trim()}\n` })
    expect(helperBatch.stdoutBytes?.equals(plainBatch.stdoutBytes ?? Buffer.alloc(0))).toBe(true)
    expect(helperBatch.stdoutBytes?.includes(binary)).toBe(true)
  }, 60_000)

  test("#given a repo directory that does not exist #when a command runs #then it resolves 128 with today's text and leaves no entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-helper-t12-cwd-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "t12-missing-cwd")
    await mkdir(paths.locks, { recursive: true })
    const [helper, plain] = await both(["status"], { cwd: paths.repo, timeoutMs: 30_000 })
    expect({ code: helper.code, stderr: helper.stderr }).toEqual({ code: 128, stderr: plain.stderr })
    expect(await gitOpEntries(paths.locks)).toEqual([])
  }, 60_000)

  test("#given no git on PATH nor in the install fallbacks #when a command runs #then both paths reject GitNotFoundError with an ENOENT cause", async () => {
    const { root, paths } = await repo("t12-no-git")
    const empty = join(root, "empty")
    await mkdir(empty)
    const env = environmentWith({ PATH: empty, ProgramFiles: empty, ProgramW6432: empty, "ProgramFiles(x86)": empty, LOCALAPPDATA: empty })
    for (const exec of [viaHelper(), direct()]) {
      const error = await captureError(exec.run(["status"], { cwd: paths.repo, timeoutMs: 30_000, env }))
      expect(error).toBeInstanceOf(GitNotFoundError)
      expect(((error as GitNotFoundError).cause as NodeJS.ErrnoException | undefined)?.code).toBe("ENOENT")
    }
    expect(await gitOpEntries(paths.locks)).toEqual([])
  }, 60_000)

  test("#given a commit parked in its commit-msg hook #when the timeout elapses or the signal aborts #then the helper path rejects GitTimeoutError and GitAbortedError", async () => {
    const { paths, hooks } = await repo("t12-stop")
    const park = await ParkServer.start()
    parks.push(park)
    await writeHook(hooks, "commit-msg", `"$OMO_TEST_BUN" "$OMO_TEST_PARK" "$OMO_TEST_ROLE"`)
    const argv = ["-c", `core.hooksPath=${forwardSlashes(hooks)}`, "commit", "--allow-empty", "-m", "t12"]
    const env = (role: string) => environmentWith({ ...park.hookEnvironment(), OMO_TEST_ROLE: role })

    const timedOut = await captureError(viaHelper(2_000).run(argv, { cwd: paths.repo, timeoutMs: 3_000, env: env("timeout") }))
    expect(timedOut).toBeInstanceOf(GitTimeoutError)

    const controller = new AbortController()
    const parked = park.waitFor("abort", 60_000)
    const aborted = captureError(viaHelper(2_000).run(argv, { cwd: paths.repo, timeoutMs: 60_000, env: env("abort"), signal: controller.signal }))
    await parked
    controller.abort()
    expect(await aborted).toBeInstanceOf(GitAbortedError)
  }, 120_000)

  test("#given a post-commit hook whose background child holds git's stdout #when the commit finishes #then the result settles after the bounded drain", async () => {
    const { paths, hooks } = await repo("t12-drain")
    const park = await ParkServer.start()
    parks.push(park)
    await writeHook(hooks, "post-commit", `"$OMO_TEST_BUN" "$OMO_TEST_PARK" holder &\nexit 0`)
    const outcome = viaHelper(30_000).run(["-c", `core.hooksPath=${forwardSlashes(hooks)}`, "commit", "--allow-empty", "-m", "drain"], {
      cwd: paths.repo,
      timeoutMs: 60_000,
      exitDrainMs: 500,
      env: environmentWith(park.hookEnvironment()),
    })
    await park.waitFor("holder", 60_000)
    const settled = await settlesWithin(outcome, 20_000)
    park.release("holder")
    expect(settled.kind).toBe("settled")
    if (settled.kind === "settled") expect(settled.value.code).toBe(0)
  }, 120_000)
})
