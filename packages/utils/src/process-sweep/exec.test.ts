import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDefaultProcessKiller, enumerateProcesses, resolveWindowsSystemBinary } from "./exec"

interface SystemRootRestore {
  readonly name: "SystemRoot" | "windir"
  readonly previous: string | undefined
}

function pointSystemRootAt(root: string): SystemRootRestore[] {
  const restores: SystemRootRestore[] = []
  for (const name of ["SystemRoot", "windir"] as const) {
    restores.push({ name, previous: process.env[name] })
    process.env[name] = root
  }
  return restores
}

function restoreSystemRoot(restores: SystemRootRestore[]): void {
  for (const { name, previous } of restores) {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/**
 * Builds a fake %SystemRoot% whose System32 carries executable stand-ins for
 * the two sweep launchers. The stand-ins are POSIX shell scripts, so the
 * end-to-end tests driving them are skipped on win32 (see each test).
 */
function makeFakeSystemRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-sweep-systemroot-"))
  mkdirSync(join(root, "System32", "WindowsPowerShell", "v1.0"), { recursive: true })
  writeExecutable(
    join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "#!/bin/sh\nprintf '%s' '[{\"ProcessId\":4242,\"ParentProcessId\":1,\"CommandLine\":\"node lsp-daemon-proxy.js mcp\"}]'\n",
  )
  const taskkillLog = join(root, "taskkill-args.log")
  writeExecutable(
    join(root, "System32", "taskkill.exe"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${taskkillLog}"\n`,
  )
  return root
}

describe("windows sweep launcher resolution", () => {
  describe("resolveWindowsSystemBinary", () => {
    test("#given SystemRoot with the binary under System32 #when resolving #then the absolute path wins over the bare name", () => {
      // given
      const absolute = join("C:\\WINDOWS", "System32", "taskkill.exe")
      const env = { SystemRoot: "C:\\WINDOWS" } as NodeJS.ProcessEnv
      const fileExists = (candidate: string) => candidate === absolute

      // when
      const resolved = resolveWindowsSystemBinary("taskkill.exe", ["taskkill.exe"], { env, fileExists })

      // then
      expect(resolved).toBe(absolute)
    })

    test("#given only windir set #when resolving #then the windir tree is used", () => {
      // given
      const env = { windir: "D:\\Win" } as NodeJS.ProcessEnv
      const fileExists = (candidate: string) =>
        candidate === join("D:\\Win", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")

      // when
      const resolved = resolveWindowsSystemBinary(
        "powershell.exe",
        ["WindowsPowerShell", "v1.0", "powershell.exe"],
        { env, fileExists },
      )

      // then
      expect(resolved).toBe(join("D:\\Win", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))
    })

    test("#given the SystemRoot candidate missing on disk #when resolving #then the bare name is kept as the PATH fallback", () => {
      // given
      const env = { SystemRoot: "C:\\WINDOWS" } as NodeJS.ProcessEnv

      // when
      const resolved = resolveWindowsSystemBinary("taskkill.exe", ["taskkill.exe"], {
        env,
        fileExists: () => false,
      })

      // then
      expect(resolved).toBe("taskkill.exe")
    })

    test("#given neither SystemRoot nor windir #when resolving #then the bare name is kept", () => {
      // given
      const env = {} as NodeJS.ProcessEnv

      // when
      const resolved = resolveWindowsSystemBinary(
        "powershell.exe",
        ["WindowsPowerShell", "v1.0", "powershell.exe"],
        { env, fileExists: () => true },
      )

      // then
      expect(resolved).toBe("powershell.exe")
    })
  })

  // The end-to-end tests below execute POSIX shell stand-ins for the Windows
  // launchers, which the win32 loader cannot run; the resolution logic itself
  // is covered platform-agnostically by resolveWindowsSystemBinary above.
  const unixOnly = test.skipIf(process.platform === "win32")

  unixOnly("#given a fake SystemRoot powershell tree #when enumerating win32 processes #then rows come from the resolved absolute binary", async () => {
    // given
    const root = makeFakeSystemRoot()
    const restores = pointSystemRootAt(root)
    try {
      // when
      const processes = await enumerateProcesses("win32")

      // then
      expect(processes).toEqual([
        { command: "node lsp-daemon-proxy.js mcp", pid: 4242, ppid: 1 },
      ])
    } finally {
      restoreSystemRoot(restores)
      rmSync(root, { force: true, recursive: true })
    }
  })

  unixOnly("#given a fake SystemRoot taskkill tree #when the win32 killer terminates and kills #then the absolute taskkill runs with the expected arguments", async () => {
    // given
    const root = makeFakeSystemRoot()
    const restores = pointSystemRootAt(root)
    try {
      // when
      const killer = createDefaultProcessKiller("win32")
      await killer.terminate(4242)
      await killer.kill(4243)

      // then
      expect(readFileSync(join(root, "taskkill-args.log"), "utf8").split("\n").filter((line) => line.length > 0)).toEqual([
        "/PID 4242 /T",
        "/PID 4243 /T /F",
      ])
    } finally {
      restoreSystemRoot(restores)
      rmSync(root, { force: true, recursive: true })
    }
  })

  unixOnly("#given no SystemRoot and no powershell on PATH #when enumerating win32 processes #then the rejection names the attempted launcher", async () => {
    // given
    const restores: SystemRootRestore[] = []
    for (const name of ["SystemRoot", "windir"] as const) {
      restores.push({ name, previous: process.env[name] })
      delete process.env[name]
    }
    try {
      // when
      const failure = await enumerateProcesses("win32").catch((error: unknown) => error)

      // then
      const launcherFailure = failure as Error & { readonly cause?: unknown }
      expect(launcherFailure).toBeInstanceOf(Error)
      expect(launcherFailure.message).toContain('"powershell.exe"')
      expect((launcherFailure.cause as Error & { readonly code?: string }).code).toBe("ENOENT")
    } finally {
      restoreSystemRoot(restores)
    }
  })
})
