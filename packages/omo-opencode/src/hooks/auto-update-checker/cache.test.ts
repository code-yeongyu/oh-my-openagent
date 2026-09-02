import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { invalidatePackage } from "./cache"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("auto-update cache invalidation", () => {
  it("#given invalid text lockfile only #when invalidating package #then returns false without deleting cache root", () => {
    // given
    const cacheDir = createTemporaryDirectory("omo-auto-update-cache-")
    const userConfigDir = createTemporaryDirectory("omo-auto-update-config-")
    writeFileSync(join(cacheDir, "bun.lock"), "{not json", "utf-8")

    // when
    const result = invalidatePackage("oh-my-openagent", {
      acceptedPackageNames: ["oh-my-openagent"],
      cacheDir,
      defaultPackageName: "oh-my-openagent",
      userConfigDir,
    })

    // then
    expect(result).toBe(false)
    expect(existsSync(cacheDir)).toBe(true)
  })

  it("#given binary lockfile only #when invalidating package #then deletes lockfile", () => {
    // given
    const cacheDir = createTemporaryDirectory("omo-auto-update-cache-")
    const userConfigDir = createTemporaryDirectory("omo-auto-update-config-")
    const lockPath = join(cacheDir, "bun.lockb")
    writeFileSync(lockPath, "binary", "utf-8")

    // when
    const result = invalidatePackage("oh-my-openagent", {
      acceptedPackageNames: ["oh-my-openagent"],
      cacheDir,
      defaultPackageName: "oh-my-openagent",
      userConfigDir,
    })

    // then
    expect(result).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
  })

  it("#given text lockfile pins spec-keyed entries like oh-my-openagent@latest #when invalidating package #then every spec entry for the package is purged so the next install re-resolves the tag (#6620)", () => {
    // given — bun.lock keys resolved packages by "<name>@<range>", so a tag
    // spec pins its first resolution under "oh-my-openagent@latest".
    const cacheDir = createTemporaryDirectory("omo-auto-update-cache-")
    const userConfigDir = createTemporaryDirectory("omo-auto-update-config-")
    const lockPath = join(cacheDir, "bun.lock")
    writeFileSync(
      lockPath,
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { dependencies: { "oh-my-openagent": "latest" } } },
        packages: {
          "oh-my-openagent@latest": { version: "4.15.1" },
          "oh-my-openagent@^4.0.0": { version: "4.2.0" },
          "oh-my-openagent": { version: "4.15.1" },
          "unrelated-pkg@latest": { version: "1.0.0" },
          "@scope/other": { version: "2.0.0" },
        },
      }),
      "utf-8",
    )

    // when
    const result = invalidatePackage("oh-my-openagent", {
      acceptedPackageNames: ["oh-my-openagent"],
      cacheDir,
      defaultPackageName: "oh-my-openagent",
      userConfigDir,
    })

    // then
    const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as { packages: Record<string, unknown> }
    expect(result).toBe(true)
    expect(Object.keys(lock.packages)).toEqual(["unrelated-pkg@latest", "@scope/other"])
  })
})
