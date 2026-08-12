import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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

function spawnError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn failed: ${code}`), { code })
}

function missingGitError(): GitNotFoundError {
  return new GitNotFoundError({ cause: spawnError("ENOENT") })
}

function execOptions(environment: NodeJS.ProcessEnv) {
  return {
    cwd: process.cwd(),
    timeoutMs: 5000,
    env: {
      PATH: "/nonexistent",
      ...environment,
    },
  }
}

function createHermeticExec(runCommand: CommandRunner, platform: NodeJS.Platform = "win32") {
  return createNodeGitExec({ platform, runCommand })
}

describe("createNodeGitExec", () => {
  describe("#given a spawn cwd that does not exist", () => {
    test("#when git runs #then it does NOT report git as missing from PATH", async () => {
      const missing = join(mkdtempSync(join(tmpdir(), "omo-git-exec-")), "no-such-dir")
      const exec = createNodeGitExec()
      const result = await exec.run(["rev-parse", "--verify", "HEAD"], { cwd: missing, timeoutMs: 5000 })
      expect(result.code).toBe(128)
      expect(result.stderr).toContain("No such file or directory")
    })

    test("#when the bare runner reports the missing-cwd result #then Windows fallbacks are not attempted", async () => {
      const attempts: string[] = []
      const missingCwdResult: GitExecResult = {
        code: 128,
        stdout: "",
        stderr: "fatal: cannot change directory",
      }
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        return missingCwdResult
      })

      const result = await exec.run(["status"], execOptions({ ProgramFiles: "C:\\Program Files" }))

      expect(result).toBe(missingCwdResult)
      expect(attempts).toEqual(["git"])
    })
  })

  describe("#given a cwd that exists but no git binary on PATH", () => {
    test("#when git runs #then GitNotFoundError fires", async () => {
      const dir = mkdtempSync(join(tmpdir(), "omo-git-exec-"))
      try {
        const exec = createNodeGitExec()
        await expect(
          exec.run(["--version"], { cwd: dir, timeoutMs: 5000, env: { PATH: "/nonexistent" } }),
        ).rejects.toBeInstanceOf(GitNotFoundError)
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      }
    })
  })

  test("#given Git resolves on PATH #when Windows roots exist #then bare Git keeps precedence", async () => {
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      return SUCCESS
    })

    const result = await exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" }))

    expect(result).toBe(SUCCESS)
    expect(attempts).toEqual(["git"])
  })

  test("#given a non-Windows platform and missing Git #when git runs #then Windows roots are not attempted", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw original
    }, "linux")

    await expect(
      exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" })),
    ).rejects.toBe(original)
    expect(attempts).toEqual(["git"])
  })

  for (const code of ["EACCES", "EPERM", "EIO"] as const) {
    test(`#given bare Git reports GitNotFoundError caused by ${code} #when Windows roots exist #then the error propagates without fallback`, async () => {
      const failure = new GitNotFoundError({ cause: spawnError(code) })
      const attempts: string[] = []
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        throw failure
      })

      await expect(
        exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" })),
      ).rejects.toBe(failure)
      expect(attempts).toEqual(["git"])
    })
  }

  test("#given UNC, device-prefix, and root-relative roots #when fallback runs #then only a drive-qualified local root is attempted", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      if (executable === "git") throw original
      return SUCCESS
    })

    const result = await exec.run(["--version"], execOptions({
      ProgramFiles: "\\\\server\\share",
      ProgramW6432: "\\\\?\\C:\\Program Files",
      "ProgramFiles(x86)": "\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\Example User\\AppData\\Local",
    }))

    expect(result).toBe(SUCCESS)
    expect(attempts).toEqual([
      "git",
      "C:\\Users\\Example User\\AppData\\Local\\Programs\\Git\\cmd\\git.exe",
    ])
  })

  test("#given distinct standard roots #when every executable is absent #then candidates are attempted in deterministic order", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw executable === "git" ? original : missingGitError()
    })

    await expect(exec.run(["--version"], execOptions({
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "D:\\Program Files",
      "ProgramFiles(x86)": "E:\\Program Files (x86)",
      LOCALAPPDATA: "F:\\User Data",
    }))).rejects.toBe(original)

    expect(attempts).toEqual([
      "git",
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "D:\\Program Files\\Git\\cmd\\git.exe",
      "E:\\Program Files (x86)\\Git\\cmd\\git.exe",
      "F:\\User Data\\Programs\\Git\\cmd\\git.exe",
    ])
  })

  test("#given duplicate standard roots #when fallback runs #then equivalent candidates are attempted once", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw executable === "git" ? original : missingGitError()
    })

    await expect(exec.run(["--version"], execOptions({
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "c:\\PROGRAM FILES",
      "ProgramFiles(x86)": "D:\\Program Files (x86)",
    }))).rejects.toBe(original)

    expect(attempts).toEqual([
      "git",
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "D:\\Program Files (x86)\\Git\\cmd\\git.exe",
    ])
  })

  test("#given the first fallback executable disappears #when its spawn yields ENOENT #then the next candidate is attempted", async () => {
    const original = missingGitError()
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      if (executable === "git") throw original
      if (executable.startsWith("C:")) throw missingGitError()
      return SUCCESS
    })

    const result = await exec.run(["--version"], execOptions({
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "D:\\Program Files",
    }))

    expect(result).toBe(SUCCESS)
    expect(attempts).toEqual([
      "git",
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "D:\\Program Files\\Git\\cmd\\git.exe",
    ])
  })

  for (const code of ["EACCES", "EPERM", "EIO"] as const) {
    test(`#given a fallback reports GitNotFoundError caused by ${code} #when fallback runs #then the error propagates without trying later candidates`, async () => {
      const original = missingGitError()
      const failure = new GitNotFoundError({ cause: spawnError(code) })
      const attempts: string[] = []
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        if (executable === "git") throw original
        throw failure
      })

      await expect(exec.run(["--version"], execOptions({
        ProgramFiles: "C:\\Program Files",
        ProgramW6432: "D:\\Program Files",
      }))).rejects.toBe(failure)
      expect(attempts).toEqual(["git", "C:\\Program Files\\Git\\cmd\\git.exe"])
    })
  }

  for (const code of ["EACCES", "EPERM", "EIO"] as const) {
    test(`#given a fallback spawn ${code} #when fallback runs #then the error propagates without trying later candidates`, async () => {
      const original = missingGitError()
      const failure = spawnError(code)
      const attempts: string[] = []
      const exec = createHermeticExec(async (executable) => {
        attempts.push(executable)
        if (executable === "git") throw original
        throw failure
      })

      await expect(exec.run(["--version"], execOptions({
        ProgramFiles: "C:\\Program Files",
        ProgramW6432: "D:\\Program Files",
      }))).rejects.toBe(failure)
      expect(attempts).toEqual(["git", "C:\\Program Files\\Git\\cmd\\git.exe"])
    })
  }

  test("#given a fallback timeout #when fallback runs #then the timeout propagates without trying later candidates", async () => {
    const original = missingGitError()
    const timeout = new GitTimeoutError(["--version"], 5000)
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      if (executable === "git") throw original
      throw timeout
    })

    await expect(exec.run(["--version"], execOptions({
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "D:\\Program Files",
    }))).rejects.toBe(timeout)
    expect(attempts).toEqual(["git", "C:\\Program Files\\Git\\cmd\\git.exe"])
  })

  test("#given a fallback nonzero result #when fallback runs #then the result returns without trying later candidates", async () => {
    const original = missingGitError()
    const nonzero: GitExecResult = { code: 128, stdout: "", stderr: "fatal: command failed" }
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      if (executable === "git") throw original
      return nonzero
    })

    const result = await exec.run(["status"], execOptions({
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "D:\\Program Files",
    }))

    expect(result).toBe(nonzero)
    expect(attempts).toEqual(["git", "C:\\Program Files\\Git\\cmd\\git.exe"])
  })

  test("#given stdin #when real Git runs #then bytes are piped and existing argv handling is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-git-exec-"))
    try {
      const exec = createNodeGitExec()
      const content = Buffer.from("stdin-content\n")
      const path = join(dir, "content.txt")
      writeFileSync(path, content)
      const expected = await exec.run(["hash-object", "--", path], { cwd: dir, timeoutMs: 5000 })
      const result = await exec.run(["hash-object", "--stdin"], {
        cwd: dir,
        timeoutMs: 5000,
        stdin: content,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toBe(expected.stdout)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  })

  test("#given stdin and a Windows fallback #when bare Git is absent #then stdin reaches the fallback runner", async () => {
    const original = missingGitError()
    const inputs: Array<string | Buffer | undefined> = []
    const exec = createHermeticExec(async (executable, _argv, options) => {
      inputs.push(options.stdin)
      if (executable === "git") throw original
      return SUCCESS
    })

    await exec.run(["hash-object", "--stdin"], {
      ...execOptions({ ProgramFiles: "C:\\Program Files" }),
      stdin: "fallback-input",
    })

    expect(inputs).toEqual(["fallback-input", "fallback-input"])
  })

  test("#given bare Git fails with a non-ENOENT error #when Windows roots exist #then the error propagates without fallback", async () => {
    const failure = spawnError("EACCES")
    const attempts: string[] = []
    const exec = createHermeticExec(async (executable) => {
      attempts.push(executable)
      throw failure
    })

    await expect(
      exec.run(["--version"], execOptions({ ProgramFiles: "C:\\Program Files" })),
    ).rejects.toBe(failure)
    expect(attempts).toEqual(["git"])
  })
})
