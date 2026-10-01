import { describe, expect, test } from "bun:test"
import { channelPackageSpec, detectNpmMajor, releaseChannel, updateTarget } from "../bin/lib/package-paths.js"

// updateTarget reads the version of the install it is pointed at and falls back to this package's own
// manifest, so the expected spelling follows the package channel (`omo-ai` stable, `omo-ai@beta` prerelease).
const SPEC = channelPackageSpec()
import {
  formatUpdateCommand,
  formatVersionChange,
  isPrintOnlyUpdate,
  runSelfUpdate,
} from "../bin/lib/self-update.js"

// These cases cover the spawn mechanics on the registry-unreachable path, which keeps the unpinned
// channel spec; the pinned path lives in self-update-pinned-target.test.ts.
const offline = { fetchDistTags: () => null }
function unconfirmedNotice(version: string): string {
  return `omo: could not confirm the ${releaseChannel(version)} omo-ai version from the npm registry; installing the unpinned ${channelPackageSpec(version)}`
}

function bunRoot(path: string): string {
  return path.replace(/\\/g, "/")
}

describe("updateTarget", () => {
  describe("#given a Bun global install layout", () => {
    test("#then the command is bun add -g and BUN_INSTALL is the prefix, not a --cwd into the package", () => {
      const root = bunRoot("/tmp/custom-bun/install/global/node_modules/omo-ai")
      expect(updateTarget(root)).toEqual({
        manager: "bun",
        command: `bun add -g ${SPEC}`,
        argv: ["bun", "add", "-g", SPEC],
        env: { BUN_INSTALL: "/tmp/custom-bun" },
      })
    })

    test("#then a Windows-style Bun path still yields bun add -g with BUN_INSTALL at the bun root", () => {
      const root = String.raw`C:\Users\omo user\.bun\install\global\node_modules\omo-ai`
      expect(updateTarget(root, "win32")).toEqual({
        manager: "bun",
        command: `bun add -g ${SPEC}`,
        argv: ["bun", "add", "-g", SPEC],
        env: { BUN_INSTALL: "C:/Users/omo user/.bun" },
      })
    })

    test("#then a path with shell metacharacters is carried in BUN_INSTALL, not quoted into the command", () => {
      const root = "/tmp/custom $HOME's bun/install/global/node_modules/omo-ai"
      const target = updateTarget(root)
      expect(target.command).toBe(`bun add -g ${SPEC}`)
      expect(target.env).toEqual({ BUN_INSTALL: "/tmp/custom $HOME's bun" })
    })
  })

  describe("#given an npm or unknown layout", () => {
    test("#then the command stays npm i -g with npm argv and no BUN_INSTALL overlay", () => {
      expect(updateTarget("/tmp/prefix/lib/node_modules/omo-ai")).toEqual({
        manager: "npm",
        command: `npm i -g ${SPEC}`,
        argv: ["npm", "i", "-g", SPEC],
      })
    })

    const NPM_ROOT = "/tmp/prefix/lib/node_modules/omo-ai"
    const ALLOW_SCRIPTS = "--allow-scripts=esbuild,@google/genai,protobufjs"
    const resolveNpm = (major: number | undefined) =>
      updateTarget(NPM_ROOT, "linux", undefined, undefined, undefined, undefined, major)

    test("#then npm 11 gets --allow-scripts after the package spec, in argv and in the printed command", () => {
      expect(resolveNpm(11)).toEqual({
        manager: "npm",
        command: `npm i -g ${SPEC} ${ALLOW_SCRIPTS}`,
        argv: ["npm", "i", "-g", SPEC, ALLOW_SCRIPTS],
      })
      expect(resolveNpm(12).argv).toEqual(["npm", "i", "-g", SPEC, ALLOW_SCRIPTS])
    })

    test("#then npm 10 and an unknown npm version never receive --allow-scripts", () => {
      expect(resolveNpm(10).argv).toEqual(["npm", "i", "-g", SPEC])
      expect(resolveNpm(undefined).argv).toEqual(["npm", "i", "-g", SPEC])
    })

    test("#then a pinned target keeps its exact spec ahead of the npm 11 flag", () => {
      const target = updateTarget(NPM_ROOT, "linux", undefined, undefined, undefined, "5.1.5", 11)
      expect(target.argv).toEqual(["npm", "i", "-g", "omo-ai@5.1.5", ALLOW_SCRIPTS])
    })

    test("#then a Bun layout ignores the npm version", () => {
      const root = bunRoot("/tmp/custom-bun/install/global/node_modules/omo-ai")
      expect(updateTarget(root, "linux", undefined, undefined, undefined, undefined, 11).argv).toEqual(["bun", "add", "-g", SPEC])
    })
  })
})

describe("detectNpmMajor", () => {
  const spawnOutput = (status: number | null, stdout: string) => () => ({ status, stdout }) as never
  test("#then it reads the major from npm --version output", () => {
    expect(detectNpmMajor(spawnOutput(0, "10.9.2\n"))).toBe(10)
    expect(detectNpmMajor(spawnOutput(0, "11.6.0\n"))).toBe(11)
  })
  test("#then a failed or unparsable npm yields undefined", () => {
    expect(detectNpmMajor(spawnOutput(1, ""))).toBeUndefined()
    expect(detectNpmMajor(spawnOutput(0, "garbage"))).toBeUndefined()
    expect(detectNpmMajor(() => { throw new Error("ENOENT") })).toBeUndefined()
  })
})

