/// <reference types="bun-types" />

// Release contract (omo#10762): the engine trust helper is built on the four Darwin and Windows hosts, signed on
// Darwin only (Windows ships unsigned, like the engine), carried in the desktop-engine artifact, and staged into
// the compiled payload so its sha256 lands in the runtime manifest.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runBlock, sliceWorkflowSection } from "./release-workflow-test-steps"

const workflow = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const signingScript = new URL("../.github/scripts/macos-sign-and-notarize.sh", import.meta.url)
const engine = sliceWorkflowSection(workflow, "  desktop-engine:\n", "  build:\n")
const platformBuild = sliceWorkflowSection(workflow, "  build:\n", "  publish:\n")
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const parity = sliceWorkflowSection(ciWorkflow, "  native-binary-parity:\n", "      - name: Compare the binary with the npm launcher\n")
const parityEngineMarker = "      - name: Build the desktop engine the binary embeds\n"
const parityBinaryMarker = "      - name: Build the standalone binary and the npm launcher payload\n"
const buildMarker = "      - name: Build engine trust helper\n"
const signMarker = "      - name: Sign Darwin engine trust helper\n"
const smokeMarker = "      - name: Smoke signed Darwin engine trust helper\n"
const afterSmokeMarker = "      - name: Sign and notarize Darwin desktop engine\n"
const afterSignMarker = smokeMarker
const uploadMarker = "      - name: Upload desktop engine artifact\n"
const resolveMarker = "      - name: Resolve engine trust helper availability\n"
const afterResolveMarker = "      - name: Download desktop engine for compiled payload\n"
const stageMarker = "      - name: Stage engine trust helper for compiled payload\n"
const afterStageMarker = "      - name: Stage target-specific Rust engine for compiled payload\n"
const identifier = "ai.sisyphuslabs.omo-engine-trust-helper"
const material = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const
const bashRuns = spawnSync("bash", ["-c", "exit 0"]).status === 0
// The run blocks below execute against PATH stubs, which Windows bash cannot shadow reliably.
const posixBashTest = test.skipIf(process.platform === "win32" || !bashRuns)

function stub(bin: string, name: string, body: string): void {
  writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
}

