import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearSgResolutionCache, findSgBinarySync, resolveSgBinarySync } from "./sg-resolver"
import { AST_GREP_BIN_DIR_ENV_KEY } from "./install-script"
import { SG_PATH_ENV_KEY, type SgResolverOptions } from "./types"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

function writeStubBinary(filePath: string, body: string): string {
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(filePath, body)
  chmodSync(filePath, 0o755)
  return filePath
}

function astGrepStub(filePath: string): string {
  return writeStubBinary(filePath, "#!/bin/sh\nprintf 'ast-grep 0.43.0\\n'\n")
}

function hostBinaryName(name: "ast-grep" | "sg"): string {
  return process.platform === "win32" ? `${name}.exe` : name
}

function setgroupsStub(filePath: string): string {
  return writeStubBinary(filePath, "#!/bin/sh\nprintf 'sg from shadow-utils 4.13\\n' >&2\nexit 1\n")
}

interface ProbeRecorder {
  readonly calls: string[]
  readonly probe: (binaryPath: string) => string
}

function recordingProbe(outputs: Record<string, string>): ProbeRecorder {
  const calls: string[] = []
  return {
    calls,
    probe: (binaryPath: string): string => {
      calls.push(binaryPath)
      const output = outputs[binaryPath]
      if (output === undefined) throw new Error(`no stub output for ${binaryPath}`)
      return output
    },
  }
}

function isolatedOptions(overrides: SgResolverOptions): SgResolverOptions {
  return {
    cache: false,
    env: {},
    homeDir: "/nonexistent-home",
    which: () => null,
    ...overrides,
  }
}

