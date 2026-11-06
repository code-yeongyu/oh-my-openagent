import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildKeychainHelper } from "../keychain-helper/build"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform !== "darwin")("keychain helper build", () => {
  test("#given an output path whose parent directory does not exist yet #when the helper is built #then the directory is created and the binary is written", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-keychain-build-"))
    dirs.push(root)
    const output = join(root, "bin", "darwin", "omo-keychain")

    // when
    await buildKeychainHelper({ output, flavor: "release", architectures: [process.arch === "arm64" ? "arm64" : "x86_64"] })

    // then
    expect(existsSync(output)).toBe(true)
  }, 60_000)
})
