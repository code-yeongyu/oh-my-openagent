/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Release security contract (#13943): two operator-darwin workflow steps, executed from the parsed
 * publish-platform.yml.
 * - push-2 NIT-1: the operator-supplied manifest is not parsed (jq) before its sha256 matches the dispatch pin.
 * - LOW-5: the verifier code on the dispatched ref must equal the default branch's, so a release branch cannot
 *   carry its own trust rules. This one runs against a real git origin.
 */

type Step = { name?: string; run?: string }
const workflow = Bun.YAML.parse(
  readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8"),
) as {
  jobs: Record<string, { steps?: Step[] }>
}
const stepRun = (name: string) => {
  const run = workflow.jobs["operator-darwin"]?.steps?.find((step) => step.name === name)?.run
  if (!run) throw new Error(`operator-darwin has no step ${name}`)
  return run
}

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

describe("Verify operator darwin artifacts step", () => {
  const run = (pin: string) => {
    const root = tempDir("operator-darwin-pin-")
    const calls = join(root, "calls")
    const manifest = '{"source_sha":"1111111111111111111111111111111111111111"}'
    writeFileSync(join(root, "operator-darwin-manifest.json"), manifest)
    const stubs = ["jq", "git", "bun"].map(
      (tool) =>
        `${tool}() { echo "${tool} $*" >> "$CALLS"; ${tool === "jq" ? "echo 1111111111111111111111111111111111111111" : tool === "bun" ? 'echo "| rows |" > "$RUNNER_TEMP/operator-darwin-rows.md"' : ":"}; }`,
    )
    const result = spawnSync("bash", ["-c", `${stubs.join("\n")}\n${stepRun("Verify operator darwin artifacts")}`], {
      env: {
        PATH: process.env.PATH ?? "",
        CALLS: calls,
        OPERATOR_DARWIN_DIR: root,
        MANIFEST_SHA256: pin === "real" ? createHash("sha256").update(manifest).digest("hex") : pin,
        PREPARED_RELEASE_SHA: "2".repeat(40),
        TAG: "operator-darwin-111111111111",
        VERSION: "5.1.75",
        ACTOR: "maintainer",
        TRIGGERING_ACTOR: "maintainer",
        REPOSITORY: "o/r",
        RUNNER_TEMP: root,
        GITHUB_STEP_SUMMARY: join(root, "summary"),
      },
      encoding: "utf8",
    })
    return { status: result.status, stdout: result.stdout, calls: existsSync(calls) ? readFileSync(calls, "utf8") : "" }
  }

  test("push-2 NIT-1: a manifest that does not match the pin is refused before jq reads it", () => {
    const outcome = run("0".repeat(64))
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toContain(
      "::error::operator_darwin_artifacts refused: operator-darwin-manifest.json does not match the pinned operator_darwin_manifest_sha256.",
    )
    expect(outcome.calls).toBe("")
  })

  test("a pinned manifest is parsed and handed to the verifier", () => {
    const outcome = run("real")
    expect(outcome.status).toBe(0)
    expect(outcome.calls.split("\n")[0]).toStartWith("jq -r .source_sha // empty")
    expect(outcome.calls).toContain("bun .github/workflows/operator-darwin-verify.ts")
  })
})

describe("Refuse operator darwin verifier code that differs from the default branch", () => {
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@e",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@e",
      },
    })
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
    return result.stdout.trim()
  }

  const dispatch = (change: (checkout: string) => void) => {
    const root = tempDir("operator-darwin-pins-")
    const origin = join(root, "origin.git")
    const checkout = join(root, "checkout")
    git(root, "init", "-q", "--bare", "-b", "dev", origin)
    git(root, "init", "-q", "-b", "dev", checkout)
    mkdirSync(join(checkout, ".github/workflows"), { recursive: true })
    writeFileSync(
      join(checkout, ".github/workflows/operator-darwin-verify.ts"),
      'export const TEAM_ID = "523JNR86LZ"\n',
    )
    writeFileSync(join(checkout, ".github/workflows/publish.yml"), "name: publish\n")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "dev")
    git(checkout, "remote", "add", "origin", origin)
    git(checkout, "push", "-q", "origin", "dev")
    change(checkout)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "--allow-empty", "-m", "release")
    const result = spawnSync(
      "bash",
      ["-c", stepRun("Refuse operator darwin verifier code that differs from the default branch")],
      {
        cwd: checkout,
        env: { PATH: process.env.PATH ?? "", HOME: root, DEFAULT_BRANCH: "dev", GIT_CONFIG_NOSYSTEM: "1" },
        encoding: "utf8",
      },
    )
    return { status: result.status, stdout: result.stdout }
  }

  test("LOW-5: a release ref that changes the verifier's pins is refused", () => {
    const outcome = dispatch((checkout) =>
      writeFileSync(
        join(checkout, ".github/workflows/operator-darwin-verify.ts"),
        'export const TEAM_ID = "ATTACKER99"\n',
      ),
    )
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toContain(
      "::error::operator_darwin_artifacts refused: .github/workflows/operator-darwin-*.ts differ from dev",
    )
  })

  test("a release ref carrying the merged verifier (other workflow files may differ) is admitted", () => {
    const outcome = dispatch((checkout) =>
      writeFileSync(join(checkout, ".github/workflows/publish.yml"), "name: publish\n# release-branch only\n"),
    )
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain("The operator darwin verifier equals dev.")
  })
})
