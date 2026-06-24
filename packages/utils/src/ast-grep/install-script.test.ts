/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  AST_GREP_BIN_DIR_ENV_KEY,
  astGrepRuntimeDir,
  runAstGrepSkillInstall,
  type AstGrepInstallSpawn,
  type AstGrepInstallSpawnOutcome,
} from "./install-script"

describe("runAstGrepSkillInstall", () => {
  test("#given install.sh exists #when provisioning runs #then OMO_AST_GREP_BIN_DIR targets the runtime slug", async () => {
    // given
    const invocations: Array<{ readonly command: string; readonly binDir: string | undefined }> = []
    const targetDir = astGrepRuntimeDir("/home/test/.omo", "darwin", "arm64")
    const spawnProcess: AstGrepInstallSpawn = (command, _args, options) => {
      invocations.push({ command, binDir: options.env[AST_GREP_BIN_DIR_ENV_KEY] })
      return { kill: () => undefined, outcome: Promise.resolve({ kind: "exit", code: 0, signal: null }) }
    }

    // when
    const result = await runAstGrepSkillInstall({
      fileExists: (filePath) => filePath.endsWith("install.sh"),
      platform: "darwin",
      skillDir: "/skills/ast-grep",
      spawnProcess,
      targetDir,
    })

    // then
    expect(result.kind).toBe("succeeded")
    expect(invocations).toEqual([{ command: "bash", binDir: targetDir }])
    expect(targetDir).toBe(join("/home/test/.omo", "runtime", "ast-grep", "darwin-arm64"))
  })

  test("#given install script exits one #when provisioning runs #then the failure is returned without throwing", async () => {
    // given
    const spawnProcess: AstGrepInstallSpawn = () => ({
      kill: () => undefined,
      outcome: Promise.resolve({ kind: "exit", code: 1, signal: null }),
    })

    // when
    const result = await runAstGrepSkillInstall({
      fileExists: (filePath) => filePath.endsWith("install.sh"),
      platform: "linux",
      skillDir: "/skills/ast-grep",
      spawnProcess,
      targetDir: "/home/test/.omo/runtime/ast-grep/linux-x64",
    })

    // then
    expect(result.kind).toBe("failed")
  })

  test("#given install script hangs #when timeout elapses #then the child is killed and timeout is returned", async () => {
    // given
    let kills = 0
    let finish: ((outcome: AstGrepInstallSpawnOutcome) => void) | undefined
    const spawnProcess: AstGrepInstallSpawn = () => ({
      kill: () => {
        kills += 1
        finish?.({ kind: "exit", code: null, signal: "SIGTERM" })
      },
      outcome: new Promise<AstGrepInstallSpawnOutcome>((resolve) => {
        finish = resolve
      }),
    })

    // when
    const result = await runAstGrepSkillInstall({
      fileExists: (filePath) => filePath.endsWith("install.sh"),
      platform: "linux",
      skillDir: "/skills/ast-grep",
      spawnProcess,
      targetDir: "/home/test/.omo/runtime/ast-grep/linux-x64",
      timeoutMs: 1,
    })

    // then
    expect(result.kind).toBe("timed-out")
    expect(kills).toBe(1)
  })

  test("#given Windows and pwsh is missing #when provisioning runs #then powershell.exe is tried next", async () => {
    // given
    const commands: string[] = []
    const spawnProcess: AstGrepInstallSpawn = (command) => {
      commands.push(command)
      if (command === "pwsh") {
        return {
          kill: () => undefined,
          outcome: Promise.resolve({ kind: "spawn-error", error: new Error("missing pwsh"), missingExecutable: true }),
        }
      }
      return { kill: () => undefined, outcome: Promise.resolve({ kind: "exit", code: 0, signal: null }) }
    }

    // when
    const result = await runAstGrepSkillInstall({
      fileExists: (filePath) => filePath.endsWith("install.ps1"),
      platform: "win32",
      skillDir: "C:\\skills\\ast-grep",
      spawnProcess,
      targetDir: "C:\\Users\\test\\.codex\\runtime\\ast-grep\\win32-x64",
    })

    // then
    expect(result.kind).toBe("succeeded")
    expect(commands).toEqual(["pwsh", "powershell.exe"])
  })
})
