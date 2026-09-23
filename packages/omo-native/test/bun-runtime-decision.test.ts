import { describe, expect, test } from "bun:test"
import { posix } from "node:path"
import { maybeReexecUnderBun, resolveBunReexec } from "../bin/lib/bun-runtime.js"

const POSIX_HOME = "/home/dev"

/** Injected everywhere so no assertion touches the host filesystem; see bun-runtime.test.ts. */
const identityRealpath = (path: string): string => path

function existsOnly(...present: string[]): (path: string) => boolean {
  const set = new Set(present)
  return (path) => set.has(path)
}

function bunTreePackage(bunRoot: string): string {
  return [bunRoot, "install", "global", "node_modules", "omo-ai", "bin", "omo.js"].join("/")
}

describe("bun runtime re-exec decision", () => {
  describe("#given the re-exec decision table", () => {
    const bunPath = posix.join(POSIX_HOME, ".bun", "bin", "bun")
    const treeScript = bunTreePackage(posix.join(POSIX_HOME, ".bun"))
    const plainScript = "/usr/local/lib/node_modules/omo-ai/bin/omo.js"

    function decide(overrides: {
      scriptPath?: string
      env?: Record<string, string | undefined>
      versions?: Record<string, string | undefined>
      exists?: (path: string) => boolean
      bunVersion?: (bunPath: string) => Promise<string | undefined>
    } = {}) {
      return resolveBunReexec({
        scriptPath: overrides.scriptPath ?? plainScript,
        env: overrides.env ?? {},
        versions: overrides.versions ?? {},
        homedir: () => POSIX_HOME,
        platform: "linux",
        exists: overrides.exists ?? existsOnly(bunPath),
        realpath: identityRealpath,
        bunVersion: overrides.bunVersion ?? (async () => "1.4.0"),
      })
    }

    describe("#when the process already runs on bun", () => {
      test("#then it stays, so a re-exec can never loop", async () => {
        // given / when
        const decision = await decide({ versions: { bun: "1.4.0" }, env: { OMO_RUNTIME: "bun" } })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when OMO_RUNTIME pins node", () => {
      test("#then it stays although a current bun is installed", async () => {
        // given / when
        const decision = await decide({ env: { OMO_RUNTIME: "node" } })
        // then
        expect(decision).toEqual({ reexec: false })
      })

      test("#then it stays even inside the bun global tree", async () => {
        // given / when
        const decision = await decide({ scriptPath: treeScript, env: { OMO_RUNTIME: "node" } })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when no bun binary exists anywhere", () => {
      test("#then it stays on node without probing anything", async () => {
        // given
        let probed = 0
        // when
        const decision = await decide({
          exists: () => false,
          bunVersion: async () => {
            probed += 1
            return "1.4.0"
          },
        })
        // then
        expect(decision).toEqual({ reexec: false })
        expect(probed).toBe(0)
      })
    })

    describe("#when a bun binary is reachable from any install", () => {
      test("#then an npm global install re-execs under a bun that meets the floor", async () => {
        // given / when
        const decision = await decide({ scriptPath: plainScript })
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
      })

      test("#then the probe is asked about the binary that was discovered", async () => {
        // given
        const asked: string[] = []
        // when
        const decision = await decide({
          bunVersion: async (path) => {
            asked.push(path)
            return "1.4.0"
          },
        })
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
        expect(asked).toEqual([bunPath])
      })

      test("#then a bun older than the floor leaves the process on node", async () => {
        // given / when
        const decision = await decide({ bunVersion: async () => "1.3.9" })
        // then
        expect(decision).toEqual({ reexec: false })
      })

      test("#then a bun that cannot report its version leaves the process on node", async () => {
        // given / when
        const decision = await decide({ bunVersion: async () => undefined })
        // then
        expect(decision).toEqual({ reexec: false })
      })

      test("#then a PATH-only bun is enough", async () => {
        // given
        const onPath = "/usr/local/bin/bun"
        // when
        const decision = await decide({ env: { PATH: "/usr/local/bin" }, exists: existsOnly(onPath) })
        // then
        expect(decision).toEqual({ reexec: true, bunPath: onPath })
      })
    })

    describe("#when OMO_RUNTIME asks for bun", () => {
      test("#then it re-execs without consulting the version floor", async () => {
        // given
        let probed = 0
        // when
        const decision = await decide({
          env: { OMO_RUNTIME: "bun" },
          bunVersion: async () => {
            probed += 1
            return "1.3.9"
          },
        })
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
        expect(probed).toBe(0)
      })

      test("#then a missing bun binary leaves the process on node", async () => {
        // given / when
        const decision = await decide({ env: { OMO_RUNTIME: "bun" }, exists: () => false })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })

    describe("#when the script is installed in the bun global tree", () => {
      test("#then it re-execs under the bun that installed it without a probe", async () => {
        // given
        let probed = 0
        // when
        const decision = await decide({
          scriptPath: treeScript,
          bunVersion: async () => {
            probed += 1
            return undefined
          },
        })
        // then
        expect(decision).toEqual({ reexec: true, bunPath })
        expect(probed).toBe(0)
      })

      test("#then a relocated BUN_INSTALL tree is honored", async () => {
        // given
        const relocated = "/opt/bunroot"
        const relocatedBun = posix.join(relocated, "bin", "bun")
        // when
        const decision = await decide({
          scriptPath: bunTreePackage(relocated),
          env: { BUN_INSTALL: relocated },
          exists: existsOnly(relocatedBun),
        })
        // then
        expect(decision).toEqual({ reexec: true, bunPath: relocatedBun })
      })

      test("#then a tree without any bun binary stays on node", async () => {
        // given / when
        const decision = await decide({ scriptPath: treeScript, exists: () => false })
        // then
        expect(decision).toEqual({ reexec: false })
      })
    })
  })

  describe("#given the executing re-exec entry point", () => {
    const bunPath = posix.join(POSIX_HOME, ".bun", "bin", "bun")
    const treeScript = bunTreePackage(posix.join(POSIX_HOME, ".bun"))

    test("replaces the POSIX launcher with exact argv[0] and environment", async () => {
      // given
      const env = { OMO_RUNTIME: "bun", PRESERVED: "fixture-value" }
      const execs: unknown[][] = []
      const spawns: unknown[][] = []
      const propagated: unknown[] = []
      // when
      const consumed = await maybeReexecUnderBun({
        scriptPath: treeScript, argv: ["node", treeScript, "say", "hi"],
        env, versions: {}, homedir: () => POSIX_HOME, platform: "linux",
        exists: existsOnly(bunPath), realpath: identityRealpath,
        execve: (...args: unknown[]) => { execs.push(args) },
        spawn: (...args: unknown[]) => { spawns.push(args); return { status: 37, signal: null } },
        propagate: (result: unknown) => { propagated.push(result) },
      })
      // then
      expect(consumed).toBe(true)
      expect(execs.map(([file, argv]) => [file, argv])).toEqual([[bunPath, [bunPath, treeScript, "say", "hi"]]])
      // input.env controls runtime discovery; the existing runChild path inherits process.env.
      expect(execs[0]?.[2] === process.env).toBe(true)
      expect(spawns).toEqual([])
      expect(propagated).toEqual([])
    })

    for (const mode of ["throw", "absent", "win32"] as const) {
      test(`keeps async fallback arguments, environment and exit status for ${mode}`, async () => {
        // given
        const env = { OMO_RUNTIME: "bun", PRESERVED: "fallback-value", BUN_INSTALL: POSIX_HOME }
        const calls: unknown[][] = []
        const propagated: unknown[] = []
        let execs = 0
        // when
        const consumed = await maybeReexecUnderBun({
          scriptPath: treeScript, argv: ["node", treeScript, "say", "hi"],
          env, versions: {}, homedir: () => POSIX_HOME, platform: mode === "win32" ? "win32" : "linux",
          exists: () => true, realpath: identityRealpath,
          execve: mode === "absent" ? null : () => { execs += 1; throw new Error("injected unavailable") },
          spawn: (...args: unknown[]) => { calls.push(args); return { status: 37, signal: null } },
          propagate: (result: unknown) => { propagated.push(result) },
        })
        // then
        expect(consumed).toBe(true)
        expect(execs).toBe(mode === "throw" ? 1 : 0)
        expect(calls).toHaveLength(1)
        expect(calls[0]?.[1]).toEqual([treeScript, "say", "hi"])
        expect(calls[0]?.[2]).toEqual({ stdio: "inherit", windowsHide: true })
        expect(propagated).toEqual([{ status: 37, signal: null }])
      })
    }

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
        execve: null,
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
