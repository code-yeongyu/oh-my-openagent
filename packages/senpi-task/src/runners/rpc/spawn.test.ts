import { homedir } from "node:os"
import { dirname, isAbsolute, join, sep } from "node:path"
import { describe, expect, test } from "bun:test"

import { buildRpcSpawn, detectBunBinary, resolveChildSessionDir } from "./spawn"

const SESSION_DIR_ENV = "SENPI_CODING_AGENT_SESSION_DIR"

const baseSpec = {
  task_id: "st_1a2b3c4d",
  cwd: "/tmp/project",
  state_dir: "/tmp/project/.omo/senpi-task",
  prompt: "do the work",
} as const

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

describe("buildRpcSpawn", () => {
  test("#given a bun runtime #when building #then it launches the sibling senpi binary in rpc mode", () => {
    // when
    const descriptor = buildRpcSpawn(baseSpec, {
      isBunBinary: true,
      execPath: "/opt/senpi/bin/bun",
      platform: "linux",
      parentEnv: { PATH: "/usr/bin" },
    })

    // then
    expect(descriptor.command).toBe(join(dirname("/opt/senpi/bin/bun"), "senpi"))
    expect(descriptor.args).toEqual(["--mode", "rpc"])
    expect(descriptor.cwd).toBe(baseSpec.cwd)
  })

  test("#given a win32 bun runtime #when building #then the sibling binary is senpi.exe", () => {
    // when
    const descriptor = buildRpcSpawn(baseSpec, {
      isBunBinary: true,
      execPath: "C:/senpi/bun.exe",
      platform: "win32",
      parentEnv: {},
    })

    // then
    expect(descriptor.command.endsWith("senpi.exe")).toBe(true)
  })

  test("#given a node runtime #when building #then it launches node against the resolved rpc-entry", () => {
    // when
    const descriptor = buildRpcSpawn(baseSpec, {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux",
      parentEnv: {},
      resolveRpcEntry: () => "/pkg/@code-yeongyu/senpi/dist/rpc-entry.js",
    })

    // then
    expect(descriptor.command).toBe("/usr/bin/node")
    expect(descriptor.args).toEqual(["/pkg/@code-yeongyu/senpi/dist/rpc-entry.js"])
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
})
