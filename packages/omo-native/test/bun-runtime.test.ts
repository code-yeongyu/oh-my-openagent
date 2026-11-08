import { describe, expect, test } from "bun:test"
import { posix, win32 } from "node:path"
import { findBunBinary, isUnderBunGlobalTree, probeBunVersion } from "../bin/lib/bun-runtime.js"

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

describe("bun runtime detection", () => {
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

  describe("#given a Windows PATH that only carries an npm-installed bun.cmd shim", () => {
    test("#then the shim is not a bun the launcher can run and lookup reports absence", () => {
      // given: npm's global prefix holds bun.cmd / bun (no bun.exe), and ~/.bun does not exist
      const npmPrefix = String.raw`C:\Users\dev\AppData\Roaming\npm`
      const found = findBunBinary({
        env: { Path: npmPrefix, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        homedir: () => WIN_HOME,
        platform: "win32",
        exists: existsOnly(win32.join(npmPrefix, "bun.CMD"), win32.join(npmPrefix, "bun.cmd"), win32.join(npmPrefix, "bun")),
        realpath: identityRealpath,
      })

      // then: a .cmd shim cannot be probed or re-exec'd without a shell (Node rejects it with
      // spawn EINVAL), so it must never be selected
      expect(found).toBeUndefined()
    })

    test("#then a real bun.exe next to the shim is still found", () => {
      const npmPrefix = String.raw`C:\Users\dev\AppData\Roaming\npm`
      const found = findBunBinary({
        env: { Path: npmPrefix, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        homedir: () => WIN_HOME,
        platform: "win32",
        exists: existsOnly(win32.join(npmPrefix, "bun.cmd"), win32.join(npmPrefix, "bun.exe")),
        realpath: identityRealpath,
      })
      expect(found).toBe(win32.join(npmPrefix, "bun.exe"))
    })
  })

  describe("#given a bun probe whose spawn throws synchronously", () => {
    test("#then the probe resolves undefined instead of rejecting", async () => {
      // given: Node throws spawn EINVAL synchronously for batch files spawned without a shell
      const execFile = () => {
        const error = new Error("spawn EINVAL") as NodeJS.ErrnoException
        error.code = "EINVAL"
        throw error
      }

      // when
      const version = await probeBunVersion(String.raw`C:\bun\bun.cmd`, { execFile: execFile as never })

      // then
      expect(version).toBeUndefined()
    })
  })
})