describe("engine trust helper release build", () => {
  test("builds the helper with the pinned Rust target on the Darwin and Windows hosts only, without signing material", () => {
    const step = sliceWorkflowSection(engine, buildMarker, signMarker)
    const run = runBlock(engine, buildMarker, signMarker)

    expect(step).toContain("if: startsWith(matrix.host, 'darwin-') || startsWith(matrix.host, 'win32-')")
    expect(step).toContain("RUST_TARGET: ${{ matrix.rust_target }}")
    expect(run).toContain('cargo build --release -p omo-engine-trust-helper --locked --target "$RUST_TARGET"')
    // Windows is unsigned by ruling: the shared build step never sees signing material or the signer.
    for (const name of material) expect(step).not.toContain(name)
    expect(run).not.toContain("macos-sign-and-notarize.sh")
  })

  posixBashTest("stages the Windows build next to the engine asset without signing it", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-trust-helper-build-"))
    try {
      const bin = join(root, "bin")
      mkdirSync(bin)
      const calls = join(root, "calls")
      stub(bin, "cargo", `echo "cargo $*" >> "${calls}"\nmkdir -p "target/$RUST_TARGET/release"\nprintf 'pe-image' > "target/$RUST_TARGET/release/omo-engine-trust-helper.exe"`)
      stub(bin, "codesign", `echo "codesign $*" >> "${calls}"`)

      const result = spawnSync("bash", ["-e", "-c", runBlock(engine, buildMarker, signMarker)], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, HOST: "win32-arm64", RUST_TARGET: "aarch64-pc-windows-msvc" },
        encoding: "utf8",
      })

      expect(result.status, result.stderr).toBe(0)
      const staged = join(root, ".omo", "desktop-engine-assets", "engine-trust-helper-win32-arm64", "omo-engine-trust-helper.exe")
      expect(readFileSync(staged, "utf8")).toBe("pe-image")
      expect(readFileSync(calls, "utf8")).toBe("cargo build --release -p omo-engine-trust-helper --locked --target aarch64-pc-windows-msvc\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("Darwin engine trust helper signing", () => {
  test("signs the staged helper under its own identifier, sign-only, then verifies the signature", () => {
    const step = sliceWorkflowSection(engine, signMarker, afterSignMarker)
    const run = runBlock(engine, signMarker, afterSignMarker)

    expect(step).toContain("if: startsWith(matrix.host, 'darwin-')")
    for (const name of material) expect(step).toContain(`${name}: \${{ secrets.${name} }}`)
    expect(step).toContain("MACOS_SIGNING_REQUIRED: ${{ vars.MACOS_SIGNING_REQUIRED }}")
    expect(run).toContain("set -euo pipefail")
    expect(run).toMatch(new RegExp(`--sign-only \\\\\\n\\s*--identifier ${identifier.replaceAll(".", "\\.")} "\\$HELPER"`))
    const sign = run.indexOf("bash .github/scripts/macos-sign-and-notarize.sh")
    const verify = run.indexOf('codesign -dv --verbose=2 "$HELPER"')
    expect(sign).toBeGreaterThanOrEqual(0)
    expect(verify).toBeGreaterThan(sign)
    expect(run).toContain(`grep -qx "Identifier=${identifier}"`)
  })

  for (const missing of material) {
    posixBashTest(`refuses to sign or ship the helper when signing is required and ${missing} is missing`, () => {
      const root = mkdtempSync(join(tmpdir(), "omo-trust-helper-signing-"))
      try {
        mkdirSync(join(root, ".github", "scripts"), { recursive: true })
        copyFileSync(signingScript, join(root, ".github", "scripts", "macos-sign-and-notarize.sh"))
        const helperDir = join(root, ".omo", "desktop-engine-assets", "engine-trust-helper-darwin-arm64")
        mkdirSync(helperDir, { recursive: true })
        const helper = join(helperDir, "omo-engine-trust-helper")
        writeFileSync(helper, "unsigned helper")
        const bin = join(root, "bin")
        mkdirSync(bin)
        const calls = join(root, "codesign-calls")
        stub(bin, "codesign", `echo "$*" >> "${calls}"`)
        const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, MACOS_SIGNING_REQUIRED: "true", HOST: "darwin-arm64" }
        for (const name of material) env[name] = "synthetic"
        delete env[missing]

        const result = spawnSync("bash", ["-e", "-c", runBlock(engine, signMarker, afterSignMarker)], { cwd: root, env, encoding: "utf8" })

        expect(result.status).toBe(1)
        expect(result.stderr).toContain(`signing material is missing: ${missing}`)
        // No ad-hoc fallback: codesign never ran and the bytes are untouched.
        expect(existsSync(calls)).toBe(false)
        expect(readFileSync(helper, "utf8")).toBe("unsigned helper")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
})

describe("signed Darwin engine trust helper smoke", () => {
  const sources = ["trust-settings-user", "trust-settings-admin", "trust-settings-system", "keychain-search-list"]
  const minimalDocument = JSON.stringify({
    schema: 1, os: "macos", complete: true, certificates: [],
    sources: sources.map((name) => ({ name, outcome: "read", status: 0 })),
  })

  test("runs on Darwin hosts only, after signing and before the artifact upload", () => {
    const step = sliceWorkflowSection(engine, smokeMarker, afterSmokeMarker)

    expect(engine.indexOf(signMarker)).toBeLessThan(engine.indexOf(smokeMarker))
    expect(engine.indexOf(smokeMarker)).toBeLessThan(engine.indexOf(uploadMarker))
    expect(step).toContain("if: startsWith(matrix.host, 'darwin-')\n")
  })

  /** Runs the real step in a scratch root that sees the repo's decoder, with the helper (and `arch`) stubbed. */
  function smoke(host: string, helperBody: string): { status: number | null; stderr: string; archCalls: string } {
    const root = mkdtempSync(join(tmpdir(), "omo-trust-helper-smoke-"))
    try {
      const repo = new URL("..", import.meta.url).pathname
      symlinkSync(join(repo, "script"), join(root, "script"))
      symlinkSync(join(repo, "packages"), join(root, "packages"))
      const helperDir = join(root, ".omo", "desktop-engine-assets", `engine-trust-helper-${host}`)
      mkdirSync(helperDir, { recursive: true })
      stub(helperDir, "omo-engine-trust-helper", helperBody)
      const bin = join(root, "bin")
      mkdirSync(bin)
      const archLog = join(root, "arch-calls")
      stub(bin, "arch", `echo "$*" >> "${archLog}"\nshift\nexec "$@"`)
      const result = spawnSync("bash", ["-e", "-c", runBlock(engine, smokeMarker, afterSmokeMarker)], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, HOST: host, RUNNER_TEMP: root },
        encoding: "utf8",
        timeout: 20_000,
      })
      return { status: result.status, stderr: result.stderr, archCalls: existsSync(archLog) ? readFileSync(archLog, "utf8") : "" }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  posixBashTest("passes output the strict decoder accepts, natively on arm64 and under Rosetta on x64", () => {
    const helper = `cat > /dev/null\nprintf '%s' '${minimalDocument}'`

    const arm64 = smoke("darwin-arm64", helper)
    expect(arm64.status, arm64.stderr).toBe(0)
    expect(arm64.archCalls).toBe("")

    const x64 = smoke("darwin-x64", helper)
    expect(x64.status, x64.stderr).toBe(0)
    expect(x64.archCalls).toEndWith("-x86_64 .omo/desktop-engine-assets/engine-trust-helper-darwin-x64/omo-engine-trust-helper\n")
  }, 60_000)

  posixBashTest("fails on malformed output or a non-zero helper exit", () => {
    const wrongSchema = smoke("darwin-arm64", `printf '%s' '${minimalDocument.replace('"schema":1', '"schema":2')}'`)
    expect(wrongSchema.status).not.toBe(0)
    expect(wrongSchema.stderr).toContain("invalid-value at $.schema")

    expect(smoke("darwin-arm64", "printf 'not json'").status).not.toBe(0)
    expect(smoke("darwin-arm64", `printf '%s' '${minimalDocument}'\nexit 75`).status).not.toBe(0)
  }, 60_000)
})

describe("engine trust helper transport into the compiled payload", () => {
  test("uploads the helper in the desktop-engine artifact under a host directory, outside the release asset globs", () => {
    const upload = sliceWorkflowSection(engine, uploadMarker, "      - name: Write job summary\n")

    expect(upload).toContain("name: desktop-engine-${{ matrix.host }}")
    expect(upload).toContain(".omo/desktop-engine-assets/senpi-desktop-engine-*\n")
    expect(upload).toContain(".omo/desktop-engine-assets/engine-trust-helper-*/omo-engine-trust-helper*\n")
  })

  posixBashTest("resolves the helper for Darwin and Windows targets and nothing for Linux", () => {
    const run = runBlock(platformBuild, resolveMarker, afterResolveMarker)
    const resolve = (platform: string): string => {
      const root = mkdtempSync(join(tmpdir(), "omo-trust-helper-resolve-"))
      try {
        const output = join(root, "output")
        const result = spawnSync("bash", ["-e", "-c", run], {
          cwd: new URL("..", import.meta.url),
          env: { ...process.env, PLATFORM: platform, GITHUB_OUTPUT: output },
          encoding: "utf8",
          timeout: 20_000,
        })
        expect(result.status, result.stderr).toBe(0)
        return readFileSync(output, "utf8")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }

    expect(resolve("darwin-x64-baseline")).toBe([
      "host=darwin-x64",
      "asset=engine-trust-helper-darwin-x64/omo-engine-trust-helper",
      "source=target/x86_64-apple-darwin/release/omo-engine-trust-helper",
      "",
    ].join("\n"))
    expect(resolve("windows-arm64")).toBe([
      "host=win32-arm64",
      "asset=engine-trust-helper-win32-arm64/omo-engine-trust-helper.exe",
      "source=target/aarch64-pc-windows-msvc/release/omo-engine-trust-helper.exe",
      "",
    ].join("\n"))
    expect(resolve("linux-x64")).toBe("host=\nasset=\nsource=\n")
  }, 60_000)

  posixBashTest("copies the downloaded helper into its Rust source path, and fails when the promised helper is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-trust-helper-stage-"))
    try {
      const run = runBlock(platformBuild, stageMarker, afterStageMarker)
      const asset = "engine-trust-helper-darwin-arm64/omo-engine-trust-helper"
      const source = "target/aarch64-apple-darwin/release/omo-engine-trust-helper"
      const env = { ...process.env, HELPER_ASSET: asset, HELPER_SOURCE: source }

      const missing = spawnSync("bash", ["-e", "-c", run], { cwd: root, env, encoding: "utf8" })
      expect(missing.status).not.toBe(0)
      expect(existsSync(join(root, source))).toBe(false)

      mkdirSync(join(root, ".omo", "desktop-engine-assets", "engine-trust-helper-darwin-arm64"), { recursive: true })
      writeFileSync(join(root, ".omo", "desktop-engine-assets", asset), "signed helper")
      const staged = spawnSync("bash", ["-e", "-c", run], { cwd: root, env, encoding: "utf8" })
      expect(staged.status, staged.stderr).toBe(0)
      expect(readFileSync(join(root, source), "utf8")).toBe("signed helper")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ci.yml's native-binary-parity job compiles the release binary for darwin-arm64 and windows-x64, where
// build-omo-binary.ts refuses a payload without the helper; the job must build it, in its own cargo call
// (a shared call unifies dependency features and builds an engine release never ships).
describe("native binary parity job", () => {
  test("builds the engine trust helper for the parity binary in a separate cargo call", () => {
    const run = runBlock(parity, parityEngineMarker, parityBinaryMarker)
    const engine = run.indexOf("cargo build --release -p senpi-desktop-engine --locked --target ${{ matrix.rust-target }}")
    const helper = run.indexOf("cargo build --release -p omo-engine-trust-helper --locked --target ${{ matrix.rust-target }}")

    expect(engine).toBeGreaterThanOrEqual(0)
    expect(helper).toBeGreaterThan(engine)
    expect(parity).toContain("target: darwin-arm64")
    expect(parity).toContain("target: windows-x64")
  })
})
