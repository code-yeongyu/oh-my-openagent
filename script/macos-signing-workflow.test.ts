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
// Two gates, each with its reason. Tests that run the signing script against a stubbed macOS toolchain need POSIX bash:
// the script only ever runs on macOS runners, and under Windows bash the PATH stubs cannot shadow the real tools.
// Argument parsing exits before any tool is touched, so it is checked on every platform with a working bash.
const bashRuns = spawnSync("bash", ["-c", "exit 0"]).status === 0
const posixBashTest = test.skipIf(process.platform === "win32" || !bashRuns)
const anyBashTest = test.skipIf(!bashRuns)

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

  posixBashTest("the release digest describes the signed bytes, not the unsigned build output", () => {
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

  posixBashTest("refuses to ship an unsigned binary when signing is required and material is missing", () => {
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

/** Fake macOS toolchain: a signing keychain, codesign, a notarytool whose `info` answers from a script, and spctl. */
function notarySandbox(infoAnswers: readonly string[]): { root: string; env: NodeJS.ProcessEnv; binary: string } {
  const { root, env } = sandbox()
  const bin = join(root, "bin")
  const answers = join(root, "info-answers")
  writeFileSync(answers, `${infoAnswers.join("\n")}\n`)
  writeFileSync(join(bin, "security"), `#!/bin/bash
case "$1" in
  list-keychains) echo '    "/login.keychain-db"' ;;
  find-identity) echo '  1) ABCDEF "Developer ID Application: Test (TEAM123456)"' ;;
esac
exit 0
`)
  writeFileSync(join(bin, "codesign"), `#!/bin/bash
if [ "$1" = -dv ]; then echo "flags=0x10000(runtime) TeamIdentifier=TEAM123456" >&2; fi
exit 0
`)
  writeFileSync(join(bin, "xcrun"), `#!/bin/bash
shift
case "$1" in
  submit) echo '{"id":"sub-1"}' ;;
  info)
    line=$(head -n 1 "${answers}"); sed -i.bak 1d "${answers}"
    [ "$line" = FAIL ] && { echo "The request timed out." >&2; exit 1; }
    echo "{\\"id\\":\\"sub-1\\",\\"status\\":\\"$line\\"}" ;;
  log) echo '{"issues":[]}' ;;
esac
`)
  writeFileSync(join(bin, "spctl"), `#!/bin/bash
echo "accepted source=Notarized Developer ID"
`)
  writeFileSync(join(bin, "ditto"), `#!/bin/bash
find "\${@: -2:1}" -type f -exec cat {} \\; -exec echo \\; > "${root}/archived-files"
touch "\${@: -1}"
`)
  for (const tool of ["security", "codesign", "xcrun", "spctl", "ditto"]) chmodSync(join(bin, tool), 0o755)
  const binary = join(root, "omo-darwin-arm64")
  writeFileSync(binary, "binary")
  const material = { CSC_LINK: Buffer.from("p12").toString("base64"), CSC_KEY_PASSWORD: "pw", APPLE_API_KEY: "key", APPLE_API_KEY_ID: "KEY", APPLE_API_ISSUER: "issuer" }
  return { root, binary, env: { ...env, ...material, RUNNER_TEMP: root, NOTARY_POLL_SECONDS: "0", NOTARY_TIMEOUT_SECONDS: "30" } }
}

function runSigning(root: string, env: NodeJS.ProcessEnv, binary: string) {
  return spawnSync("bash", [join(root, ".github", "scripts", "macos-sign-and-notarize.sh"), "--identifier", "ai.sisyphuslabs.omo", binary], { cwd: root, env, encoding: "utf8" })
}

/** Feeds the script through stdin, so a CRLF checkout on Windows parses as the LF file the macOS runners execute. */
function runSigningArgs(args: readonly string[]) {
  const script = readFileSync(signingScript, "utf8").replace(/\r\n/g, "\n")
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of [...signingMaterial, "MACOS_SIGNING_REQUIRED"]) delete env[name]
  return spawnSync("bash", ["-s", "--", ...args], { cwd: tmpdir(), env, input: script, encoding: "utf8" })
}

describe("signing script arguments", () => {
  // Guards the CLI contract the publish workflow calls: bad invocations exit 2 with a reason, before any signing tool runs.
  anyBashTest("rejects a missing identifier or file list, an unknown option, and a missing file", () => {
    const cases = [
      [[], "usage:"],
      [["--identifier", "ai.sisyphuslabs.omo"], "usage:"],
      [["--identifier", "ai.sisyphuslabs.omo", "--bogus"], "unknown option: --bogus"],
      [["--identifier", "ai.sisyphuslabs.omo", "omo-no-such-binary"], "not a file: omo-no-such-binary"],
    ] as const
    for (const [args, reason] of cases) {
      const result = runSigningArgs(args)
      expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(2)
      expect(result.stderr).toContain(reason)
    }
  })
})

describe("notarization polling", () => {
  posixBashTest("submits every input even when two share a basename", () => {
    const { root, env, binary } = notarySandbox(["Accepted"])
    try {
      mkdirSync(join(root, "arm64"))
      mkdirSync(join(root, "amd64"))
      const arm = join(root, "arm64", "comment-checker")
      const amd = join(root, "amd64", "comment-checker")
      writeFileSync(arm, "arm64 build")
      writeFileSync(amd, "amd64 build")
      rmSync(binary)
      const result = spawnSync("bash", [join(root, ".github", "scripts", "macos-sign-and-notarize.sh"), "--identifier", "ai.sisyphuslabs.comment-checker", arm, amd], { cwd: root, env, encoding: "utf8" })
      expect(result.status, result.stderr).toBe(0)
      const archived = readFileSync(join(root, "archived-files"), "utf8").trim().split("\n")
      expect(archived).toHaveLength(2)
      expect(archived.sort()).toEqual(["amd64 build", "arm64 build"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  posixBashTest("keeps polling through transient notarytool errors until Apple accepts", () => {
    const { root, env, binary } = notarySandbox(["FAIL", "In Progress", "FAIL", "Accepted"])
    try {
      const result = runSigning(root, env, binary)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain("notarization sub-1: Accepted")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  posixBashTest("fails when Apple rejects the submission", () => {
    const { root, env, binary } = notarySandbox(["In Progress", "Invalid"])
    try {
      const result = runSigning(root, env, binary)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("notarization was not accepted (status: Invalid)")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
