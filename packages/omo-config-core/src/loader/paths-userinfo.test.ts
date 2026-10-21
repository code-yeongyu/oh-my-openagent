import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { AccountHomeResolutionError, resolveOmoConfigPaths } from "./paths"
import type { OmoConfigReadFileSystem } from "./types"

const realUserInfo = require("node:os").userInfo
const realFileSystem: OmoConfigReadFileSystem = {
  existsSync: require("node:fs").existsSync,
  lstatSync: require("node:fs").lstatSync,
  readFileSync: require("node:fs").readFileSync,
  realpathSync: require("node:fs").realpathSync,
}

function withoutPasswdRecord(): void {
  mock.module("node:os", () => ({
    ...require("node:os"),
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
  mock.module("node:os", () => ({ ...require("node:os"), userInfo: realUserInfo }))
})

describe("resolveOmoConfigPaths without a passwd record", () => {
  test("#given HOME is a real non-symlinked directory #when resolving candidates #then HOME is used as the account home", () => {
    // given
    const homeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))
    const projectDir = join(homeDir, "work", "project")
    mkdirSync(join(projectDir, ".omo"), { recursive: true })
    withoutPasswdRecord()

    // when
    const candidates = resolveOmoConfigPaths({
      cwd: projectDir,
      env: { HOME: homeDir },
      fileSystem: realFileSystem,
    })

    // then
    expect(candidates[0]).toEqual({ path: join(homeDir, ".omo", "omo.jsonc"), scope: "user" })
  })

  test("#given HOME is a symlink #when resolving candidates #then it fails with a typed account-home error", () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-account-home-"))
    withoutPasswdRecord()
    const fileSystem: OmoConfigReadFileSystem = {
      ...realFileSystem,
      lstatSync: (path: string) => ({ isSymbolicLink: (): boolean => path === homeDir }),
    }

    // when
    const resolveWithSymlink = (): unknown =>
      resolveOmoConfigPaths({ cwd: homeDir, env: { HOME: homeDir }, fileSystem })

    // then
    expect(resolveWithSymlink).toThrow(AccountHomeResolutionError)
  })

  test("#given userInfo fails for another reason #when resolving candidates #then HOME is not used", () => {
    // given
    const homeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))
    mock.module("node:os", () => ({
      ...require("node:os"),
      userInfo: () => {
        throw Object.assign(new Error("unexpected"), { code: "ERR_SYSTEM_ERROR", syscall: "something_else" })
      },
    }))

    // when
    const resolveWithUnexpectedError = (): unknown =>
      resolveOmoConfigPaths({ cwd: homeDir, env: { HOME: homeDir }, fileSystem: realFileSystem })

    // then
    expect(resolveWithUnexpectedError).toThrow(AccountHomeResolutionError)
  })

  test("#given the mock was restored #when resolving after the test #then the real userInfo is used", () => {
    // given
    const homeDir = resolve(mkdtempSync(join(tmpdir(), "omo-account-home-")))

    // when
    const candidates = resolveOmoConfigPaths({ cwd: homeDir, env: { HOME: homeDir }, fileSystem: realFileSystem })

    // then
    expect(candidates[0]?.scope).toBe("user")
  })
})
