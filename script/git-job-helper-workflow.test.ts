/// <reference types="bun-types" />

// Release contract (omo#10391): the git job helper is built on the two Windows hosts only (unsigned, static CRT, its
// own cargo call), carried in the desktop-engine artifact, and staged into the compiled payload so its sha256 lands in
// the runtime manifest.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runBlock, sliceWorkflowSection } from "./release-workflow-test-steps"

const workflow = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const engine = sliceWorkflowSection(workflow, "  desktop-engine:\n", "  build:\n")
const platformBuild = sliceWorkflowSection(workflow, "  build:\n", "  publish:\n")
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const parity = sliceWorkflowSection(ciWorkflow, "  native-binary-parity:\n", "      - name: Compare the binary with the npm launcher\n")
const buildMarker = "      - name: Build git job helper\n"
const afterBuildMarker = "      - name: Build engine trust helper\n"
const resolveMarker = "      - name: Resolve git job helper availability\n"
const stageMarker = "      - name: Stage git job helper for compiled payload\n"
const afterStageMarker = "      - name: Stage engine trust helper for compiled payload\n"
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe("git job helper release build", () => {
  test("builds on the Windows hosts only, with a static CRT, in its own cargo call and without signing material", () => {
    const step = sliceWorkflowSection(engine, buildMarker, afterBuildMarker)
    const run = runBlock(engine, buildMarker, afterBuildMarker)

    expect(step).toContain("if: startsWith(matrix.host, 'win32-')\n")
    expect(step).toContain("RUSTFLAGS: -C target-feature=+crt-static")
    expect(run).toContain('cargo build --release -p omo-git-job-helper --locked --target "$RUST_TARGET"')
    for (const name of ["CSC_LINK", "APPLE_API_KEY", "macos-sign-and-notarize.sh"]) expect(step).not.toContain(name)
  })

  posixBashTest("stages the build under a host directory and refuses bytes whose selftest does not pass", () => {
    const run = runBlock(engine, buildMarker, afterBuildMarker)
    const attempt = (selftest: string): { status: number | null; staged: string } => {
      const root = scratch("omo-git-job-helper-build-")
      try {
        const bin = join(root, "bin")
        mkdirSync(bin)
        const built = join(root, "built-helper")
        writeFileSync(built, `#!/bin/bash\n${selftest}\n`)
        chmodSync(built, 0o755)
        writeFileSync(join(bin, "cargo"), `#!/bin/bash\nmkdir -p "target/$RUST_TARGET/release"\ncp "${built}" "target/$RUST_TARGET/release/omo-git-job-helper.exe"\n`)
        chmodSync(join(bin, "cargo"), 0o755)
        const result = spawnSync("bash", ["-e", "-c", run], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, HOST: "win32-arm64", RUST_TARGET: "aarch64-pc-windows-msvc" },
          encoding: "utf8",
        })
        const staged = join(root, ".omo", "desktop-engine-assets", "git-job-helper-win32-arm64", "omo-git-job-helper.exe")
        return { status: result.status, staged: existsSync(staged) ? readFileSync(staged, "utf8") : "" }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }

    const passing = attempt("echo 'selftest ok elevated=1 integrity=0x3000'")
    expect(passing.status).toBe(0)
    expect(passing.staged).toContain("selftest ok")
    expect(attempt("echo 'selftest failed assign 5'; exit 18").status).not.toBe(0)
  })

  test("uploads the helper in the desktop-engine artifact under its host directory", () => {
    const upload = sliceWorkflowSection(engine, "      - name: Upload desktop engine artifact\n", "      - name: Write job summary\n")
    expect(upload).toContain(".omo/desktop-engine-assets/git-job-helper-*/omo-git-job-helper*\n")
  })
})

describe("git job helper transport into the compiled payload", () => {
  posixBashTest("resolves the helper for the Windows targets and nothing elsewhere", () => {
    const run = runBlock(platformBuild, resolveMarker, stageMarker)
    const resolve = (platform: string): string => {
      const root = scratch("omo-git-job-helper-resolve-")
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

    expect(resolve("windows-x64-baseline")).toBe([
      "host=win32-x64",
      "asset=git-job-helper-win32-x64/omo-git-job-helper.exe",
      "source=target/x86_64-pc-windows-msvc/release/omo-git-job-helper.exe",
      "",
    ].join("\n"))
    expect(resolve("darwin-arm64")).toBe("host=\nasset=\nsource=\n")
    expect(resolve("linux-x64")).toBe("host=\nasset=\nsource=\n")
  }, 60_000)

  posixBashTest("copies the downloaded helper into its Rust source path, and fails when the promised helper is absent", () => {
    const root = scratch("omo-git-job-helper-stage-")
    try {
      const run = runBlock(platformBuild, stageMarker, afterStageMarker)
      const asset = "git-job-helper-win32-arm64/omo-git-job-helper.exe"
      const source = "target/aarch64-pc-windows-msvc/release/omo-git-job-helper.exe"
      const env = { ...process.env, HELPER_ASSET: asset, HELPER_SOURCE: source }

      expect(spawnSync("bash", ["-e", "-c", run], { cwd: root, env, encoding: "utf8" }).status).not.toBe(0)
      expect(existsSync(join(root, source))).toBe(false)

      mkdirSync(join(root, ".omo", "desktop-engine-assets", "git-job-helper-win32-arm64"), { recursive: true })
      writeFileSync(join(root, ".omo", "desktop-engine-assets", asset), "release helper")
      const staged = spawnSync("bash", ["-e", "-c", run], { cwd: root, env, encoding: "utf8" })
      expect(staged.status, staged.stderr).toBe(0)
      expect(readFileSync(join(root, source), "utf8")).toBe("release helper")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("the native binary parity job builds the helper for its Windows binary only, with the release CRT linkage", () => {
    const run = runBlock(parity, "      - name: Build the desktop engine the binary embeds\n", "      - name: Build the standalone binary and the npm launcher payload\n")
    const gate = run.indexOf('if [[ "${{ matrix.target }}" == windows-* ]]; then')
    const helper = run.indexOf('RUSTFLAGS="-C target-feature=+crt-static" cargo build --release -p omo-git-job-helper --locked --target ${{ matrix.rust-target }}')

    expect(gate).toBeGreaterThanOrEqual(0)
    // Static CRT, as publish-platform builds the released bytes: the parity binary embeds the same helper.
    expect(helper).toBeGreaterThan(gate)
  })
})
