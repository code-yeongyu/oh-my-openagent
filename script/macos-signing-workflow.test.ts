/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"
import { z } from "zod"

import { runBlock } from "./release-workflow-test-steps"

const workflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)
const signingScript = new URL("../.github/scripts/macos-sign-and-notarize.sh", import.meta.url)
const entitlements = new URL("../.github/scripts/omo-bun-executable.entitlements", import.meta.url)
const signingMaterial = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]

const stepsSchema = z.array(z.object({ name: z.string().optional(), if: z.string().optional() }))
const jobs = z.object({ jobs: z.object({
  "desktop-engine": z.object({ steps: stepsSchema }),
  build: z.object({ steps: stepsSchema }),
}) }).parse(load(readFileSync(workflowPath, "utf8"))).jobs

function stepIndex(steps: z.infer<typeof stepsSchema>, name: string): number {
  const index = steps.findIndex((step) => step.name === name)
  if (index < 0) throw new Error(`missing workflow step: ${name}`)
  return index
}

/** A repo-shaped sandbox whose `codesign` appends bytes, like a real signature, and logs each call. */
function sandbox(): { root: string; calls: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "omo-macos-signing-"))
  mkdirSync(join(root, ".github", "scripts"), { recursive: true })
  copyFileSync(signingScript, join(root, ".github", "scripts", "macos-sign-and-notarize.sh"))
  copyFileSync(entitlements, join(root, ".github", "scripts", "omo-bun-executable.entitlements"))
  const bin = join(root, "bin")
  mkdirSync(bin)
  const calls = join(root, "codesign-calls")
  writeFileSync(join(bin, "codesign"), `#!/bin/bash\necho "$*" >> "${calls}"\nif [ "$1" = --force ]; then printf 'signature' >> "\${@: -1}"; fi\n`)
  chmodSync(join(bin, "codesign"), 0o755)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` }
  for (const name of [...signingMaterial, "MACOS_SIGNING_REQUIRED"]) delete env[name]
  return { root, calls, env }
}

describe("macOS signing in the platform publish workflow", () => {
  test("signs each Darwin binary after it is built and before it is smoked or uploaded", () => {
    const build = jobs.build.steps
    const sign = stepIndex(build, "Sign and notarize Darwin release binary")
    expect(stepIndex(build, "Build release binary")).toBeLessThan(sign)
    expect(sign).toBeLessThan(stepIndex(build, "Smoke test release binary"))
    expect(sign).toBeLessThan(stepIndex(build, "Upload release binary artifact"))
    expect(build[sign]?.if).toContain("startsWith(matrix.platform, 'darwin-')")

    const engine = jobs["desktop-engine"].steps
    const signEngine = stepIndex(engine, "Sign and notarize Darwin desktop engine")
    expect(stepIndex(engine, "Stage desktop engine release asset")).toBeLessThan(signEngine)
    expect(signEngine).toBeLessThan(stepIndex(engine, "Upload desktop engine artifact"))
    expect(engine[signEngine]?.if).toContain("startsWith(matrix.host, 'darwin-')")
  })

  test("the release digest describes the signed bytes, not the unsigned build output", () => {
    const { root, env } = sandbox()
    try {
      const binaries = join(root, ".omo", "release-binaries")
      mkdirSync(binaries, { recursive: true })
      writeFileSync(join(binaries, "omo-darwin-arm64"), "unsigned build output")
      writeFileSync(join(binaries, "SHA256SUMS"), "stale  omo-darwin-arm64\n")
      const workflow = readFileSync(workflowPath, "utf8")
      const step = runBlock(workflow, "      - name: Sign and notarize Darwin release binary\n", "      - name: Smoke test release binary\n")

      const result = spawnSync("bash", ["-e", "-c", step], { cwd: root, env: { ...env, BINARY: "omo-darwin-arm64" }, encoding: "utf8" })

      expect(result.status, result.stderr).toBe(0)
      const signed = readFileSync(join(binaries, "omo-darwin-arm64"))
      expect(signed.toString()).toBe("unsigned build outputsignature")
      const digest = createHash("sha256").update(signed).digest("hex")
      expect(readFileSync(join(binaries, "SHA256SUMS"), "utf8")).toBe(`${digest}  omo-darwin-arm64\n`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("refuses to ship an unsigned binary when signing is required and material is missing", () => {
    const { root, calls, env } = sandbox()
    try {
      const binary = join(root, "omo-darwin-arm64")
      writeFileSync(binary, "unsigned build output")

      const result = spawnSync("bash", [join(root, ".github", "scripts", "macos-sign-and-notarize.sh"), "--identifier", "ai.sisyphuslabs.omo", binary], {
        cwd: root,
        env: { ...env, MACOS_SIGNING_REQUIRED: "true", CSC_LINK: "present" },
        encoding: "utf8",
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain("CSC_KEY_PASSWORD")
      expect(existsSync(calls)).toBe(false)
      expect(readFileSync(binary, "utf8")).toBe("unsigned build output")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