describe("resolveSgBinarySync tier order", () => {
  it("#given every tier has a candidate #when resolving #then the env override wins", () => {
    // given
    const root = tempDir("tier-env")
    const envPath = astGrepStub(join(root, "env", "sg"))
    const runtimePath = astGrepStub(join(root, "runtime", "sg"))
    const recorder = recordingProbe({ [envPath]: "ast-grep 0.43.0", [runtimePath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        env: { [SG_PATH_ENV_KEY]: envPath },
        platform: "linux",
        runtimeDir: join(root, "runtime"),
        runVersionProbeSync: recorder.probe,
      }),
    )

    // then
    expect(result.found).toBe(true)
    expect(result.found ? result.path : null).toBe(envPath)
    expect(result.found ? result.tier : null).toBe("env-override")
    expect(recorder.calls).toEqual([envPath])

    rmSync(root, { force: true, recursive: true })
  })

  it("#given no env override #when CODEX_HOME holds a runtime sg #then the OMO runtime tier resolves it", () => {
    // given
    const root = tempDir("tier-codex")
    const codexHome = join(root, "codex")
    const runtimePath = astGrepStub(join(codexHome, "runtime", "ast-grep", "linux-x64", "sg"))
    const recorder = recordingProbe({ [runtimePath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        arch: "x64",
        env: { CODEX_HOME: codexHome },
        platform: "linux",
        runVersionProbeSync: recorder.probe,
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(runtimePath)
    expect(result.found ? result.tier : null).toBe("omo-runtime")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given no CODEX_HOME #when the home OMO runtime holds sg #then the slug directory resolves it", () => {
    // given
    const root = tempDir("tier-home")
    const runtimePath = astGrepStub(join(root, ".omo", "runtime", "ast-grep", "darwin-arm64", "sg"))
    const recorder = recordingProbe({ [runtimePath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        arch: "arm64",
        homeDir: root,
        platform: "darwin",
        runVersionProbeSync: recorder.probe,
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(runtimePath)
    expect(result.found ? result.tier : null).toBe("omo-runtime")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given only the skill bin cache holds sg #when resolving #then the skill-bin tier resolves it before PATH", () => {
    // given
    const root = tempDir("tier-skillbin")
    const binDir = join(root, "skill-bin")
    const cachedPath = astGrepStub(join(binDir, "sg"))
    const pathPath = astGrepStub(join(root, "path", "sg"))
    const recorder = recordingProbe({ [cachedPath]: "ast-grep 0.43.0", [pathPath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        env: { [AST_GREP_BIN_DIR_ENV_KEY]: binDir },
        platform: "linux",
        runVersionProbeSync: recorder.probe,
        which: () => pathPath,
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(cachedPath)
    expect(result.found ? result.tier : null).toBe("skill-bin")
    expect(recorder.calls).toEqual([cachedPath])

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a package-local bin directory #when resolving #then the skill-bin tier covers its sg alias", () => {
    // given
    const root = tempDir("tier-pkgbin")
    const packageDir = join(root, "package")
    const cachedPath = astGrepStub(join(packageDir, "bin", "sg"))
    const recorder = recordingProbe({ [cachedPath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        packageDir,
        platform: "linux",
        runVersionProbeSync: recorder.probe,
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(cachedPath)
    expect(result.found ? result.tier : null).toBe("skill-bin")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given only Homebrew holds sg #when PATH is empty #then the homebrew tier resolves it last after a version probe", () => {
    // given
    const brewSg = join("/opt/homebrew/bin", "sg")
    const probed: string[] = []

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        fileExists: (filePath) => filePath === brewSg,
        platform: "darwin",
        runVersionProbeSync: (binaryPath) => {
          probed.push(binaryPath)
          return "ast-grep 0.43.0"
        },
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(brewSg)
    expect(result.found ? result.tier : null).toBe("homebrew")
    expect(probed).toEqual([brewSg])
  })

  it("#given linux #when only linuxbrew holds sg #then the linuxbrew candidate resolves and darwin-only prefixes are skipped", () => {
    // given
    const linuxbrew = join("/home/linuxbrew/.linuxbrew/bin", "sg")
    const probed: string[] = []

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        fileExists: (filePath) => filePath === linuxbrew,
        platform: "linux",
        runVersionProbeSync: (binaryPath) => {
          probed.push(binaryPath)
          return "ast-grep 0.43.0"
        },
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(linuxbrew)
    expect(probed).toEqual([linuxbrew])
  })
})

describe("resolveSgBinarySync probe-all behaviour", () => {
  it("#given the runtime candidate fails its version probe #when resolving #then the next tier is probed instead", () => {
    // given
    const root = tempDir("probe-fallthrough")
    const runtimeDir = join(root, "runtime")
    const brokenRuntime = writeStubBinary(join(runtimeDir, "sg"), "#!/bin/sh\nprintf 'not the tool\\n'\n")
    const pathPath = astGrepStub(join(root, "path", "sg"))
    const recorder = recordingProbe({ [brokenRuntime]: "some other sg 1.0", [pathPath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        platform: "linux",
        runtimeDir,
        runVersionProbeSync: recorder.probe,
        which: (commandName) => (commandName === "sg" ? pathPath : null),
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(pathPath)
    expect(recorder.calls).toEqual([brokenRuntime, pathPath])

    rmSync(root, { force: true, recursive: true })
  })

  it("#given an env override that is not ast-grep #when resolving #then it is rejected and a later tier wins", () => {
    // given
    const root = tempDir("probe-env-reject")
    const impostor = writeStubBinary(join(root, "impostor", "sg"), "#!/bin/sh\nprintf 'sg 1.0\\n'\n")
    const pathPath = astGrepStub(join(root, "path", "ast-grep"))
    const recorder = recordingProbe({ [impostor]: "sg 1.0", [pathPath]: "ast-grep 0.43.0" })

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        env: { [SG_PATH_ENV_KEY]: impostor },
        platform: "linux",
        runVersionProbeSync: recorder.probe,
        which: (commandName) => (commandName === "ast-grep" ? pathPath : null),
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(pathPath)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given PATH holds the Linux setgroups sg #when ast-grep is absent #then the impostor is rejected", () => {
    // given
    const root = tempDir("probe-setgroups")
    const setgroups = setgroupsStub(join(root, "usr-bin", "sg"))

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        platform: "linux",
        which: (commandName) => (commandName === "sg" ? setgroups : null),
      }),
    )

    // then
    expect(result.found).toBe(false)
    expect(result.found ? null : result.error.code).toBe("BINARY_NOT_FOUND")

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a real setgroups-style sg that exits non-zero #when probing #then the failure is contained and resolution continues", () => {
    // given
    const root = tempDir("probe-setgroups-real")
    const setgroups = setgroupsStub(join(root, "usr-bin", "sg"))
    const realAstGrep = astGrepStub(join(root, "brew", "ast-grep"))

    // when: default probe (real spawn) against both stubs
    const result = resolveSgBinarySync(
      isolatedOptions({
        platform: "linux",
        runVersionProbeSync:
          process.platform === "win32"
            ? (binaryPath) => {
                if (binaryPath === setgroups) throw new Error("setgroups probe failed")
                return "ast-grep 0.43.0"
              }
            : undefined,
        which: (commandName) => (commandName === "sg" ? setgroups : commandName === "ast-grep" ? realAstGrep : null),
      }),
    )

    // then
    expect(result.found ? result.path : null).toBe(realAstGrep)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given garbage candidates #when resolving #then directories, empty files and missing paths never resolve", () => {
    // given
    const root = tempDir("probe-garbage")
    const dirNamedSg = join(root, "path", "sg")
    mkdirSync(dirNamedSg, { recursive: true })
    const emptyAstGrep = join(root, "bin", "ast-grep")
    mkdirSync(join(root, "bin"), { recursive: true })
    writeFileSync(emptyAstGrep, "")

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        env: { [AST_GREP_BIN_DIR_ENV_KEY]: join(root, "bin"), [SG_PATH_ENV_KEY]: join(root, "does-not-exist") },
        platform: "linux",
        which: (commandName) => (commandName === "sg" ? dirNamedSg : null),
      }),
    )

    // then
    expect(result.found).toBe(false)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given a stub that hangs #when probing #then the 5s timeout bounds it and resolution reports not found", () => {
    // given
    const root = tempDir("probe-hang")
    const hanging = writeStubBinary(join(root, "bin", "sg"), "#!/bin/sh\nsleep 60\n")
    const startedAt = Date.now()

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        platform: "linux",
        runVersionProbeSync:
          process.platform === "win32"
            ? () => {
                const error = new Error("probe timed out") as Error & { code: string }
                error.code = "ETIMEDOUT"
                throw error
              }
            : undefined,
        which: (commandName) => (commandName === "sg" ? hanging : null),
      }),
    )
    const elapsedMs = Date.now() - startedAt

    // then
    expect(result.found).toBe(false)
    expect(elapsedMs).toBeLessThan(20_000)
    if (process.platform !== "win32") expect(elapsedMs).toBeGreaterThanOrEqual(4_000)

    rmSync(root, { force: true, recursive: true })
  }, { timeout: 30_000 })
})

describe("resolveSgBinarySync cache", () => {
  it("#given a cached resolution #when the binary still exists #then the probe is not repeated", () => {
    // given
    const root = tempDir("cache-hit")
    const cached = astGrepStub(join(root, "bin", "sg"))
    const recorder = recordingProbe({ [cached]: "ast-grep 0.43.0" })
    clearSgResolutionCache()
    const options: SgResolverOptions = {
      env: { [AST_GREP_BIN_DIR_ENV_KEY]: join(root, "bin") },
      homeDir: "/nonexistent-home",
      platform: "linux",
      runVersionProbeSync: recorder.probe,
      which: () => null,
    }

    // when
    const first = resolveSgBinarySync(options)
    const second = resolveSgBinarySync(options)

    // then
    expect(first.found ? first.path : null).toBe(cached)
    expect(second.found ? second.path : null).toBe(cached)
    expect(recorder.calls).toEqual([cached])

    clearSgResolutionCache()
    rmSync(root, { force: true, recursive: true })
  })

  it("#given a cached resolution #when the binary disappears #then the cache is invalidated and resolution re-runs", () => {
    // given
    const root = tempDir("cache-invalidate")
    const cached = astGrepStub(join(root, "bin", "sg"))
    const replacement = astGrepStub(join(root, "path", "ast-grep"))
    clearSgResolutionCache()
    const baseOptions: SgResolverOptions = {
      env: { [AST_GREP_BIN_DIR_ENV_KEY]: join(root, "bin") },
      homeDir: "/nonexistent-home",
      platform: "linux",
      runVersionProbeSync: process.platform === "win32" ? () => "ast-grep 0.43.0" : undefined,
      which: () => null,
    }

    // when
    const first = resolveSgBinarySync(baseOptions)
    rmSync(join(root, "bin"), { force: true, recursive: true })
    const second = resolveSgBinarySync({ ...baseOptions, env: {}, which: (name) => (name === "ast-grep" ? replacement : null) })

    // then
    expect(first.found ? first.path : null).toBe(cached)
    expect(second.found ? second.path : null).toBe(replacement)

    clearSgResolutionCache()
    rmSync(root, { force: true, recursive: true })
  })

  it("#given a cached resolution #when the probe spawn reports ENOENT #then the cache entry is dropped", () => {
    // given
    const root = tempDir("cache-enoent")
    const cached = astGrepStub(join(root, "bin", "sg"))
    const replacement = astGrepStub(join(root, "path", "ast-grep"))
    clearSgResolutionCache()
    let cachedProbeFails = false
    const probe = (binaryPath: string): string => {
      if (binaryPath === cached && cachedProbeFails) {
        const error = new Error("spawn ENOENT") as Error & { code: string }
        error.code = "ENOENT"
        throw error
      }
      return "ast-grep 0.43.0"
    }
    const baseOptions: SgResolverOptions = {
      env: { [AST_GREP_BIN_DIR_ENV_KEY]: join(root, "bin") },
      homeDir: "/nonexistent-home",
      platform: "linux",
      runVersionProbeSync: probe,
      which: (name) => (name === "ast-grep" ? replacement : null),
    }

    // when
    const first = resolveSgBinarySync(baseOptions)
    cachedProbeFails = true
    const second = resolveSgBinarySync({ ...baseOptions, revalidate: true })

    // then
    expect(first.found ? first.path : null).toBe(cached)
    expect(second.found ? second.path : null).toBe(replacement)

    clearSgResolutionCache()
    rmSync(root, { force: true, recursive: true })
  })
})

describe("resolveSgBinarySync failure", () => {
  it("#given nothing resolves on darwin #when resolving #then BINARY_NOT_FOUND carries brew and npm hints", () => {
    // given
    const options = isolatedOptions({ fileExists: () => false, platform: "darwin" })

    // when
    const result = resolveSgBinarySync(options)

    // then
    expect(result.found).toBe(false)
    if (result.found) throw new Error("expected failure")
    expect(result.error.code).toBe("BINARY_NOT_FOUND")
    expect(result.error.hints.join("\n")).toContain("brew install ast-grep")
    expect(result.error.hints.join("\n")).toContain("npm install -g @ast-grep/cli")
    expect(result.error.message).toContain("ast-grep")
  })

  it("#given nothing resolves on linux #when resolving #then the hints cover npm, cargo and OMO provisioning", () => {
    // given
    const options = isolatedOptions({ fileExists: () => false, platform: "linux" })

    // when
    const result = resolveSgBinarySync(options)

    // then
    if (result.found) throw new Error("expected failure")
    const hintText = result.error.hints.join("\n")
    expect(hintText).toContain("npm install -g @ast-grep/cli")
    expect(hintText).toContain("cargo install ast-grep --locked")
    expect(hintText.toLowerCase()).toContain("omo")
  })

  it("#given nothing resolves on win32 #when resolving #then the hints cover scoop, winget, chocolatey and npm", () => {
    // given
    const options = isolatedOptions({ fileExists: () => false, platform: "win32" })

    // when
    const result = resolveSgBinarySync(options)

    // then
    if (result.found) throw new Error("expected failure")
    const hintText = result.error.hints.join("\n").toLowerCase()
    expect(hintText).toContain("scoop install")
    expect(hintText).toContain("winget install")
    expect(hintText).toContain("choco install")
    expect(hintText).toContain("npm install -g @ast-grep/cli")
  })

  it("#given win32 #when candidates are enumerated #then the .exe suffix is used for runtime and cache tiers", () => {
    // given
    const probed: string[] = []

    // when
    const result = resolveSgBinarySync(
      isolatedOptions({
        arch: "x64",
        env: { [AST_GREP_BIN_DIR_ENV_KEY]: "C:\\cache", CODEX_HOME: "C:\\codex" },
        fileExists: (filePath) => {
          probed.push(filePath)
          return false
        },
        platform: "win32",
      }),
    )

    // then: path separators follow the host join, so compare on the normalized shape
    const normalized = probed.map((filePath) => filePath.replaceAll("\\", "/"))
    expect(result.found).toBe(false)
    expect(normalized).toContain("C:/codex/runtime/ast-grep/win32-x64/sg.exe")
    expect(normalized).toContain("C:/cache/ast-grep.exe")
    expect(normalized).toContain("C:/cache/sg.exe")
  })
})

describe("findSgBinarySync compatibility", () => {
  it("#given the extended resolver #when a binary resolves #then findSgBinarySync still returns the plain path", () => {
    // given
    const root = tempDir("compat-found")
    const cached = astGrepStub(join(root, "bin", hostBinaryName("sg")))

    // when
    const result = findSgBinarySync({
      cache: false,
      env: { [AST_GREP_BIN_DIR_ENV_KEY]: join(root, "bin") },
      homeDir: "/nonexistent-home",
      platform: process.platform,
      runVersionProbeSync: process.platform === "win32" ? () => "ast-grep 0.43.0" : undefined,
      which: () => null,
    })

    // then
    expect(result).toBe(cached)

    rmSync(root, { force: true, recursive: true })
  })

  it("#given nothing resolves #when findSgBinarySync runs #then it returns null instead of throwing", () => {
    // given
    const options = isolatedOptions({ fileExists: () => false, platform: "linux" })

    // when
    const result = findSgBinarySync(options)

    // then
    expect(result).toBeNull()
  })
})
