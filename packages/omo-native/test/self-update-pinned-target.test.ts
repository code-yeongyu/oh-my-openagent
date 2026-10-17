import { describe, expect, test } from "bun:test"
import { updateTarget } from "../bin/lib/package-paths.js"
import { runSelfUpdate } from "../bin/lib/self-update.js"

// #9198: omo update installs the exact version the channel dist-tag names and fails loudly when the
// package manager exits 0 without moving the installed version.

describe("updateTarget", () => {
  describe("#given a resolved target version", () => {
    const noLockfile = () => false

    test("#then a Bun global install pins omo-ai@<version> and keeps the BUN_INSTALL overlay", () => {
      const root = "/tmp/custom-bun/install/global/node_modules/omo-ai"
      expect(updateTarget(root, "linux", "5.1.1", "/home/u", noLockfile, "5.1.2")).toEqual({
        manager: "bun",
        command: "bun add -g omo-ai@5.1.2",
        argv: ["bun", "add", "-g", "omo-ai@5.1.2"],
        env: { BUN_INSTALL: "/tmp/custom-bun" },
      })
    })

    test("#then a legacy Bun home-root install pins omo-ai@<version> without an overlay", () => {
      const hasBunLock = (path: string) => path.replace(/\\/g, "/") === "/home/u/bun.lock"
      expect(updateTarget("/home/u/node_modules/omo-ai", "linux", "5.1.1", "/home/u", hasBunLock, "5.1.2")).toEqual({
        manager: "bun",
        command: "bun add -g omo-ai@5.1.2",
        argv: ["bun", "add", "-g", "omo-ai@5.1.2"],
      })
    })

    test("#then an npm install pins omo-ai@<version>", () => {
      expect(updateTarget("/tmp/prefix/lib/node_modules/omo-ai", "linux", "5.1.1", "/home/u", noLockfile, "5.1.2")).toEqual({
        manager: "npm",
        command: "npm i -g omo-ai@5.1.2",
        argv: ["npm", "i", "-g", "omo-ai@5.1.2"],
      })
    })

    test("#then a beta install pins the exact beta version instead of the beta tag", () => {
      const target = updateTarget("/tmp/prefix/lib/node_modules/omo-ai", "linux", "5.0.0-0.beta.90", "/home/u", noLockfile, "5.0.0-0.beta.91")
      expect(target.argv).toEqual(["npm", "i", "-g", "omo-ai@5.0.0-0.beta.91"])
    })
  })
})

