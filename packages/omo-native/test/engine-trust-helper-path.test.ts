import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { resolveEngineTrustHelperPath } from "../engine-trust-helper-path"

const runtimeDir = join("/provisioned", "omo-runtime")

describe("resolveEngineTrustHelperPath", () => {
  test("returns the payload path under OMO_PACKAGE_DIR on the four Darwin and Windows hosts", () => {
    const env = { OMO_PACKAGE_DIR: runtimeDir }

    expect(resolveEngineTrustHelperPath(env, "darwin", "arm64"))
      .toBe(join(runtimeDir, "native", "prebuilds", "darwin-arm64", "omo-engine-trust-helper"))
    expect(resolveEngineTrustHelperPath(env, "darwin", "x64"))
      .toBe(join(runtimeDir, "native", "prebuilds", "darwin-x64", "omo-engine-trust-helper"))
    expect(resolveEngineTrustHelperPath(env, "win32", "x64"))
      .toBe(join(runtimeDir, "native", "prebuilds", "win32-x64", "omo-engine-trust-helper.exe"))
    expect(resolveEngineTrustHelperPath(env, "win32", "arm64"))
      .toBe(join(runtimeDir, "native", "prebuilds", "win32-arm64", "omo-engine-trust-helper.exe"))
  })

  test("returns null on hosts that ship no helper", () => {
    const env = { OMO_PACKAGE_DIR: runtimeDir }

    expect(resolveEngineTrustHelperPath(env, "linux", "x64")).toBeNull()
    expect(resolveEngineTrustHelperPath(env, "linux", "arm64")).toBeNull()
    expect(resolveEngineTrustHelperPath(env, "darwin", "ia32")).toBeNull()
    expect(resolveEngineTrustHelperPath(env, "win32", "ia32")).toBeNull()
    expect(resolveEngineTrustHelperPath(env, "freebsd", "x64")).toBeNull()
  })

  test("returns null without an extracted runtime directory", () => {
    expect(resolveEngineTrustHelperPath({}, "darwin", "arm64")).toBeNull()
    expect(resolveEngineTrustHelperPath({ OMO_PACKAGE_DIR: "" }, "win32", "x64")).toBeNull()
  })
})
