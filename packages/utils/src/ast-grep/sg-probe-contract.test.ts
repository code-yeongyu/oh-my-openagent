import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearSgResolutionCache, resolveSgBinarySync } from "./sg-resolver"
import { SG_PATH_ENV_KEY, type SgResolverOptions } from "./types"

/**
 * Contract under test: EVERY candidate must be a non-empty regular file AND pass a 5s `--version`
 * probe whose output contains `ast-grep`. A candidate whose probe fails for ANY reason - non-zero
 * exit, thrown error, timeout, ENOENT, EACCES - is rejected, and resolution continues to the next
 * candidate and tier. No candidate is ever exempt because of its name or its location.
 */

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

interface StubFixture {
  readonly body: string
  readonly mode: number
}

const stubFixtures = new Map<string, StubFixture>()

const TEST_PLATFORM: NodeJS.Platform = process.platform === "win32" ? "win32" : "linux"

function binaryName(name: "ast-grep" | "sg"): string {
  return TEST_PLATFORM === "win32" ? `${name}.exe` : name
}

function writeStub(filePath: string, body: string, mode = 0o755): string {
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(filePath, body)
  chmodSync(filePath, mode)
  stubFixtures.set(filePath, { body, mode })
  return filePath
}

function workingAstGrep(filePath: string): string {
  return writeStub(filePath, "#!/bin/sh\nprintf 'ast-grep 0.45.0\\n'\n")
}

function runWindowsStubProbe(binaryPath: string): string {
  const fixture = stubFixtures.get(binaryPath)
  if (fixture === undefined) throw new Error(`unknown stub: ${binaryPath}`)
  if ((fixture.mode & 0o111) === 0) {
    const error = new Error(`spawn ${binaryPath} EACCES`) as Error & { code: string }
    error.code = "EACCES"
    throw error
  }
  if (fixture.body.includes("sleep 60")) {
    const error = new Error(`spawn ${binaryPath} ETIMEDOUT`) as Error & { code: string }
    error.code = "ETIMEDOUT"
    throw error
  }
  if (fixture.body.includes("printf 'ast-grep ")) return "ast-grep 0.45.0"
  throw new Error(`probe failed: ${binaryPath}`)
}

/** Home directory with no OMO runtime, so tier 2 cannot shadow the tier under test. */
const NO_RUNTIME_HOME = join(tmpdir(), "omo-sg-probe-contract-no-home")

function isolated(overrides: SgResolverOptions): SgResolverOptions {
  return {
    cache: false,
    env: {},
    homeDir: NO_RUNTIME_HOME,
    platform: TEST_PLATFORM,
    runVersionProbeSync: TEST_PLATFORM === "win32" ? runWindowsStubProbe : undefined,
    which: () => null,
    ...overrides,
  }
}

