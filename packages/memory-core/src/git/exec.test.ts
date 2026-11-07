import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { GitNotFoundError, GitTimeoutError } from "./errors"
import {
  createNodeGitExec,
  type GitExecResult,
  type NodeGitExecRuntime,
} from "./exec"

type CommandRunner = NonNullable<NodeGitExecRuntime["runCommand"]>

const SUCCESS: GitExecResult = {
  code: 0,
  stdout: "git version test\n",
  stderr: "",
}

const PATH_GIT = "C:\\Git\\cmd\\git.exe"
const PROGRAM_FILES_GIT = "C:\\Program Files\\Git\\cmd\\git.exe"
const SECOND_ROOT_GIT = "D:\\Program Files\\Git\\cmd\\git.exe"

function spawnError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn failed: ${code}`), { code })
}

function missingGitError(): GitNotFoundError {
  return new GitNotFoundError({ cause: spawnError("ENOENT") })
}

function execOptions(environment: NodeJS.ProcessEnv, cwd = process.cwd()) {
  return { cwd, timeoutMs: 5000, env: { PATH: "C:\\Windows\\System32", ...environment } }
}

function files(...present: string[]) {
  const set = new Set(present)
  const probed: string[] = []
  return {
    set,
    probed,
    isFile: (path: string) => {
      probed.push(path)
      return set.has(path)
    },
  }
}

function createHermeticExec(runCommand: CommandRunner, isFile: (path: string) => boolean, platform: NodeJS.Platform = "win32") {
  return createNodeGitExec({ platform, runCommand, isFile })
}

describe("createNodeGitExec on win32", () => {
  test("#given git on PATH and under Program Files #when git runs #then the runner receives the absolute PATH git", async () => {
    const attempts: string[] = []
    const fs = files(PATH_GIT, PROGRAM_FILES_GIT)
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      return SUCCESS
    }, fs.isFile)

    const result = await exec.run(["--version"], execOptions({ PATH: "C:\\Git\\cmd", ProgramFiles: "C:\\Program Files" }))

    expect(result).toBe(SUCCESS)
    expect(attempts).toEqual([PATH_GIT])
  })

  test("#given git resolved from an install root #when git runs #then the absolute spawn carries the fsmonitor override ahead of the caller argv", async () => {
    const argvs: Array<readonly string[]> = []
    const exec = createHermeticExec(async (_executable, argv) => {
      argvs.push(argv)
      return SUCCESS
    }, files(PROGRAM_FILES_GIT).isFile)

    await exec.run(["-c", "user.name=fixture-writer", "status", "--porcelain"], execOptions({ ProgramFiles: "C:\\Program Files" }))

    expect(argvs).toEqual([["-c", "core.fsmonitor=false", "-c", "user.name=fixture-writer", "status", "--porcelain"]])
  })

  test("#given no git on PATH #when git runs #then the first existing install root is spawned by absolute path", async () => {
    const attempts: string[] = []
    const fs = files(SECOND_ROOT_GIT)
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      return SUCCESS
    }, fs.isFile)

    await exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files", ProgramW6432: "D:\\Program Files" }))

    expect(attempts).toEqual([SECOND_ROOT_GIT])
  })

  test("#given no git anywhere and an existing cwd #when git runs #then GitNotFoundError carries an ENOENT cause and nothing is spawned", async () => {
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      return SUCCESS
    }, files().isFile)

    const failure = await exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" })).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(GitNotFoundError)
    expect(failure).toMatchObject({ cause: { code: "ENOENT" } })
    expect(attempts).toEqual([])
  })

  test("#given no git anywhere and a missing cwd #when git runs #then it answers exit 128 like git itself", async () => {
    const exec = createHermeticExec(async () => SUCCESS, files().isFile)

    const result = await exec.run(["rev-parse", "HEAD"], execOptions({}, join(process.cwd(), `missing-${crypto.randomUUID()}`)))

    expect(result.code).toBe(128)
  })

  test("#given the resolved git disappears #when its spawn reports ENOENT #then it is re-resolved once and the new location runs", async () => {
    const attempts: string[] = []
    const fs = files(PROGRAM_FILES_GIT, SECOND_ROOT_GIT)
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      if (executable === PROGRAM_FILES_GIT) {
        fs.set.delete(PROGRAM_FILES_GIT)
        throw missingGitError()
      }
      return SUCCESS
    }, fs.isFile)

    const result = await exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files", ProgramW6432: "D:\\Program Files" }))

    expect(result).toBe(SUCCESS)
    expect(attempts).toEqual([PROGRAM_FILES_GIT, SECOND_ROOT_GIT])
  })

  test("#given the resolved git reports ENOENT but still resolves to the same file #when git runs #then the error propagates after one attempt", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw original
    }, files(PATH_GIT).isFile)

    await expect(exec.run(["--version"], execOptions({ PATH: "C:\\Git\\cmd" }))).rejects.toBe(original)
    expect(attempts).toEqual([PATH_GIT])
  })

  const propagated: ReadonlyArray<readonly [string, () => unknown]> = [
    ["GitNotFoundError caused by EACCES", () => new GitNotFoundError({ cause: spawnError("EACCES") })],
    ["GitNotFoundError caused by EPERM", () => new GitNotFoundError({ cause: spawnError("EPERM") })],
    ["a raw EIO spawn error", () => spawnError("EIO")],
    ["a timeout", () => new GitTimeoutError(["--version"], 5000)],
  ]
  for (const [label, makeFailure] of propagated) {
    test(`#given the resolved git fails with ${label} #when git runs #then it propagates without re-resolving`, async () => {
      const failure = makeFailure()
      const attempts: string[] = []
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        throw failure
      }, files(PROGRAM_FILES_GIT, SECOND_ROOT_GIT).isFile)

      await expect(exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files", ProgramW6432: "D:\\Program Files" }))).rejects.toBe(failure)
      expect(attempts).toEqual([PROGRAM_FILES_GIT])
    })
  }

  test("#given a nonzero git result #when git runs #then it is returned as is", async () => {
    const nonzero: GitExecResult = { code: 128, stdout: "", stderr: "fatal: command failed" }
    const exec = createHermeticExec(async () => nonzero, files(PATH_GIT).isFile)

    expect(await exec.run(["status"], execOptions({ PATH: "C:\\Git\\cmd" }))).toBe(nonzero)
  })

  test("#given stdin #when git runs by absolute path #then stdin reaches the runner", async () => {
    const inputs: Array<string | Buffer | undefined> = []
    const exec = createHermeticExec(async (_executable, _argv, options) => {
      inputs.push(options.stdin)
      return SUCCESS
    }, files(PROGRAM_FILES_GIT).isFile)

    await exec.run(["hash-object", "--stdin"], { ...execOptions({ ProgramFiles: "C:\\Program Files" }), stdin: "fallback-input" })

    expect(inputs).toEqual(["fallback-input"])
  })

  test("#given a resolved git #when the same environment runs git again #then the PATH-value cache answers without probing", async () => {
    const fs = files(PATH_GIT)
    const exec = createHermeticExec(async () => SUCCESS, fs.isFile)

    await exec.run(["--version"], execOptions({ PATH: "C:\\Git\\cmd" }))
    const probesAfterFirst = fs.probed.length
    await exec.run(["--version"], execOptions({ PATH: "C:\\Git\\cmd" }))

    expect(probesAfterFirst).toBeGreaterThan(0)
    expect(fs.probed.length).toBe(probesAfterFirst)
  })

  test("#given git is missing and then installed while omo runs #when git runs again #then the new install is found without a restart", async () => {
    const attempts: string[] = []
    const fs = files()
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      return SUCCESS
    }, fs.isFile)
    const options = execOptions({ PATH: "C:\\Git\\cmd" })

    await expect(exec.run(["--version"], options)).rejects.toBeInstanceOf(GitNotFoundError)
    fs.set.add(PATH_GIT)
    await exec.run(["--version"], options)

    expect(attempts).toEqual([PATH_GIT])
  })

  test("#given git only in a relative PATH entry #when git runs #then the entry is never searched", async () => {
    const fs = files("bin\\git.exe", ".\\git.exe")
    const exec = createHermeticExec(async () => SUCCESS, fs.isFile)

    await expect(exec.run(["--version"], execOptions({ PATH: `bin;.;relative-exec-${crypto.randomUUID()}` }))).rejects.toBeInstanceOf(GitNotFoundError)
    expect(fs.probed.filter((path) => !/^[A-Za-z]:\\/.test(path))).toEqual([])
  })
})

describe("createNodeGitExec on POSIX", () => {
  for (const platform of ["linux", "darwin"] as const) {
    test(`#given ${platform} with git available on a fully qualified PATH #when git runs #then the runner receives bare "git"`, async () => {
      const attempts: string[] = []
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        return SUCCESS
      }, files(PATH_GIT, PROGRAM_FILES_GIT).isFile, platform)

      await exec.run(["--version"], execOptions({ PATH: "C:\\Git\\cmd", ProgramFiles: "C:\\Program Files" }))

      expect(attempts).toEqual(["git"])
    })
  }

  test("#given linux and missing git #when git runs #then the error propagates with no Windows install root attempted", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw original
    }, files(PROGRAM_FILES_GIT).isFile, "linux")

    await expect(exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" }))).rejects.toBe(original)
    expect(attempts).toEqual(["git"])
  })
})
