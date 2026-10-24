import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { AccountHomeResolutionError, findProjectConfigPathsFarthestFirst, resolveOmoConfigPaths } from "./paths"
import type { OmoConfigReadFileSystem } from "./types"

const realOs = require("node:os")
const realFileSystem: OmoConfigReadFileSystem = {
  existsSync: require("node:fs").existsSync,
  lstatSync: require("node:fs").lstatSync,
  readFileSync: require("node:fs").readFileSync,
  realpathSync: require("node:fs").realpathSync,
}

function mockUserInfoFailure(): void {
  mock.module("node:os", () => ({
    ...realOs,
    userInfo: () => {
      throw Object.assign(new Error("uv_os_get_passwd returned ENOENT"), {
        code: "ERR_SYSTEM_ERROR",
        syscall: "uv_os_get_passwd",
      })
    },
  }))
}

afterEach(() => {
  mock.restore()
  mock.module("node:os", () => realOs)
})

describe("account home resolution", () => {
  test("#given userInfo fails #when the loader is imported #then importing it still succeeds", async () => {
    // given
    mockUserInfoFailure()

    // when
    const loaded = await import("./paths")

    // then
    expect(typeof loaded.resolveOmoConfigPaths).toBe("function")
  })

  test("#given userInfo fails #when resolving paths #then it throws a typed error instead of using HOME", () => {
    // given
    const homeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))
    mockUserInfoFailure()

    // when
    const resolveWithFailure = (): unknown =>
      resolveOmoConfigPaths({ cwd: homeDir, env: { HOME: homeDir }, fileSystem: realFileSystem })

    // then
    expect(resolveWithFailure).toThrow(AccountHomeResolutionError)
  })

  test("#given HOME differs from the account home #when resolving paths #then the account home stays the boundary", () => {
    // given
    const accountHomeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))
    const configuredHomeDir = resolve(mkdtempSync(join(tmpdir(), "omo-configured-home-")))
    const projectDir = join(accountHomeDir, "work", "project")
    mkdirSync(projectDir, { recursive: true })
    mock.module("node:os", () => ({ ...realOs, userInfo: () => ({ ...realOs.userInfo(), homedir: accountHomeDir }) }))

    // when
    const paths = findProjectConfigPathsFarthestFirst(projectDir, configuredHomeDir, realFileSystem)

    // then
    expect(paths).toEqual([])
  })

  test("#given the mock was restored #when resolving paths #then the real userInfo is used", () => {
    // given
    const homeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))

    // when
    const candidates = resolveOmoConfigPaths({ cwd: homeDir, env: { HOME: homeDir }, fileSystem: realFileSystem })

    // then
    expect(candidates[0]?.scope).toBe("user")
  })
})
