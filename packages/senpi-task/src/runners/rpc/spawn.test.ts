import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { describe, expect, test } from "bun:test"

import { buildChildArgs, buildRpcSpawn, detectBunBinary, resolveChildSessionDir, resolveSenpiExecutable } from "./spawn"

const SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"

const baseSpec = {
  task_id: "st_1a2b3c4d",
  cwd: "/tmp/project",
  state_dir: "/tmp/project/.omo/senpi-task",
  prompt: "do the work",
} as const

// A runtime that never finds a real executable, isolating the fallback path deterministically.
const noExecutable = { resolveSenpiExecutable: () => null }
// A runtime that always resolves a fixed executable, isolating the executable-preferred path.
const withExecutable = (path: string) => ({ resolveSenpiExecutable: () => path })

describe("detectBunBinary", () => {
  test("#given a bun virtual-fs url #when detecting #then it reports a bun binary", () => {
    // given / when / then
    expect(detectBunBinary("file:///$bunfs/root/index.js")).toBe(true)
    expect(detectBunBinary("file:///~BUN/root/index.js")).toBe(true)
    expect(detectBunBinary("file:///%7EBUN/root/index.js")).toBe(true)
  })

  test("#given a plain file url #when detecting #then it is not a bun binary", () => {
    // given / when / then
    expect(detectBunBinary("file:///Users/me/project/index.js")).toBe(false)
  })
})

describe("resolveChildSessionDir", () => {
  test("#given a state dir and task id #when resolving #then the session dir nests under sessions/<id>/", () => {
    // when
    const dir = resolveChildSessionDir(baseSpec.state_dir, baseSpec.task_id)

    // then
    expect(isAbsolute(dir)).toBe(true)
    expect(dir.startsWith(join(baseSpec.state_dir, "sessions", baseSpec.task_id))).toBe(true)
    expect(dir.endsWith(sep)).toBe(true)
  })
})