describe("omo self-update", () => {
  describe("#given a resolved update target", () => {
    const bunUpdate = {
      manager: "bun",
      command: `bun add -g ${SPEC}`,
      argv: ["bun", "add", "-g", SPEC],
      env: { BUN_INSTALL: "/tmp/custom-bun" },
    }
    const npmUpdate = {
      manager: "npm",
      command: `npm i -g ${SPEC}`,
      argv: ["npm", "i", "-g", SPEC],
    }

    describe("#when --dry-run or --print is requested", () => {
      for (const args of [["update", "--dry-run"], ["update", "--print"], ["update", "--self", "--dry-run"]]) {
        test(`#then ${args.join(" ")} prints the command and does not spawn`, async () => {
          const spawned: unknown[] = []
          const lines: string[] = []
          const code = await runSelfUpdate(args, {
            resolveUpdate: () => bunUpdate,
            ...offline,
            readInstalled: () => ({ omo: "5.0.0", engine: "2026.9.29" }),
            run: async (...call: unknown[]) => {
              spawned.push(call)
              return { status: 0, signal: null }
            },
            log: (line) => lines.push(line),
            error: (line) => lines.push(`err:${line}`),
          })
          expect(isPrintOnlyUpdate(args)).toBe(true)
          expect(code).toBe(0)
          expect(spawned).toEqual([])
          expect(lines).toEqual([unconfirmedNotice("5.0.0"), formatUpdateCommand(bunUpdate)])
        })
      }
    })

    describe("#when omo update runs", () => {
      test("#then it spawns the resolved argv, overlays BUN_INSTALL, and prints before/after versions", async () => {
        const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
        const lines: string[] = []
        let reads = 0
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => bunUpdate,
            ...offline,
          env: { PATH: "/usr/bin", BUN_INSTALL: "/wrong" },
          readInstalled: () => {
            reads += 1
            return reads === 1
              ? { omo: "5.0.0-0.beta.88", engine: "2026.9.1" }
              : { omo: "5.0.0-0.beta.89", engine: "2026.9.24" }
          },
          run: async (command, args, options = {}) => {
            spawned.push({ command, args, env: options.env ?? {} })
            return { status: 0, signal: null }
          },
          log: (line) => lines.push(line),
          error: (line) => lines.push(`err:${line}`),
        })
        expect(code).toBe(0)
        expect(spawned).toEqual([{
          command: "bun",
          args: ["add", "-g", SPEC],
          env: { PATH: "/usr/bin", BUN_INSTALL: "/tmp/custom-bun" },
        }])
        expect(lines).toEqual([
          unconfirmedNotice("5.0.0-0.beta.88"),
          `omo is updated via bun: bun add -g ${SPEC}`,
          "omo 5.0.0-0.beta.88 -> 5.0.0-0.beta.89 (engine: senpi 2026.9.24)",
        ])
        expect(formatVersionChange(
          { omo: "5.0.0-0.beta.88", engine: "2026.9.1" },
          { omo: "5.0.0-0.beta.89", engine: "2026.9.24" },
        )).toBe("omo 5.0.0-0.beta.88 -> 5.0.0-0.beta.89 (engine: senpi 2026.9.24)")
      })

      test("#then an npm-managed install spawns npm i -g without a BUN_INSTALL overlay", async () => {
        const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => npmUpdate,
            ...offline,
          env: { PATH: "/usr/bin" },
          readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
          run: async (command, args, options = {}) => {
            spawned.push({ command, args, env: options.env ?? {} })
            return { status: 0, signal: null }
          },
          log: () => {},
        })
        expect(code).toBe(0)
        expect(spawned).toEqual([{
          command: "npm",
          args: ["i", "-g", SPEC],
          env: { PATH: "/usr/bin" },
        }])
      })
    })

    describe("#when the package manager fails", () => {
      test("#then a non-zero status exits non-zero with the manual command and skips the version line", async () => {
        const lines: string[] = []
        const errors: string[] = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => bunUpdate,
            ...offline,
          readInstalled: () => ({ omo: "5.0.0-0.beta.88", engine: "x" }),
          run: async () => ({ status: 7, signal: null }),
          log: (line) => lines.push(line),
          error: (line) => errors.push(line),
        })
        expect(code).toBe(7)
        expect(lines).toEqual([unconfirmedNotice("5.0.0-0.beta.88"), `omo is updated via bun: bun add -g ${SPEC}`])
        expect(errors).toEqual([`omo: update failed; retry with: bun add -g ${SPEC}`])
      })

      test("#then a spawn error exits 1 with the same retry command", async () => {
        const errors: string[] = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => npmUpdate,
            ...offline,
          readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
          run: async () => {
            throw new Error("ENOENT")
          },
          log: () => {},
          error: (line) => errors.push(line),
        })
        expect(code).toBe(1)
        expect(errors).toEqual([`omo: update failed; retry with: npm i -g ${SPEC}`])
      })
    })
  })
})
