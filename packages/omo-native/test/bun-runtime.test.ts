import { describe, expect, test } from "bun:test"
import { posix, win32 } from "node:path"
import {
  findBunBinary,
  isUnderBunGlobalTree,
  maybeReexecUnderBun,
  resolveBunReexec,
} from "../bin/lib/bun-runtime.js"

type Options = {
  env?: Record<string, string | undefined>
  homedir?: () => string
  platform?: string
  exists?: (path: string) => boolean
  realpath?: (path: string) => string
}

const POSIX_HOME = "/home/dev"
const WIN_HOME = String.raw`C:\Users\dev`

/**
 * Every case injects this so no assertion ever touches the host filesystem: the real realpathSync
 * would resolve nothing for these invented paths, and on a machine where one of them happened to
 * exist the result would change. Cases about symlink resolution inject their own mapping.
 */
const identityRealpath = (path: string): string => path

function existsOnly(...present: string[]): (path: string) => boolean {
  const set = new Set(present)
  return (path) => set.has(path)
}

function bunTreePackage(bunRoot: string, separator = "/"): string {
  return [bunRoot, "install", "global", "node_modules", "omo-ai", "bin", "omo.js"].join(separator)
}

describe("bun runtime re-exec", () => {
  describe("#given a script path and an injected home", () => {
    describe("#when the script sits inside the default bun global tree", () => {
      test("#then it is recognized as a bun global install", () => {
        // given
        const script = bunTreePackage(posix.join(POSIX_HOME, ".bun"))
        // when
        const under = isUnderBunGlobalTree(script, {
          env: {},
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: identityRealpath,
        })
        // then
        expect(under).toBe(true)
      })

      test("#then a symlinked bun root is resolved before comparing", () => {
        // The script path node hands over is already realpathed, so a BUN_INSTALL naming a symlink
        // (macOS /tmp -> /private/tmp, or a symlinked home) would otherwise never prefix-match the
        // very install it points at. Caught by real-surface QA, pinned here.
        const options: Options = {
          env: { BUN_INSTALL: "/tmp/bunroot" },
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: (path) => (path === "/tmp/bunroot" ? "/private/tmp/bunroot" : path),
        }
        // when / then
        expect(isUnderBunGlobalTree(bunTreePackage("/private/tmp/bunroot"), options)).toBe(true)
      })

      test("#then an unresolvable bun root falls back to its literal spelling", () => {
        // given
        const options: Options = {
          env: { BUN_INSTALL: "/opt/bunroot" },
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: () => {
            throw new Error("ENOENT")
          },
        }
        // when / then
        expect(isUnderBunGlobalTree(bunTreePackage("/opt/bunroot"), options)).toBe(true)
      })

      test("#then BUN_INSTALL relocates the tree that counts", () => {
        // given
        const relocated = "/opt/bunroot"
        const options: Options = {
          env: { BUN_INSTALL: relocated },
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: identityRealpath,
        }
        // when / then
        expect(isUnderBunGlobalTree(bunTreePackage(relocated), options)).toBe(true)
        expect(isUnderBunGlobalTree(bunTreePackage(posix.join(POSIX_HOME, ".bun")), options)).toBe(false)
      })

      test("#then redundant separators in BUN_INSTALL still match", () => {
        // BUN_INSTALL is user-supplied, and a TMPDIR ending in a slash yields values like
        // `/tmp//root`. A raw prefix comparison misses those, so the launcher would silently
        // refuse to re-exec a genuine bun install. Caught by real-surface QA, pinned here.
        const options: Options = {
          env: { BUN_INSTALL: "/var/tmp//bunroot" },
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: identityRealpath,
        }
        // when / then
        expect(isUnderBunGlobalTree(bunTreePackage("/var/tmp/bunroot"), options)).toBe(true)
      })

      test("#then a trailing separator in BUN_INSTALL still matches", () => {
        // given
        const options: Options = {
          env: { BUN_INSTALL: "/var/tmp/bunroot/" },
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: identityRealpath,
        }
        // when / then
        expect(isUnderBunGlobalTree(bunTreePackage("/var/tmp/bunroot"), options)).toBe(true)
      })

      test("#then a Windows backslash path still matches the tree", () => {
        // given
        const script = bunTreePackage(String.raw`C:\Users\dev\.bun`, "\\")
        // when
        const under = isUnderBunGlobalTree(script, {
          env: {},
          homedir: () => WIN_HOME,
          platform: "win32",
          realpath: identityRealpath,
        })
        // then
        expect(under).toBe(true)
      })
    })

    describe("#when the script sits in an npm global layout", () => {
      test("#then it is not a bun global install", () => {
        // given
        const script = "/usr/local/lib/node_modules/omo-ai/bin/omo.js"
        // when
        const under = isUnderBunGlobalTree(script, {
          env: {},
          homedir: () => POSIX_HOME,
          platform: "linux",
          realpath: identityRealpath,
        })
        // then
        expect(under).toBe(false)
      })
    })
  })

  describe("#given a bun binary lookup", () => {
    describe("#when BUN_INSTALL names an existing binary", () => {
      test("#then that binary wins over the home default", () => {
        // given
        const relocated = "/opt/bunroot"
        const preferred = posix.join(relocated, "bin", "bun")
        const fallback = posix.join(POSIX_HOME, ".bun", "bin", "bun")
        // when
        const found = findBunBinary({
          env: { BUN_INSTALL: relocated },
          homedir: () => POSIX_HOME,
          platform: "linux",
          exists: existsOnly(preferred, fallback),
        })
        // then
        expect(found).toBe(preferred)
      })
    })

    describe("#when only PATH holds a bun binary", () => {
      test("#then the PATH entry is used", () => {
        // given
        const onPath = "/usr/local/bin/bun"
        // when
        const found = findBunBinary({
          env: { PATH: `/nowhere:${"/usr/local/bin"}` },
          homedir: () => POSIX_HOME,
          platform: "linux",
          exists: existsOnly(onPath),
        })
        // then
        expect(found).toBe(onPath)
      })
    })

    describe("#when the host is Windows", () => {
      test("#then the .exe spelling is discovered", () => {
        // given
        const winBun = win32.join(WIN_HOME, ".bun", "bin", "bun.exe")
        // when
        const found = findBunBinary({
          env: {},
          homedir: () => WIN_HOME,
          platform: "win32",
          exists: existsOnly(winBun),
        })
        // then
        expect(found).toBe(winBun)
      })

      test("#then semicolon-delimited PATH entries are searched", () => {
        // given
        const onPath = win32.join("C:\\", "tools", "bun.EXE")
        // when
        const found = findBunBinary({
          env: { PATH: `C:\\nowhere;C:\\tools` },
          homedir: () => WIN_HOME,
          platform: "win32",
          exists: existsOnly(onPath),
        })
        // then
        expect(found).toBe(onPath)
      })
    })

    describe("#when no bun binary exists anywhere", () => {
      test("#then the lookup reports nothing instead of throwing", () => {
        // given
        const options: Options = {
          env: { PATH: "/usr/bin" },
          homedir: () => POSIX_HOME,
          platform: "linux",
          exists: () => false,
        }
        // when
        const found = findBunBinary(options)
        // then
        expect(found).toBeUndefined()
      })
    })
  })

  describe("#given the re-exec decision table", () => {
    const bunPath = posix.join(POSIX_HOME, ".bun", "bin", "bun")
    const treeScript = bunTreePackage(posix.join(POSIX_HOME, ".bun"))
    const plainScript = "/usr/local/lib/node_modules/omo-ai/bin/omo.js"

    function decide(overrides: {
      scriptPath?: string
      env?: Record<string, string | undefined>
      versions?: Record<string, string | undefined>
      exists?: (path: string) => boolean
    } = {}) {
      return resolveBunReexec({
        scriptPath: overrides.scriptPath ?? treeScript,
        env: overrides.env ?? {},
        versions: overrides.versions ?? {},
        homedir: () => POSIX_HOME,
        platform: "linux",
        exists: overrides.exists ?? existsOnly(bunPath),
        realpath: identityRealpath,
      })
    }

    describe("#when the process already runs on bun", () => {
      test("#then it stays, so a re-exec can never loop", () => {
        // given / when
        const decision = decide({ versions: { bun: "1.4.0" }, env: { OMO_RUNTIME: "bun" } })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when OMO_RUNTIME pins node", () => {
      test("#then it stays even inside the bun global tree", () => {
        // given / when
        const decision = decide({ env: { OMO_RUNTIME: "node" } })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when OMO_RUNTIME asks for bun", () => {
      test("#then it re-execs with the discovered binary even outside the tree", () => {
        // given / when
        const decision = decide({ scriptPath: plainScript, env: { OMO_RUNTIME: "bun" } })
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
      })

      test("#then a missing bun binary leaves the process on node", () => {
        // given / when
        const decision = decide({ scriptPath: plainScript, env: { OMO_RUNTIME: "bun" }, exists: () => false })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when the script is installed in the bun global tree", () => {
      test("#then it re-execs under bun", () => {
        // given / when
        const decision = decide()
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
      })

      test("#then a relocated BUN_INSTALL tree is honored", () => {
        // given
        const relocated = "/opt/bunroot"
        const relocatedBun = posix.join(relocated, "bin", "bun")
        // when
        const decision = decide({
          scriptPath: bunTreePackage(relocated),
          env: { BUN_INSTALL: relocated },
          exists: existsOnly(relocatedBun),
        })
        // then
        expect(decision).toEqual({ reexec: true, bunPath: relocatedBun })
      })

      test("#then a tree without any bun binary stays on node", () => {
        // given / when
        const decision = decide({ exists: () => false })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when the script came from an npm global install", () => {
      test("#then it stays on node although bun is installed", () => {
        // given / when
        const decision = decide({ scriptPath: plainScript })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })
  })

  describe("#given the executing re-exec entry point", () => {
    const bunPath = posix.join(POSIX_HOME, ".bun", "bin", "bun")
    const treeScript = bunTreePackage(posix.join(POSIX_HOME, ".bun"))

    test("#then the script and its arguments are handed to bun with inherited stdio", async () => {
      // given
      const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = []
      const propagated: Array<Record<string, unknown>> = []
      // when
      const consumed = await maybeReexecUnderBun({
        scriptPath: treeScript,
        argv: ["node", treeScript, "say", "hi"],
        env: {},
        versions: {},
        homedir: () => POSIX_HOME,
        platform: "linux",
        exists: existsOnly(bunPath),
        realpath: identityRealpath,
        spawn: (command: string, args: string[], options: Record<string, unknown>) => {
          calls.push({ command, args, options })
          return { status: 0, signal: null }
        },
        propagate: (result: Record<string, unknown>) => {
          propagated.push(result)
        },
      })
      // then
      expect(consumed).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.command).toBe(bunPath)
      expect(calls[0]?.args).toEqual([treeScript, "say", "hi"])
      expect(calls[0]?.options).toMatchObject({ stdio: "inherit", windowsHide: true })
      expect(propagated).toEqual([{ status: 0, signal: null }])
    })

    test("#then a stay decision spawns nothing and lets the caller continue", async () => {
      // given
      let spawned = 0
      // when
      const consumed = await maybeReexecUnderBun({
        scriptPath: treeScript,
        argv: ["node", treeScript, "say", "hi"],
        env: { OMO_RUNTIME: "node" },
        versions: {},
        homedir: () => POSIX_HOME,
        platform: "linux",
        exists: existsOnly(bunPath),
        realpath: identityRealpath,
        spawn: () => {
          spawned += 1
          return { status: 0, signal: null }
        },
        propagate: () => {},
      })
      // then
      expect(consumed).toBe(false)
      expect(spawned).toBe(0)
    })

    test("#then a bun process already running never re-execs itself", async () => {
      // given
      let spawned = 0
      // when
      const consumed = await maybeReexecUnderBun({
        scriptPath: treeScript,
        argv: ["bun", treeScript],
        env: {},
        versions: { bun: "1.4.0" },
        homedir: () => POSIX_HOME,
        platform: "linux",
        exists: existsOnly(bunPath),
        realpath: identityRealpath,
        spawn: () => {
          spawned += 1
          return { status: 0, signal: null }
        },
        propagate: () => {},
      })
      // then
      expect(consumed).toBe(false)
      expect(spawned).toBe(0)
    })
  })
})
