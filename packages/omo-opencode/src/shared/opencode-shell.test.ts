import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  createOpenCodeShellTypeResolver,
  resolveOpenCodeShell,
  shellTypeForOpenCodeShell,
  type OpenCodeShellHost,
} from "./opencode-shell"

const SYSTEM32 = "C:\\Windows\\System32"
const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0"
const PWSH_7 = "C:\\Program Files\\PowerShell\\7"
const GIT_CMD = "C:\\Program Files\\Git\\cmd"
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"

function windowsHost(input: { pathDirs: string[]; files: string[]; env?: NodeJS.ProcessEnv }): OpenCodeShellHost {
  const files = new Set(input.files)
  return {
    platform: "win32",
    env: { Path: input.pathDirs.join(";"), ComSpec: `${SYSTEM32}\\cmd.exe`, PSModulePath: "set", ...input.env },
    isFile: (file) => files.has(file),
  }
}

function posixHost(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, files: string[]): OpenCodeShellHost {
  const set = new Set(files)
  return { platform, env, isFile: (file) => set.has(file) }
}

const cmdOnly = { pathDirs: [SYSTEM32], files: [path.win32.join(SYSTEM32, "cmd.exe")] }
const windowsPowerShell51 = {
  pathDirs: [SYSTEM32, WINDOWS_POWERSHELL],
  files: [path.win32.join(SYSTEM32, "cmd.exe"), path.win32.join(WINDOWS_POWERSHELL, "powershell.exe")],
}
const withPwsh7 = {
  pathDirs: [...windowsPowerShell51.pathDirs, PWSH_7],
  files: [...windowsPowerShell51.files, path.win32.join(PWSH_7, "pwsh.exe")],
}
const withGitBash = {
  pathDirs: [...windowsPowerShell51.pathDirs, GIT_CMD],
  files: [...windowsPowerShell51.files, path.win32.join(GIT_CMD, "git.exe"), GIT_BASH],
}

function typeFor(configShell: string | undefined, host: OpenCodeShellHost) {
  return shellTypeForOpenCodeShell(resolveOpenCodeShell(configShell, host), host)
}

describe("resolveOpenCodeShell on Windows", () => {
  test("#given only cmd.exe is available #when no shell is configured #then cmd runs and cmd syntax is used", () => {
    const host = windowsHost(cmdOnly)

    expect(resolveOpenCodeShell(undefined, host)).toBe(`${SYSTEM32}\\cmd.exe`)
    expect(typeFor(undefined, host)).toBe("cmd")
  })

  test("#given Windows PowerShell 5.1 with SHELL, MSYSTEM unset and ComSpec=cmd.exe #when no shell is configured #then PowerShell runs, not ComSpec (#9733)", () => {
    const host = windowsHost(windowsPowerShell51)

    expect(resolveOpenCodeShell(undefined, host)).toBe(path.win32.join(WINDOWS_POWERSHELL, "powershell.exe"))
    expect(typeFor(undefined, host)).toBe("powershell")
  })

  test("#given pwsh 7 beside Windows PowerShell #when no shell is configured #then pwsh is preferred", () => {
    const host = windowsHost(withPwsh7)

    expect(resolveOpenCodeShell(undefined, host)).toBe(path.win32.join(PWSH_7, "pwsh.exe"))
    expect(typeFor(undefined, host)).toBe("powershell")
  })

  test("#given Git Bash sets SHELL=/usr/bin/bash #when no shell is configured #then Git Bash runs and unix syntax is used", () => {
    const host = windowsHost({ ...withGitBash, env: { SHELL: "/usr/bin/bash", MSYSTEM: "MINGW64" } })

    expect(resolveOpenCodeShell(undefined, host)).toBe(GIT_BASH)
    expect(typeFor(undefined, host)).toBe("unix")
  })

  test("#given SHELL=/usr/bin/bash but no Git Bash installed #when resolving #then the unresolvable shell is skipped for PowerShell", () => {
    const host = windowsHost({ ...windowsPowerShell51, env: { SHELL: "/usr/bin/bash" } })

    expect(typeFor(undefined, host)).toBe("powershell")
  })

  test("#given MSYSTEM set without SHELL (a user workaround) #when resolving #then OpenCode still runs PowerShell, so the syntax does not flip", () => {
    const host = windowsHost({ ...windowsPowerShell51, env: { MSYSTEM: "1" } })

    expect(typeFor(undefined, host)).toBe("powershell")
  })

  test("#given a configured shell #when SHELL points elsewhere #then the configured shell wins", () => {
    const host = windowsHost({ ...withGitBash, env: { SHELL: "/usr/bin/bash" } })

    expect(typeFor("powershell", host)).toBe("powershell")
    expect(typeFor("cmd", host)).toBe("cmd")
    expect(typeFor("bash", host)).toBe("unix")
  })

  test("#given a configured shell that does not resolve #when resolving #then the Windows default order applies, not SHELL", () => {
    const host = windowsHost({
      ...withPwsh7,
      pathDirs: [...withPwsh7.pathDirs, GIT_CMD],
      files: [...withPwsh7.files, path.win32.join(GIT_CMD, "git.exe"), GIT_BASH],
      env: { SHELL: "/usr/bin/bash" },
    })

    expect(resolveOpenCodeShell(undefined, host)).toBe(GIT_BASH)
    expect(resolveOpenCodeShell("C:\\missing\\zsh.exe", host)).toBe(path.win32.join(PWSH_7, "pwsh.exe"))
  })

  test("#given OPENCODE_GIT_BASH_PATH #when bash is configured #then that Git Bash path is used", () => {
    const custom = "D:\\tools\\git\\bin\\bash.exe"
    const host = windowsHost({ ...windowsPowerShell51, files: [...windowsPowerShell51.files, custom], env: { OPENCODE_GIT_BASH_PATH: custom } })

    expect(resolveOpenCodeShell("bash", host)).toBe(custom)
  })
})

