// Error contract (omo#13503): when the temporary directory the trust stage falls back to sits under an unsafe ancestor
// (group- or world-writable without the sticky bit, or owned by another user), the stage refuses with the typed
// `trust-tmpdir-unsafe` refusal and one stderr line that names the first unsafe directory, what is wrong with it, and
// what to do, instead of dying with an uncaught error and a stack trace. A private ancestor reaches the next stage.
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runTrustStage } from "../trust-stage"
import { unsafeAncestorProblem } from "../trust-generation"
import { usePrivateTmpdir } from "./trust-private-tmpdir"

usePrivateTmpdir()

let root = ""
let savedTmpdir: string | undefined

beforeAll(async () => {
  savedTmpdir = process.env.TMPDIR
  root = await realpath(await mkdtemp(join(tmpdir(), "omo-trust-tmpdir-")))
  await chmod(root, 0o700)
})
afterEach(() => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = savedTmpdir
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function layout(name: string, sharedMode: number) {
  const shared = join(root, name)
  const home = join(shared, "u")
  const temporary = join(home, "tmp")
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  await chmod(shared, sharedMode)
  await chmod(home, 0o700)
  return { shared, home, temporary }
}

async function stage(home: string, temporary: string, directory = join(home, ".omo", "engine-trust")) {
  process.env.TMPDIR = temporary
  const stderr: string[] = []
  const acquire = mock(async () => ({ certificates: [], fallbackReason: null, codes: [] }))
  const result = await runTrustStage({
    args: ["remote", "--help"],
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: temporary },
    platform: "linux",
    directory,
    executable: process.execPath,
    argv: [process.execPath],
    loadedExtra: () => [],
    acquire,
    exec: async () => {},
    stderr: (line) => stderr.push(line),
  })
  return { result, stderr: stderr.join(""), acquire }
}

test.skipIf(process.platform === "win32")(
  "#given TMPDIR under a group-writable directory #when the trust stage runs #then it refuses with a typed line naming that directory and no stack",
  async () => {
    // given
    const { shared, home, temporary } = await layout("group-writable", 0o775)

    // when
    const { result, stderr, acquire } = await stage(home, temporary)

    // then
    expect(result).toMatchObject({ action: "refuse", code: "trust-tmpdir-unsafe" })
    expect(acquire).not.toHaveBeenCalled()
    expect(stderr.split("\n").filter((line) => line !== "")).toEqual([
      `omo: trust-tmpdir-unsafe: ${shared} is group-writable; run chmod go-w ${shared}, or set TMPDIR to a private directory, and start omo again`,
    ])
  },
)

test.skipIf(process.platform === "win32")(
  "#given TMPDIR under a world-writable directory without the sticky bit #when the trust stage runs #then the line says world-writable",
  async () => {
    // given
    const { shared, home, temporary } = await layout("world-writable", 0o777)

    // when
    const { result, stderr } = await stage(home, temporary)

    // then
    expect(result).toMatchObject({ action: "refuse", code: "trust-tmpdir-unsafe" })
    expect(stderr.split("\n").filter((line) => line !== "")).toEqual([
      `omo: trust-tmpdir-unsafe: ${shared} is world-writable; run chmod go-w ${shared}, or set TMPDIR to a private directory, and start omo again`,
    ])
  },
)

test.skipIf(process.platform === "win32")(
  "#given a trust directory whose defaults cannot be created and TMPDIR under a group-writable ancestor #when the trust stage runs #then the closure fallback keeps the typed refusal and names that directory",
  async () => {
    // given: the requested directory is SAFE, so prepare() succeeds, but its `defaults` path is a regular file, so
    // generate()'s closure step fails and falls back to TMPDIR - which sits under a group-writable ancestor.
    const safe = join(root, "safe")
    const trust = join(safe, ".omo", "engine-trust")
    await mkdir(trust, { recursive: true, mode: 0o700 })
    for (const dir of [safe, join(safe, ".omo"), trust]) await chmod(dir, 0o700)
    await writeFile(join(trust, "defaults"), "")
    const { shared, home, temporary } = await layout("fallback", 0o775)

    // when
    const { result, stderr } = await stage(home, temporary, trust)

    // then: the fallback keeps trust-tmpdir-unsafe and its named directory instead of trust-path-unrepresentable.
    expect(result).toMatchObject({ action: "refuse", code: "trust-tmpdir-unsafe" })
    expect(stderr.split("\n").filter((line) => line !== "")).toEqual([
      `omo: trust-tmpdir-unsafe: ${shared} is group-writable; run chmod go-w ${shared}, or set TMPDIR to a private directory, and start omo again`,
    ])
  },
)

describe("the named problem of a refused ancestor", () => {
  test.each([
    [0o777, "world-writable"],
    [0o775, "group-writable"],
    // The bytes are writable but the sticky bit is what keeps them safe, so the refusal is the owner's and the
    // remedy must not be `chmod go-w` (which a non-owner cannot run and which would not be the problem).
    [0o1777, "owned by another user"],
    [0o1775, "owned by another user"],
    [0o755, "owned by another user"],
  ] as const)("#given mode %s #then the problem is %s", (mode, problem) => {
    expect(unsafeAncestorProblem(mode)).toBe(problem)
  })
})

test.skipIf(process.platform === "win32")(
  "#given TMPDIR under private directories #when the trust stage runs #then it does not refuse on the directory",
  async () => {
    // given
    const { home, temporary } = await layout("private", 0o700)

    // when
    const { result, stderr, acquire } = await stage(home, temporary)

    // then
    expect(result).not.toMatchObject({ action: "refuse", code: "trust-tmpdir-unsafe" })
    expect(stderr).toBe("")
    expect(acquire).toHaveBeenCalled()
  },
)
