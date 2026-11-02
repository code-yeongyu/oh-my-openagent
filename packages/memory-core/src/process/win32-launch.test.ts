import { describe, expect, test } from "bun:test"

import { spawnTarget } from "./win32-launch"
import { win32SystemExecutable } from "./win32-system-tools"

const ENVIRONMENT = { SystemRoot: "C:\\Windows" }

describe("spawnTarget", () => {
  test("#given the bare name (POSIX) #when the target is built #then the spawn is unchanged", () => {
    expect(spawnTarget("git", "git", ["status", "a b"], ENVIRONMENT)).toEqual({ file: "git", args: ["status", "a b"] })
  })

  test("#given a resolved .exe #when the target is built #then the absolute path is spawned and the child still sees the bare name as argv[0]", () => {
    expect(spawnTarget("C:\\Git\\cmd\\git.exe", "git", ["status"], ENVIRONMENT)).toEqual({
      file: "C:\\Git\\cmd\\git.exe",
      args: ["status"],
      argv0: "git",
    })
  })

  for (const wrapper of ["C:\\Git Wrappers\\git.cmd", "C:\\Git Wrappers\\GIT.BAT", "C:\\Git Wrappers\\git.cmd.", "C:\\Git Wrappers\\git.bat "]) {
    test(`#given a batch wrapper ${JSON.stringify(wrapper)} #when the target is built #then cmd.exe runs the absolute wrapper explicitly`, () => {
      expect(spawnTarget(wrapper, "git", ["commit", "-m", "memory write", "", "C:\\dir\\"], ENVIRONMENT)).toEqual({
        file: "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/s", "/c", `""${wrapper}" "commit" "-m" "memory write" "" "C:\\dir\\\\""`],
        windowsVerbatimArguments: true,
      })
    })
  }

  for (const metacharacter of ["\"", "%", "&", "|", "<", ">", "^", "\r", "\n"]) {
    test(`#given a batch wrapper and an argument holding ${JSON.stringify(metacharacter)} #when the target is built #then it is refused like Bun refuses it`, () => {
      expect(() => spawnTarget("C:\\Git\\cmd\\git.cmd", "git", ["log", `--format=x${metacharacter}y`], ENVIRONMENT)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" }),
      )
    })
  }

  test("#given a batch wrapper whose own path holds a cmd.exe metacharacter #when the target is built #then it is refused", () => {
    expect(() => spawnTarget("C:\\R&D\\git.cmd", "git", ["status"], ENVIRONMENT)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    )
  })

  test("#given a resolved .exe and metacharacter arguments #when the target is built #then nothing is refused", () => {
    expect(spawnTarget("C:\\Git\\cmd\\git.exe", "git", ["log", "--format=%H"], ENVIRONMENT).args).toEqual(["log", "--format=%H"])
  })
})

describe("win32SystemExecutable", () => {
  test("#given SystemRoot #when system tools are located #then each is an absolute System32 path", () => {
    const environment = { SystemRoot: "D:\\Win" }

    expect(win32SystemExecutable("reg.exe", environment)).toBe("D:\\Win\\System32\\reg.exe")
    expect(win32SystemExecutable("taskkill.exe", environment)).toBe("D:\\Win\\System32\\taskkill.exe")
    expect(win32SystemExecutable("cmd.exe", environment)).toBe("D:\\Win\\System32\\cmd.exe")
    expect(win32SystemExecutable("powershell.exe", environment)).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
  })

  test("#given only windir, spelled in any case #when a system tool is located #then windir is used", () => {
    expect(win32SystemExecutable("reg.exe", { WINDIR: "E:\\Windows" })).toBe("E:\\Windows\\System32\\reg.exe")
  })

  test("#given no usable Windows directory variable #when a system tool is located #then the default Windows directory is used, never a relative path", () => {
    expect(win32SystemExecutable("reg.exe", {})).toBe("C:\\Windows\\System32\\reg.exe")
    expect(win32SystemExecutable("reg.exe", { SystemRoot: "Windows", windir: "\\Windows" })).toBe("C:\\Windows\\System32\\reg.exe")
  })
})