describe("unusable shell files", () => {
  for (const code of ["ENOTDIR", "EACCES", "EPERM"]) {
    test(`${code} in Windows PATH is skipped for a usable shell`, () => {
      const bad = "C:\\blocked"
      const host = windowsHost({ ...withPwsh7, pathDirs: [bad, ...withPwsh7.pathDirs] })
      const probe = host.isFile
      const throwingHost = {
        ...host,
        isFile(file: string) {
          if (file.startsWith(`${bad}\\`)) throw Object.assign(new Error(code), { code })
          return probe(file)
        },
      }

      expect(resolveOpenCodeShell(undefined, throwingHost)).toBe(path.win32.join(PWSH_7, "pwsh.exe"))
    })
  }

  test("an inaccessible rooted shell falls back to the platform default", () => {
    const host = posixHost("darwin", {}, [])
    expect(resolveOpenCodeShell("/blocked/bash", {
      ...host,
      isFile() { throw Object.assign(new Error("EACCES"), { code: "EACCES" }) },
    })).toBe("/bin/zsh")
  })

  test("an inaccessible derived Git Bash file falls back to cmd", () => {
    const host = windowsHost({ pathDirs: [GIT_CMD], files: [path.win32.join(GIT_CMD, "git.exe")] })
    const probe = host.isFile
    expect(resolveOpenCodeShell(undefined, {
      ...host,
      isFile(file) {
        if (file === GIT_BASH) throw Object.assign(new Error("EPERM"), { code: "EPERM" })
        return probe(file)
      },
    })).toBe(`${SYSTEM32}\\cmd.exe`)
  })
})

describe("resolveOpenCodeShell off Windows", () => {
  test("#given SHELL=/bin/tcsh #when resolving #then csh syntax is used", () => {
    const host = posixHost("linux", { SHELL: "/bin/tcsh", PATH: "/usr/bin" }, ["/bin/tcsh", "/usr/bin/bash"])

    expect(typeFor(undefined, host)).toBe("csh")
  })

  test("#given SHELL is fish or nu #when resolving #then OpenCode falls back to bash", () => {
    const files = ["/usr/bin/fish", "/usr/bin/nu", "/usr/bin/bash"]

    expect(resolveOpenCodeShell(undefined, posixHost("linux", { SHELL: "/usr/bin/fish", PATH: "/usr/bin" }, files))).toBe("/usr/bin/bash")
    expect(resolveOpenCodeShell(undefined, posixHost("linux", { SHELL: "/usr/bin/nu", PATH: "/usr/bin" }, files))).toBe("/usr/bin/bash")
  })

  test("#given macOS without SHELL but with PSModulePath #when resolving #then zsh runs and unix syntax is used", () => {
    const host = posixHost("darwin", { PSModulePath: "/usr/local/microsoft/powershell" }, [])

    expect(resolveOpenCodeShell(undefined, host)).toBe("/bin/zsh")
    expect(typeFor(undefined, host)).toBe("unix")
  })

  test("#given a configured pwsh on macOS #when resolving #then powershell syntax is used", () => {
    const host = posixHost("darwin", { SHELL: "/bin/zsh", PATH: "/opt/homebrew/bin" }, ["/bin/zsh", "/opt/homebrew/bin/pwsh"])

    expect(typeFor("pwsh", host)).toBe("powershell")
  })
})

describe("createOpenCodeShellTypeResolver", () => {
  test("#given a cached answer #when the configured shell changes #then the answer is recomputed", () => {
    const resolver = createOpenCodeShellTypeResolver(() => windowsHost(withGitBash))

    expect(resolver.resolveShellType()).toBe("powershell")
    resolver.setConfiguredShell("bash")
    expect(resolver.resolveShellType()).toBe("unix")
    resolver.setConfiguredShell(undefined)
    expect(resolver.resolveShellType()).toBe("powershell")
  })

  test("#given a non-string or blank shell key #when recorded #then it is ignored", () => {
    const resolver = createOpenCodeShellTypeResolver(() => windowsHost(cmdOnly))

    resolver.setConfiguredShell(42)
    expect(resolver.resolveShellType()).toBe("cmd")
    resolver.setConfiguredShell("   ")
    expect(resolver.resolveShellType()).toBe("cmd")
  })
})
