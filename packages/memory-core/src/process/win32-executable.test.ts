import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { resolveWin32Executable, resolveWin32Git } from "./win32-executable"

// The win32 executable resolver is the security boundary of #12146: every bare-name spawn the memory
// engine makes on Windows goes through it, so the executable can only come from a fully qualified
// PATH directory or the Git for Windows install roots, never from a working directory. These rows
// run on every OS with an injected file check; the Windows-only file proves the same rules against
// the real filesystem and against Bun.which.

interface Filesystem {
  readonly probed: string[]
  readonly isFile: (path: string) => boolean
}

function filesystem(files: readonly string[]): Filesystem {
  const present = new Set(files.map((file) => file.toLowerCase()))
  const probed: string[] = []
  return {
    probed,
    isFile: (path) => {
      probed.push(path)
      return present.has(path.toLowerCase())
    },
  }
}

interface ResolutionRow {
  readonly name: string
  readonly path: string
  readonly files: readonly string[]
  readonly expected: string | undefined
}

const PATH_ROWS: readonly ResolutionRow[] = [
  { name: "an .exe in a later directory beats a .com in an earlier one", path: "C:\\a;C:\\b", files: ["C:\\a\\git.com", "C:\\b\\git.exe"], expected: "C:\\b\\git.exe" },
  { name: ".cmd is tried before .bat inside one directory", path: "C:\\a", files: ["C:\\a\\git.bat", "C:\\a\\git.cmd"], expected: "C:\\a\\git.cmd" },
  { name: "an earlier directory's .cmd beats a later directory's .exe", path: "C:\\a;C:\\b", files: ["C:\\a\\git.cmd", "C:\\b\\git.exe"], expected: "C:\\a\\git.cmd" },
  { name: ".com is found in its own last pass", path: "C:\\a;C:\\b", files: ["C:\\b\\git.com"], expected: "C:\\b\\git.com" },
  { name: "double- and single-quoted entries are unquoted", path: "\"C:\\Program Files\\Git\\cmd\";'D:\\tools'", files: ["D:\\tools\\git.exe"], expected: "D:\\tools\\git.exe" },
  { name: "a quoted entry keeps its semicolon", path: "\"C:\\odd;dir\";C:\\b", files: ["C:\\odd;dir\\git.exe", "C:\\b\\git.exe"], expected: "C:\\odd;dir\\git.exe" },
  { name: "empty entries are ignored", path: ";;C:\\a;", files: ["C:\\a\\git.exe"], expected: "C:\\a\\git.exe" },
  { name: "a UNC entry is fully qualified", path: "\\\\server\\share\\git\\cmd", files: ["\\\\server\\share\\git\\cmd\\git.exe"], expected: "\\\\server\\share\\git\\cmd\\git.exe" },
  { name: "a trailing separator and forward slashes are normalized", path: "C:\\a\\;D:/b", files: ["D:\\b\\git.exe"], expected: "D:\\b\\git.exe" },
  { name: "no git anywhere on PATH resolves nothing", path: "C:\\a;C:\\b", files: ["C:\\a\\gitk.exe"], expected: undefined },
]

const NOT_FULLY_QUALIFIED = [".", "bin", "..\\tools", "C:bin", "\\Git\\cmd", "/usr/bin", "\\\\?\\C:\\device", "\\\\.\\C:\\device"] as const