describe("sg probe contract: a failing probe never wins", () => {
  it("#given a broken env override and a working PATH ast-grep #when resolving #then the override loses to PATH", () => {
    // given: the override exists and is executable but exits 42 without printing a version
    const root = tempDir("contract-override")
    const brokenOverride = writeStub(join(root, "override", "custom-override"), "#!/bin/sh\nexit 42\n")
    const pathAstGrep = workingAstGrep(join(root, "path", binaryName("ast-grep")))

    // when
    const result = resolveSgBinarySync(
      isolated({
        env: { [SG_PATH_ENV_KEY]: brokenOverride },
        which: (commandName) => (commandName === "ast-grep" ? pathAstGrep : null),
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(pathAstGrep)
    expect(result.found ? result.tier : null).toBe("path")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a broken env override and nothing else #when resolving #then BINARY_NOT_FOUND is returned", () => {
    // given
    const root = tempDir("contract-override-only")
    const brokenOverride = writeStub(join(root, "override", "custom-override"), "#!/bin/sh\nexit 42\n")

    // when
    const result = resolveSgBinarySync(isolated({ env: { [SG_PATH_ENV_KEY]: brokenOverride } }))

    // then
    expect(result.found).toBe(false)
    expect(result.found ? null : result.error.code).toBe("BINARY_NOT_FOUND")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a cached env candidate that loses its executable bit #when revalidating #then EACCES rejects it", () => {
    // given: a working override is resolved and cached
    const root = tempDir("contract-eacces")
    const override = workingAstGrep(join(root, "override", binaryName("sg")))
    clearSgResolutionCache()
    const options: SgResolverOptions = {
      env: { [SG_PATH_ENV_KEY]: override },
      homeDir: NO_RUNTIME_HOME,
      platform: TEST_PLATFORM,
      runVersionProbeSync: TEST_PLATFORM === "win32" ? runWindowsStubProbe : undefined,
      which: () => null,
    }
    const cached = resolveSgBinarySync(options)

    // when: the binary loses its executable bit and the cache is revalidated
    chmodSync(override, 0o644)
    stubFixtures.set(override, { body: "#!/bin/sh\nprintf 'ast-grep 0.45.0\\n'\n", mode: 0o644 })
    const revalidated = resolveSgBinarySync({ ...options, revalidate: true })

    // then: EACCES rejects it, and the same pass must not re-accept it either
    expect(cached.found ? cached.path : null).toBe(override)
    expect(revalidated.found).toBe(false)
    expect(revalidated.found ? null : revalidated.error.code).toBe("BINARY_NOT_FOUND")

    clearSgResolutionCache()
    rmSync(root, { force: true, recursive: true })
  })

  it("#given a non-executable candidate #when resolving fresh #then EACCES rejects it and a later tier wins", () => {
    // given
    const root = tempDir("contract-eacces-fresh")
    const unreadable = writeStub(
      join(root, "override", binaryName("ast-grep")),
      "#!/bin/sh\nprintf 'ast-grep 0.45.0\\n'\n",
      0o644,
    )
    const pathAstGrep = workingAstGrep(join(root, "path", binaryName("ast-grep")))

    // when
    const result = resolveSgBinarySync(
      isolated({
        env: { [SG_PATH_ENV_KEY]: unreadable },
        which: (commandName) => (commandName === "ast-grep" ? pathAstGrep : null),
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(pathAstGrep)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a PATH ast-grep that hangs #when the 5s probe times out #then it is rejected and the next candidate wins", () => {
    // given: an `ast-grep`-named stub that never returns, and a working `sg` behind it on PATH
    const root = tempDir("contract-timeout")
    const hangingAstGrep = writeStub(join(root, "path", binaryName("ast-grep")), "#!/bin/sh\nsleep 60\n")
    const workingSg = workingAstGrep(join(root, "path", binaryName("sg")))
    const startedAt = Date.now()

    // when
    const result = resolveSgBinarySync(
      isolated({ which: (commandName) => (commandName === "ast-grep" ? hangingAstGrep : workingSg) }),
    )
    const elapsedMs = Date.now() - startedAt

    // then: the hung probe is bounded and never selected
    expect(result.found ? result.path : null).toBe(workingSg)
    if (process.platform !== "win32") expect(elapsedMs).toBeGreaterThanOrEqual(4_000)
    expect(elapsedMs).toBeLessThan(20_000)

    rmSync(root, { force: true, recursive: true })
  }, { timeout: 30_000 })

  it("#given every probe throws #when resolving #then no tier is exempt and BINARY_NOT_FOUND is returned", () => {
    // given: candidates in every tier exist as files, but no probe can run
    const root = tempDir("contract-all-throw")
    const override = join(root, "override", binaryName("ast-grep"))
    const runtimeDir = join(root, "runtime")
    const pathAstGrep = join(root, "path", binaryName("ast-grep"))

    // when
    const result = resolveSgBinarySync(
      isolated({
        env: { [SG_PATH_ENV_KEY]: override },
        fileExists: () => true,
        runtimeDir,
        runVersionProbeSync: () => {
          throw new Error("probe cannot run")
        },
        which: (commandName) => (commandName === "ast-grep" ? pathAstGrep : null),
      }),
    )

    // then
    expect(result.found).toBe(false)
    expect(result.found ? null : result.error.code).toBe("BINARY_NOT_FOUND")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given an ast-grep-named candidate whose probe reports another tool #when resolving #then the name grants no exemption", () => {
    // given
    const root = tempDir("contract-name-exemption")
    const impostor = writeStub(
      join(root, "path", binaryName("ast-grep")),
      "#!/bin/sh\nprintf 'ripgrep 14.1.0\\n'\n",
    )

    // when
    const result = resolveSgBinarySync(isolated({ which: (commandName) => (commandName === "ast-grep" ? impostor : null) }))

    // then
    expect(result.found).toBe(false)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given an OMO runtime candidate that fails its probe #when resolving #then the runtime location grants no exemption", () => {
    // given: the OMO-provisioned runtime dir holds a binary that cannot run
    const root = tempDir("contract-runtime-exemption")
    const runtimeDir = join(root, "runtime")
    writeStub(join(runtimeDir, binaryName("sg")), "#!/bin/sh\nexit 3\n")
    const pathAstGrep = workingAstGrep(join(root, "path", binaryName("ast-grep")))

    // when
    const result = resolveSgBinarySync(
      isolated({ runtimeDir, which: (commandName) => (commandName === "ast-grep" ? pathAstGrep : null) }),
    )

    // then
    expect(result.found ? result.path : null).toBe(pathAstGrep)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given packageDir is supplied #when the package-local bin holds ast-grep #then the skill-bin tier activates", () => {
    // given
    const root = tempDir("contract-packagedir")
    const packageDir = join(root, "ast-grep-mcp")
    const packageLocal = workingAstGrep(join(packageDir, "bin", binaryName("ast-grep")))
    const pathAstGrep = workingAstGrep(join(root, "path", binaryName("ast-grep")))

    // when
    const result = resolveSgBinarySync(
      isolated({ packageDir, which: (commandName) => (commandName === "ast-grep" ? pathAstGrep : null) }),
    )

    // then: the package-local binary outranks PATH
    expect(result.found ? result.path : null).toBe(packageLocal)
    expect(result.found ? result.tier : null).toBe("skill-bin")

    rmSync(root, { force: true, recursive: true })
  })
})