describe("resolveSenpiExecutable", () => {
  const runtime = {
    isBunBinary: false as boolean,
    execPath: "/usr/bin/node",
    platform: "linux" as NodeJS.Platform,
    parentEnv: {} as NodeJS.ProcessEnv,
    resolveRpcEntry: () => "/rpc-entry.js",
  }

  test("#given SENPI_BIN pointing at an existing absolute path #when resolving #then it is used verbatim", () => {
    // given: this test file itself is a guaranteed-existing absolute path
    const existing = import.meta.path
    // when
    const resolved = resolveSenpiExecutable({ ...runtime, parentEnv: { SENPI_BIN: existing } })
    // then
    expect(resolved).toBe(existing)
  })

  test("#given SENPI_BIN pointing at a missing absolute path #when resolving #then it is null (no silent PATH fallthrough)", () => {
    // when
    const resolved = resolveSenpiExecutable({ ...runtime, parentEnv: { SENPI_BIN: "/definitely/missing/senpi" } })
    // then
    expect(resolved).toBeNull()
  })

  test("#given a relative SENPI_BIN #when resolving #then the validated executable is returned as a canonical absolute path", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-relative-override-"))
    const executable = join(root, "senpi")
    writeFileSync(executable, "")
    try {
      const override = relative(process.cwd(), executable)
      const resolved = resolveSenpiExecutable({ ...runtime, parentEnv: { SENPI_BIN: override } })
      expect(resolved).toBe(realpathSync.native(executable))
      if (resolved === null) throw new Error("relative SENPI_BIN did not resolve")
      expect(isAbsolute(resolved)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a relative PATH entry #when resolving #then the validated executable is returned as a canonical absolute path", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-relative-path-"))
    const executable = join(root, "senpi")
    writeFileSync(executable, "")
    try {
      const pathEntry = relative(process.cwd(), root)
      const resolved = resolveSenpiExecutable({ ...runtime, parentEnv: { PATH: pathEntry } })
      expect(resolved).toBe(realpathSync.native(executable))
      if (resolved === null) throw new Error("relative PATH entry did not resolve")
      expect(isAbsolute(resolved)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given no SENPI_BIN and an empty PATH #when resolving a node runtime #then no executable is found", () => {
    // when
    const resolved = resolveSenpiExecutable({ ...runtime, parentEnv: { PATH: "" } })
    // then
    expect(resolved).toBeNull()
  })

  test("#given a bun runtime whose sibling Senpi binary is absent #when resolving #then it falls through instead of returning a missing path", () => {
    const resolved = resolveSenpiExecutable({ ...runtime, isBunBinary: true, execPath: "/opt/senpi/bin/bun", parentEnv: {} })
    expect(resolved).toBeNull()
  })

  test("#given a bun runtime with an existing sibling Senpi binary #when resolving #then that sibling is chosen", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-bun-sibling-"))
    const execPath = join(root, "bun")
    const sibling = join(root, "senpi")
    writeFileSync(sibling, "")
    try {
      expect(resolveSenpiExecutable({ ...runtime, isBunBinary: true, execPath, parentEnv: {} })).toBe(realpathSync.native(sibling))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("buildChildArgs", () => {
  test("#given a spec with model and extensions #when building child args #then no-extensions leads, each -e follows, then --model", () => {
    // when
    const args = buildChildArgs({ ...baseSpec, model: "omo-mock/mock-1", extensions: ["/tmp/a.ts", "/tmp/b.ts"] })
    // then
    expect(args).toEqual(["--no-extensions", "--extension", "/tmp/a.ts", "--extension", "/tmp/b.ts", "--model", "omo-mock/mock-1"])
  })

  test("#given a spec with neither model nor extensions #when building child args #then only no-extensions is present", () => {
    // when
    const args = buildChildArgs(baseSpec)
    // then
    expect(args).toEqual(["--no-extensions"])
  })

  test("#given a spec with a valid variant #when building child args #then --thinking follows --model", () => {
    // when
    const args = buildChildArgs({ ...baseSpec, model: "omo-mock/mock-1", variant: "xhigh" })
    // then
    expect(args).toEqual(["--no-extensions", "--model", "omo-mock/mock-1", "--thinking", "xhigh"])
  })

  test("#given a spec with high reasoning effort #when building child args #then it maps to senpi high", () => {
    // when
    const args = buildChildArgs({ ...baseSpec, model: "omo-mock/mock-1", variant: "high" })
    // then
    expect(args).toEqual(["--no-extensions", "--model", "omo-mock/mock-1", "--thinking", "high"])
  })

  test("#given the omo.json reasoningEffort none as variant #when building child args #then it maps to senpi off", () => {
    // when
    const args = buildChildArgs({ ...baseSpec, variant: "none" })
    // then
    expect(args).toEqual(["--no-extensions", "--thinking", "off"])
  })

  test("#given an unknown variant #when building child args #then no --thinking flag is emitted", () => {
    // when
    const args = buildChildArgs({ ...baseSpec, model: "omo-mock/mock-1", variant: "ultra" })
    // then
    expect(args).toEqual(["--no-extensions", "--model", "omo-mock/mock-1"])
  })
})

describe("buildRpcSpawn spawn strategy", () => {
  test("#given a Windows npm senpi installation #when building an RPC child #then Node launches the npm package CLI without shell forwarding", () => {
    // given
    const npmDir = mkdtempSync(join(tmpdir(), "senpi-npm-rpc-"))
    const shim = join(npmDir, "senpi.cmd")
    const cli = join(npmDir, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    mkdirSync(dirname(cli), { recursive: true })
    writeFileSync(shim, "@echo off\n")
    writeFileSync(cli, "")

    try {
      // when
      const descriptor = buildRpcSpawn(
        { ...baseSpec, model: "omo-mock/mock-1" },
        {
          isBunBinary: false,
          execPath: "C:\\Program Files\\nodejs\\node.exe",
          platform: "win32",
          parentEnv: { PATH: npmDir },
          resolveRpcEntry: () => "/fallback/rpc-entry.js",
        },
      )

      // then
      expect(descriptor.command).toBe("C:\\Program Files\\nodejs\\node.exe")
      expect(descriptor.args).toEqual([
        realpathSync.native(cli),
        "--mode",
        "rpc",
        "--no-extensions",
        "--model",
        "omo-mock/mock-1",
      ])
    } finally {
      rmSync(npmDir, { recursive: true, force: true })
    }
  })

  test("#given a project-local node_modules/.bin Senpi shim #when building an RPC child #then Node launches its package CLI without rpc-entry fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-local-bin-rpc-"))
    const shimDir = join(root, "node_modules", ".bin")
    const shim = join(shimDir, "senpi.cmd")
    const cli = join(root, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    mkdirSync(dirname(cli), { recursive: true })
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(shim, "@echo off\n")
    writeFileSync(cli, "")
    try {
      const descriptor = buildRpcSpawn(
        { ...baseSpec, model: "omo-mock/mock-1" },
        {
          isBunBinary: false,
          execPath: "C:\\Program Files\\nodejs\\node.exe",
          platform: "win32",
          parentEnv: { PATH: shimDir },
          resolveRpcEntry: () => "/fallback/rpc-entry.js",
        },
      )

      expect(descriptor.command).toBe("C:\\Program Files\\nodejs\\node.exe")
      expect(descriptor.args[0]).toBe(realpathSync.native(cli))
      expect(descriptor.args).not.toContain("/fallback/rpc-entry.js")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a resolvable senpi executable #when building #then it spawns the EXECUTABLE in rpc mode (not the loader-hijacked rpc-entry)", () => {
    // when
    const descriptor = buildRpcSpawn(
      { ...baseSpec, model: "omo-mock/mock-1", extensions: ["/tmp/mock.ts"] },
      { isBunBinary: false, execPath: "/usr/bin/node", platform: "linux", parentEnv: {}, ...withExecutable("/opt/homebrew/bin/senpi") },
    )
    // then: the executable is the command; the resolved rpc-entry is NEVER on the argv
    expect(descriptor.command).toBe("/opt/homebrew/bin/senpi")
    expect(descriptor.args[0]).toBe("--mode")
    expect(descriptor.args[1]).toBe("rpc")
    expect(descriptor.args).toContain("--model")
    expect(descriptor.args).toContain("omo-mock/mock-1")
    expect(descriptor.args).toContain("--extension")
    expect(descriptor.args).toContain("/tmp/mock.ts")
    expect(descriptor.args.some((a) => a.includes("rpc-entry"))).toBe(false)
  })

  test("#given a bun runtime with a resolvable sibling executable #when building #then the sibling binary runs rpc mode with threaded args", () => {
    // when
    const descriptor = buildRpcSpawn(
      { ...baseSpec, model: "omo-mock/mock-1" },
      { isBunBinary: true, execPath: "/opt/senpi/bin/bun", platform: "linux", parentEnv: {}, ...withExecutable(join("/opt/senpi/bin", "senpi")) },
    )
    // then
    expect(descriptor.command).toBe(join("/opt/senpi/bin", "senpi"))
    expect(descriptor.args).toEqual(["--mode", "rpc", "--no-extensions", "--model", "omo-mock/mock-1"])
    expect(descriptor.cwd).toBe(baseSpec.cwd)
  })

  test("#given NO resolvable executable #when building #then it falls back to execPath + rpc-entry, still threading child args", () => {
    // when
    const descriptor = buildRpcSpawn(
      { ...baseSpec, model: "omo-mock/mock-1", extensions: ["/tmp/mock.ts"] },
      {
        isBunBinary: false,
        execPath: "/usr/bin/node",
        platform: "linux",
        parentEnv: {},
        resolveRpcEntry: () => "/pkg/@code-yeongyu/senpi/dist/rpc-entry.js",
        ...noExecutable,
      },
    )
    // then
    expect(descriptor.command).toBe("/usr/bin/node")
    expect(descriptor.args).toEqual([
      "/pkg/@code-yeongyu/senpi/dist/rpc-entry.js",
      "--no-extensions",
      "--extension",
      "/tmp/mock.ts",
      "--model",
      "omo-mock/mock-1",
    ])
  })

  test("#given a parent env #when building #then the child gets an isolated session dir and inherits parent vars untouched", () => {
    // given
    const parentEnv = { PATH: "/usr/bin", HOME: "/Users/me", ANTHROPIC_API_KEY: "secret" }

    // when
    const descriptor = buildRpcSpawn(baseSpec, {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux",
      parentEnv,
      resolveRpcEntry: () => "/rpc-entry.js",
      ...noExecutable,
    })

    // then
    const sessionDir = descriptor.env[SESSION_DIR_ENV]
    expect(sessionDir).toBeDefined()
    expect((sessionDir ?? "").startsWith(join(baseSpec.state_dir, "sessions", baseSpec.task_id))).toBe(true)
    expect((sessionDir ?? "").startsWith(join(homedir(), ".senpi"))).toBe(false)
    // parent env inherited, real agent dir left to resolve normally
    expect(descriptor.env.PATH).toBe("/usr/bin")
    expect(descriptor.env.ANTHROPIC_API_KEY).toBe("secret")
    expect(descriptor.env.SENPI_CODING_AGENT_DIR).toBeUndefined()
    // a fresh object, not a mutation of the caller's env
    expect(descriptor.env).not.toBe(parentEnv)
    expect(parentEnv).not.toHaveProperty(SESSION_DIR_ENV)
  })

  test("#given a generic child spawned by a member #when building #then member identity and extension do not leak", () => {
    // given
    const memberExtension = "/tmp/omo-member.js"
    const providerExtension = "/tmp/provider.js"

    // when
    const descriptor = buildRpcSpawn(
      { ...baseSpec, extensions: [memberExtension, providerExtension] },
      {
        isBunBinary: false,
        execPath: "/usr/bin/node",
        platform: "linux",
        parentEnv: {
          PATH: "/usr/bin",
          SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::alice",
          SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
          SENPI_TASK_TEAM_CONFIG: '{"members":["alice"]}',
        },
        resolveRpcEntry: () => "/rpc-entry.js",
        ...noExecutable,
      },
    )

    // then
    expect(descriptor.env.SENPI_TASK_MEMBER).toBeUndefined()
    expect(descriptor.env.SENPI_TASK_MEMBER_TASK_ID).toBeUndefined()
    expect(descriptor.env.SENPI_TASK_TEAM_CONFIG).toBeUndefined()
    expect(descriptor.args).not.toContain(memberExtension)
    expect(descriptor.args).toContain(providerExtension)
  })

  test("#given member extension env w2mem #when building #then identity config and task id reach the child without overriding isolation", () => {
    // given
    const memberEnv = {
      SENPI_TASK_MEMBER: "11111111-1111-4111-8111-111111111111::alice",
      SENPI_TASK_MEMBER_TASK_ID: "st_00000001",
      SENPI_TASK_TEAM_CONFIG: '{"members":["alice"]}',
      SENPI_CODING_AGENT_SESSION_DIR: "/untrusted/override",
    }

    // when
    const descriptor = buildRpcSpawn(
      { ...baseSpec, extensions: ["/tmp/omo-member.js"], memberEnv },
      {
        isBunBinary: false,
        execPath: "/usr/bin/node",
        platform: "linux",
        parentEnv: { PATH: "/usr/bin" },
        resolveRpcEntry: () => "/rpc-entry.js",
        ...noExecutable,
      },
    )

    // then
    expect(descriptor.env.SENPI_TASK_MEMBER).toBe(memberEnv.SENPI_TASK_MEMBER)
    expect(descriptor.env.SENPI_TASK_MEMBER_TASK_ID).toBe(memberEnv.SENPI_TASK_MEMBER_TASK_ID)
    expect(descriptor.env.SENPI_TASK_TEAM_CONFIG).toBe(memberEnv.SENPI_TASK_TEAM_CONFIG)
    expect(descriptor.env.SENPI_CODING_AGENT_SESSION_DIR).toBe(resolveChildSessionDir(baseSpec.state_dir, baseSpec.task_id))
    expect(descriptor.args).toContain("/tmp/omo-member.js")
  })
})