describe("omo update against the channel dist-tag", () => {
  const bunRootPath = "/tmp/custom-bun/install/global/node_modules/omo-ai"
  const resolveBunUpdate = (targetVersion?: string) => updateTarget(bunRootPath, "linux", "5.1.1", "/home/u", () => false, targetVersion)
  const resolveNpmUpdate = (targetVersion?: string) =>
    updateTarget("/tmp/prefix/lib/node_modules/omo-ai", "linux", "5.1.1", "/home/u", () => false, targetVersion)

  function harness(options: {
    distTags: Record<string, string> | null
    versions: string[]
    status?: number
    resolveUpdate?: (targetVersion?: string) => ReturnType<typeof updateTarget>
  }) {
    const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
    const lines: string[] = []
    const errors: string[] = []
    let reads = 0
    return {
      spawned,
      lines,
      errors,
      options: {
        resolveUpdate: options.resolveUpdate ?? resolveBunUpdate,
        fetchDistTags: () => options.distTags,
        env: { PATH: "/usr/bin" },
        readInstalled: () => {
          const omo = options.versions[Math.min(reads, options.versions.length - 1)] ?? "unknown"
          reads += 1
          return { omo, engine: "2026.9.29" }
        },
        run: async (command: string, args: string[], runOptions: { env?: NodeJS.ProcessEnv } = {}) => {
          spawned.push({ command, args, env: runOptions.env ?? {} })
          return { status: options.status ?? 0, signal: null }
        },
        log: (line: string) => lines.push(line),
        error: (line: string) => errors.push(line),
      },
    }
  }

  test("#given the manager exits 0 but the version did not move #then it exits non-zero naming the published version and the retry command", async () => {
    const h = harness({ distTags: { latest: "5.1.2", beta: "5.0.0-0.beta.99" }, versions: ["5.1.1", "5.1.1"] })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).not.toBe(0)
    expect(h.spawned.map((call) => [call.command, ...call.args])).toEqual([["bun", "add", "-g", "omo-ai@5.1.2"]])
    expect(h.lines).toEqual(["omo is updated via bun: bun add -g omo-ai@5.1.2"])
    expect(h.errors).toEqual([
      "omo is still 5.1.1; 5.1.2 is published",
      "omo: update failed; retry with: bun add -g omo-ai@5.1.2",
    ])
  })

  test("#given a newer published version #then it installs the exact spec and reports the move", async () => {
    const h = harness({ distTags: { latest: "5.1.2" }, versions: ["5.1.1", "5.1.2"] })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).toBe(0)
    expect(h.spawned).toEqual([{
      command: "bun",
      args: ["add", "-g", "omo-ai@5.1.2"],
      env: { PATH: "/usr/bin", BUN_INSTALL: "/tmp/custom-bun" },
    }])
    expect(h.lines).toEqual([
      "omo is updated via bun: bun add -g omo-ai@5.1.2",
      "omo 5.1.1 -> 5.1.2 (engine: senpi 2026.9.29)",
    ])
    expect(h.errors).toEqual([])
  })

  test("#given an npm install #then it spawns npm i -g omo-ai@<version>", async () => {
    const h = harness({ distTags: { latest: "5.1.2" }, versions: ["5.1.1", "5.1.2"], resolveUpdate: resolveNpmUpdate })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).toBe(0)
    expect(h.spawned.map((call) => [call.command, ...call.args])).toEqual([["npm", "i", "-g", "omo-ai@5.1.2"]])
  })

  test("#given the installed version already equals the dist-tag #then it says so and runs no install", async () => {
    const h = harness({ distTags: { latest: "5.1.2" }, versions: ["5.1.2"] })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).toBe(0)
    expect(h.spawned).toEqual([])
    expect(h.lines).toEqual(["omo 5.1.2 is up to date (omo-ai@latest is 5.1.2)"])
    expect(h.errors).toEqual([])
  })

  test("#given a beta install #then it follows the beta dist-tag", async () => {
    const h = harness({
      distTags: { latest: "5.1.2", beta: "5.0.0-0.beta.99" },
      versions: ["5.0.0-0.beta.98", "5.0.0-0.beta.99"],
      resolveUpdate: resolveNpmUpdate,
    })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).toBe(0)
    expect(h.spawned.map((call) => call.args)).toEqual([["i", "-g", "omo-ai@5.0.0-0.beta.99"]])
  })

  test("#given the registry cannot be reached #then it says the target is unconfirmed and runs the unpinned spec", async () => {
    const h = harness({ distTags: null, versions: ["5.1.1", "5.1.2"] })
    const code = await runSelfUpdate(["update"], h.options)
    expect(code).toBe(0)
    expect(h.spawned.map((call) => [call.command, ...call.args])).toEqual([["bun", "add", "-g", "omo-ai"]])
    expect(h.lines).toEqual([
      "omo: could not confirm the latest omo-ai version from the npm registry; installing the unpinned omo-ai",
      "omo is updated via bun: bun add -g omo-ai",
      "omo 5.1.1 -> 5.1.2 (engine: senpi 2026.9.29)",
    ])
  })

  test("#given --dry-run #then it prints the resolved exact command and spawns nothing", async () => {
    const h = harness({ distTags: { latest: "5.1.2" }, versions: ["5.1.1"] })
    const code = await runSelfUpdate(["update", "--dry-run"], h.options)
    expect(code).toBe(0)
    expect(h.spawned).toEqual([])
    expect(h.lines).toEqual(["omo is updated via bun: bun add -g omo-ai@5.1.2"])
  })
})