describe("resolveWin32Executable", () => {
  for (const row of PATH_ROWS) {
    test(`#given PATH ${JSON.stringify(row.path)} #when git is resolved #then ${row.name}`, () => {
      const fs = filesystem(row.files)

      expect(resolveWin32Executable("git", { PATH: row.path }, fs.isFile)).toBe(row.expected)
    })
  }

  test("#given entries that are not fully qualified #when git is resolved #then none of them is searched", () => {
    const relativeHits = NOT_FULLY_QUALIFIED.flatMap((entry) => [`${entry}\\git.exe`, `${entry}\\git.cmd`, `${entry}\\git.com`])
    const fs = filesystem([...relativeHits, "git.exe", "C:\\real\\git.exe"])

    const resolved = resolveWin32Executable("git", { PATH: [...NOT_FULLY_QUALIFIED, "C:\\real"].join(";") }, fs.isFile)

    expect(resolved).toBe("C:\\real\\git.exe")
    expect(fs.probed.every((path) => /^(?:[A-Za-z]:\\|\\\\[^\\?.])/.test(path))).toBe(true)
  })

  test("#given a name that spells its extension #when it is resolved #then only that spelling is tried, with no .com pass", () => {
    const fs = filesystem(["C:\\a\\git.exe.com", "C:\\b\\git.exe"])

    expect(resolveWin32Executable("git.exe", { PATH: "C:\\a;C:\\b" }, fs.isFile)).toBe("C:\\b\\git.exe")
    expect(fs.probed).toEqual(["C:\\a\\git.exe", "C:\\b\\git.exe"])
  })

  test("#given a name with a directory component #when it is resolved #then only that exact fully qualified file counts", () => {
    const fs = filesystem(["C:\\tools\\git.exe", "tools\\git.exe"])

    expect(resolveWin32Executable("C:\\tools\\git.exe", { PATH: "C:\\other" }, fs.isFile)).toBe("C:\\tools\\git.exe")
    expect(resolveWin32Executable("tools\\git.exe", { PATH: "C:\\other" }, fs.isFile)).toBeUndefined()
    expect(fs.probed).toEqual(["C:\\tools\\git.exe"])
  })

  test("#given NoDefaultCurrentDirectoryInExePath set or unset #when git is resolved #then the result is the same", () => {
    const fs = filesystem(["C:\\a\\git.exe"])
    const environment = { PATH: ".;C:\\a" }

    const without = resolveWin32Executable("git", environment, fs.isFile)
    const withVariable = resolveWin32Executable("git", { ...environment, NoDefaultCurrentDirectoryInExePath: "1" }, fs.isFile)

    expect(without).toBe("C:\\a\\git.exe")
    expect(withVariable).toBe(without)
  })

  test("#given the PATH key spelled Path #when git is resolved #then the key is matched case-insensitively", () => {
    const fs = filesystem(["C:\\a\\git.exe"])

    expect(resolveWin32Executable("git", { Path: "C:\\a" }, fs.isFile)).toBe("C:\\a\\git.exe")
  })
})

describe("resolveWin32Git", () => {
  let stderr: ReturnType<typeof spyOn> | undefined
  afterEach(() => {
    stderr?.mockRestore()
    stderr = undefined
  })

  test("#given git on PATH and in Program Files #when git is resolved #then PATH keeps precedence", () => {
    const fs = filesystem(["C:\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\cmd\\git.exe"])

    expect(resolveWin32Git({ PATH: "C:\\Git\\cmd", ProgramFiles: "C:\\Program Files" }, fs.isFile)).toBe("C:\\Git\\cmd\\git.exe")
  })

  test("#given no git on PATH #when the install roots are tried #then only drive-qualified roots are probed, once each, in order", () => {
    const fs = filesystem([])

    const resolved = resolveWin32Git({
      PATH: "C:\\Windows\\System32",
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "c:\\PROGRAM FILES",
      "ProgramFiles(x86)": "\\\\server\\share",
      LOCALAPPDATA: "\\\\?\\D:\\Local",
    }, fs.isFile)

    expect(resolved).toBeUndefined()
    expect(fs.probed.filter((path) => !path.startsWith("C:\\Windows\\System32"))).toEqual(["C:\\Program Files\\Git\\cmd\\git.exe"])
  })

  test("#given no git on PATH and a per-user install #when git is resolved #then the first existing install root wins", () => {
    const fs = filesystem(["F:\\User Data\\Programs\\Git\\cmd\\git.exe", "E:\\Program Files (x86)\\Git\\cmd\\git.exe"])

    expect(resolveWin32Git({
      PATH: "",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "E:\\Program Files (x86)",
      LOCALAPPDATA: "F:\\User Data",
    }, fs.isFile)).toBe("E:\\Program Files (x86)\\Git\\cmd\\git.exe")
  })

  test("#given a relative PATH entry #when git is resolved twice #then the skip is reported once on stderr", () => {
    const written: string[] = []
    stderr = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    })
    const entry = `relative-${crypto.randomUUID()}`
    const fs = filesystem(["C:\\a\\git.exe"])

    resolveWin32Git({ PATH: `${entry};C:\\a` }, fs.isFile)
    resolveWin32Git({ PATH: `${entry};C:\\a` }, fs.isFile)

    expect(written.filter((line) => line.includes(entry))).toHaveLength(1)
  })
})
