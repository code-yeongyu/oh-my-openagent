/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const signingScript = new URL("../.github/scripts/macos-sign-and-notarize.sh", import.meta.url)
const signingMaterial = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]
// The signing script only runs on macOS runners; under Windows bash the PATH stubs cannot shadow the real tools.
const bashRuns = spawnSync("bash", ["-c", "exit 0"]).status === 0
const posixBashTest = test.skipIf(process.platform === "win32" || !bashRuns)

const NOTARIZED = "accepted source=Notarized Developer ID"
const NOT_YET = "rejected source=Unnotarized Developer ID"

/** A repo-shaped sandbox with the signing script, a stub bin dir, and no signing material in the environment. */
function sandbox(): { root: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "omo-macos-notarize-"))
  mkdirSync(join(root, ".github", "scripts"), { recursive: true })
  copyFileSync(signingScript, join(root, ".github", "scripts", "macos-sign-and-notarize.sh"))
  mkdirSync(join(root, "bin"))
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` }
  for (const name of [...signingMaterial, "MACOS_SIGNING_REQUIRED"]) delete env[name]
  return { root, env }
}

/** Fake macOS toolchain: a signing keychain, codesign, a notarytool whose `info` answers from a script, and spctl. */
function notarySandbox(infoAnswers: readonly string[], spctlAnswers: readonly string[] = [NOTARIZED]): { root: string; env: NodeJS.ProcessEnv; binary: string } {
  const { root, env } = sandbox()
  const bin = join(root, "bin")
  const answers = join(root, "info-answers")
  writeFileSync(answers, `${infoAnswers.join("\n")}\n`)
  const assessments = join(root, "spctl-answers")
  writeFileSync(assessments, `${spctlAnswers.join("\n")}\n`)
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
echo call >> "${root}/spctl-calls"
line=$(head -n 1 "${assessments}")
[ "$(wc -l < "${assessments}")" -gt 1 ] && sed -i.bak 1d "${assessments}"
echo "$line"
`)
  writeFileSync(join(bin, "ditto"), `#!/bin/bash
find "\${@: -2:1}" -type f -exec cat {} \\; -exec echo \\; > "${root}/archived-files"
touch "\${@: -1}"
`)
  for (const tool of ["security", "codesign", "xcrun", "spctl", "ditto"]) chmodSync(join(bin, tool), 0o755)
  const binary = join(root, "omo-darwin-arm64")
  writeFileSync(binary, "binary")
  const material = { CSC_LINK: Buffer.from("p12").toString("base64"), CSC_KEY_PASSWORD: "pw", APPLE_API_KEY: "key", APPLE_API_KEY_ID: "KEY", APPLE_API_ISSUER: "issuer" }
  return { root, binary, env: { ...env, ...material, RUNNER_TEMP: root, NOTARY_POLL_SECONDS: "0", NOTARY_TIMEOUT_SECONDS: "30", GATEKEEPER_POLL_SECONDS: "0", GATEKEEPER_TIMEOUT_SECONDS: "30" } }
}

function runSigning(root: string, env: NodeJS.ProcessEnv, binary: string) {
  return spawnSync("bash", [join(root, ".github", "scripts", "macos-sign-and-notarize.sh"), "--identifier", "ai.sisyphuslabs.omo", binary], { cwd: root, env, encoding: "utf8" })
}

function spctlCalls(root: string): number {
  return readFileSync(join(root, "spctl-calls"), "utf8").trim().split("\n").length
}

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

// Release contract: a binary Apple accepted must not fail the publish because its ticket has not reached Gatekeeper yet,
// and nothing else may be retried.
describe("Gatekeeper check after notarization", () => {
  posixBashTest("waits for the ticket while Gatekeeper still reads the binary as unnotarized", () => {
    const { root, env, binary } = notarySandbox(["Accepted"], [NOT_YET, NOT_YET, NOTARIZED])
    try {
      const result = runSigning(root, env, binary)
      expect(result.status, result.stderr).toBe(0)
      expect(spctlCalls(root)).toBe(3)
      expect(result.stdout).toContain("(attempt 3)")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  posixBashTest("fails when the ticket never arrives within the window", () => {
    const { root, env, binary } = notarySandbox(["Accepted"], [NOT_YET])
    try {
      const result = runSigning(root, { ...env, GATEKEEPER_TIMEOUT_SECONDS: "1", GATEKEEPER_POLL_SECONDS: "0.2" }, binary)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Gatekeeper does not accept")
      expect(spctlCalls(root)).toBeGreaterThan(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  posixBashTest("fails on the first check for any other Gatekeeper answer", () => {
    const { root, env, binary } = notarySandbox(["Accepted"], ["rejected source=no usable signature", NOTARIZED])
    try {
      const result = runSigning(root, env, binary)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Gatekeeper does not accept")
      expect(spctlCalls(root)).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
