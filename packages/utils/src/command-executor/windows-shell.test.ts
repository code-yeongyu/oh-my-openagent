import { describe, expect, test } from "bun:test"

import { resolveWindowsCmdPath } from "./windows-shell"

describe("resolveWindowsCmdPath", () => {
  test("#given non-Windows platform #when resolving the cmd shell #then it returns null", () => {
    // given
    const fileExists = () => true

    // when
    const resolved = resolveWindowsCmdPath({ platform: "linux", fileExists })

    // then
    expect(resolved).toBeNull()
  })

  test("#given COMSPEC points at an existing file #when resolving the cmd shell #then it returns the COMSPEC value", () => {
    // given
    const comspec = "D:\\CustomShells\\my-cmd.exe"
    const fileExists = (path: string) => path === comspec

    // when
    const resolved = resolveWindowsCmdPath({
      platform: "win32",
      env: { COMSPEC: comspec, SystemRoot: "C:\\WINDOWS" },
      fileExists,
    })

    // then
    expect(resolved).toBe(comspec)
  })

  test("#given COMSPEC points at a missing file and SystemRoot is set #when resolving the cmd shell #then it returns SystemRoot System32 cmd.exe", () => {
    // given
    const fileExists = (path: string) => path === "C:\\WINDOWS\\System32\\cmd.exe"

    // when
    const resolved = resolveWindowsCmdPath({
      platform: "win32",
      env: { COMSPEC: "D:\\missing\\cmd.exe", SystemRoot: "C:\\WINDOWS" },
      fileExists,
    })

    // then
    expect(resolved).toBe("C:\\WINDOWS\\System32\\cmd.exe")
  })

  test("#given no COMSPEC and SystemRoot set #when resolving the cmd shell #then it returns SystemRoot System32 cmd.exe", () => {
    // given
    const fileExists = (path: string) => path === "C:\\WINDOWS\\System32\\cmd.exe"

    // when
    const resolved = resolveWindowsCmdPath({
      platform: "win32",
      env: { SystemRoot: "C:\\WINDOWS" },
      fileExists,
    })

    // then
    expect(resolved).toBe("C:\\WINDOWS\\System32\\cmd.exe")
  })

  test("#given only windir is set #when resolving the cmd shell #then it returns windir System32 cmd.exe", () => {
    // given
    const fileExists = (path: string) => path === "E:\\WinDir\\System32\\cmd.exe"

    // when
    const resolved = resolveWindowsCmdPath({
      platform: "win32",
      env: { windir: "E:\\WinDir" },
      fileExists,
    })

    // then
    expect(resolved).toBe("E:\\WinDir\\System32\\cmd.exe")
  })

  test("#given no environment roots but the default install path exists #when resolving the cmd shell #then it returns the default System32 cmd.exe", () => {
    // given
    const fileExists = (path: string) => path === "C:\\Windows\\System32\\cmd.exe"

    // when
    const resolved = resolveWindowsCmdPath({ platform: "win32", env: {}, fileExists })

    // then
    expect(resolved).toBe("C:\\Windows\\System32\\cmd.exe")
  })

  test("#given nothing can be resolved #when resolving the cmd shell #then it returns null so callers keep their fallback", () => {
    // given
    const fileExists = () => false

    // when
    const resolved = resolveWindowsCmdPath({
      platform: "win32",
      env: { COMSPEC: "D:\\missing\\cmd.exe" },
      fileExists,
    })

    // then
    expect(resolved).toBeNull()
  })
})
