/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runBlock, sliceWorkflowSection } from "./release-workflow-test-steps"

const workflow = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n")
const engine = sliceWorkflowSection(workflow, "  desktop-engine:\n", "  build:\n")
const helperMarker = "      - name: Build and sign Darwin capture helper\n"
const engineMarker = "      - name: Build desktop engine\n"
const signingMarker = "      - name: Sign and notarize Darwin desktop engine\n"
const material = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const

describe("embedded macOS capture helper release workflow", () => {
  test("compiles both Darwin architectures with the development helper flags", () => {
    const helper = sliceWorkflowSection(engine, helperMarker, engineMarker)
    const run = runBlock(engine, helperMarker, engineMarker)

    expect(engine).toMatch(/host: darwin-arm64,[^\n]*rust_target: aarch64-apple-darwin, clang_arch: arm64/)
    expect(engine).toMatch(/host: darwin-x64,[^\n]*rust_target: x86_64-apple-darwin, clang_arch: x86_64/)
    expect(helper).toContain("if: startsWith(matrix.host, 'darwin-')")
    expect(helper).toContain("CLANG_ARCH: ${{ matrix.clang_arch }}")
    expect(run).toContain('/usr/bin/clang -arch "$CLANG_ARCH"')
    for (const flag of ["-x objective-c", "-std=c11", "-fobjc-arc", "-O2", "-Wall", "-mmacosx-version-min=13.0",
      "-framework AppKit", "-framework ScreenCaptureKit", "-framework CoreVideo"]) {
      expect(run).toContain(flag)
    }
    expect(run).toContain("crates/senpi-desktop-backend-macos/native/senpi-desktop-capture-helper.m")
    expect(run).toContain('-o "$HELPER"')
  })

  test("signs the helper under the engine identity and policy before exporting the embedding directory", () => {
    const helper = sliceWorkflowSection(engine, helperMarker, engineMarker)
    const signEngine = sliceWorkflowSection(engine, signingMarker, "      - name: Upload desktop engine artifact\n")
    const run = runBlock(engine, helperMarker, engineMarker)

    for (const name of material) {
      const binding = `${name}: \${{ secrets.${name} }}`
      expect(helper).toContain(binding)
      expect(signEngine).toContain(binding)
    }
    expect(helper).toContain("MACOS_SIGNING_REQUIRED: ${{ vars.MACOS_SIGNING_REQUIRED }}")
    expect(signEngine).toContain("MACOS_SIGNING_REQUIRED: ${{ vars.MACOS_SIGNING_REQUIRED }}")
    expect(run).toContain("set -euo pipefail")
    expect(run).toContain('HELPER="${HELPER_DIR}/senpi-desktop-capture-helper"')
    const sign = run.indexOf("bash .github/scripts/macos-sign-and-notarize.sh")
    const verify = run.indexOf('test -s "$HELPER"')
    const exported = run.indexOf('echo "SENPI_DESKTOP_CAPTURE_HELPER_SIGNED=$HELPER_DIR" >> "$GITHUB_ENV"')
    expect(sign).toBeGreaterThan(run.indexOf("/usr/bin/clang"))
    expect(run).toMatch(/--sign-only \\\n\s*--identifier ai\.sisyphuslabs\.senpi-desktop-engine "\$HELPER"/)
    expect(run).toContain('grep -qx "Identifier=ai.sisyphuslabs.senpi-desktop-engine"')
    expect(run).not.toContain("senpi-desktop-capture-helper\" --")
    expect(signEngine).toContain("--identifier ai.sisyphuslabs.senpi-desktop-engine")
    expect(verify).toBeGreaterThan(sign)
    expect(exported).toBeGreaterThan(verify)
    expect(engine).toContain('run: cargo build --release -p senpi-desktop-engine --locked --target "${{ matrix.rust_target }}"')
    expect(engine.indexOf(engineMarker)).toBeLessThan(engine.indexOf(signingMarker))
  })

  test("signs the dev helper, the release helper and the engine with one identifier", () => {
    const buildScript = readFileSync(new URL("../crates/senpi-desktop-backend-macos/build.rs", import.meta.url), "utf8")
    const devIdentifier = buildScript.match(/\.arg\("--identifier"\)\s*\.arg\("([^"]+)"\)/)?.[1]
    const helperIdentifier = runBlock(engine, helperMarker, engineMarker).match(/--identifier (\S+) "\$HELPER"/)?.[1]
    const engineIdentifier = sliceWorkflowSection(engine, signingMarker, "      - name: Upload desktop engine artifact\n")
      .match(/--identifier (\S+) "\$ASSET"/)?.[1]

    expect(devIdentifier).toBeDefined()
    expect(helperIdentifier).toBe(devIdentifier)
    expect(engineIdentifier).toBe(devIdentifier)
  })

  for (const missing of material) {
    test(`refuses helper signing when ${missing} is missing`, () => {
      const root = mkdtempSync(join(tmpdir(), "omo-helper-signing-"))
      const binary = join(root, "senpi-desktop-capture-helper")
      const env: NodeJS.ProcessEnv = { ...process.env, MACOS_SIGNING_REQUIRED: "true" }
      for (const name of material) env[name] = "synthetic"
      delete env[missing]
      writeFileSync(binary, "unsigned helper")
      try {
        const script = readFileSync(new URL("../.github/scripts/macos-sign-and-notarize.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n")
        const result = spawnSync("bash", ["-s", "--", "--sign-only", "--identifier", "ai.sisyphuslabs.senpi-desktop-engine", binary], {
          input: script, env, encoding: "utf8",
        })

        expect(result.status, result.stderr).toBe(1)
        expect(result.stderr).toContain(`signing material is missing: ${missing}`)
        expect(readFileSync(binary, "utf8")).toBe("unsigned helper")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
})
