/// <reference types="bun-types" />

import { afterEach, afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { bashPath, forBash, windowsProcessEnv } from "./publish-operator-darwin-windows-env"

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

// The step hashes the manifest with `shasum -a 256` because macOS runners have no `sha256sum`. Git bash (Windows
// runners) has no `shasum`, so this forwards to sha256sum exactly where the platform lacks it; the same shim
// release-assets-verify-workflow.test.ts ships.
const shasumShimDir = (() => {
  if (spawnSync("bash", ["-c", "command -v shasum"], { timeout: 5_000 }).status === 0) return ""
  const bin = mkdtempSync(join(tmpdir(), "operator-darwin-bin-"))
  writeFileSync(
    join(bin, "shasum"),
    '#!/bin/bash\n[ "$1" = -a ] && [ "$2" = 256 ] || exit 2\nshift 2\nexec sha256sum "$@"\n',
  )
  chmodSync(join(bin, "shasum"), 0o755)
  return bin
})()
// The shim directory outlives the per-test scratch (every run()'s env references it), so it is swept once at the
// end of the file instead of after each test.
afterAll(() => {
  if (shasumShimDir !== "") rmSync(shasumShimDir, { recursive: true, force: true })
})
const stepPath = (): string => (shasumShimDir === "" ? bashPath() : `${shasumShimDir}${delimiter}${bashPath()}`)

describe("Verify operator darwin artifacts step", () => {
  const run = (pin: string) => {
    const root = tempDir("operator-darwin-pin-")
    const calls = join(root, "calls")
    const manifest = '{"source_sha":"1111111111111111111111111111111111111111"}'
    writeFileSync(join(root, "operator-darwin-manifest.json"), manifest)
    const stubs = ["jq", "git"].map(
      (tool) =>
        `${tool}() { echo "${tool} $*" >> "$CALLS"; ${tool === "jq" ? "echo 1111111111111111111111111111111111111111" : ":"}; }`,
    )
    // The pinned verifier copy the guard step exports; this stand-in logs its argv and writes the rows.
    const pinned = tempDir("operator-darwin-pinned-")
    writeFileSync(
      join(pinned, "operator-darwin-verify.ts"),
      `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(calls)}, "verifier " + Bun.argv.slice(2).join(" ") + "\\n")\nawait Bun.write(process.env.RUNNER_TEMP + "/operator-darwin-rows.md", "| rows |\\n")\n`,
    )
    const result = spawnSync("bash", ["-c", `${stubs.join("\n")}\n${stepRun("Verify operator darwin artifacts")}`], {
      env: {
        ...windowsProcessEnv(),
        PATH: stepPath(),
        CALLS: forBash(calls),
        GITHUB_WORKSPACE: forBash(root),
        OPERATOR_DARWIN_VERIFIER: forBash(pinned),
        OPERATOR_DARWIN_DIR: forBash(root),
        MANIFEST_SHA256: pin === "real" ? createHash("sha256").update(manifest).digest("hex") : pin,
        PREPARED_RELEASE_SHA: "2".repeat(40),
        TAG: "operator-darwin-111111111111",
        VERSION: "5.1.75",
        ACTOR: "maintainer",
        TRIGGERING_ACTOR: "maintainer",
        REPOSITORY: "o/r",
        RUNNER_TEMP: forBash(root),
        GITHUB_STEP_SUMMARY: forBash(join(root, "summary")),
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
    expect(outcome.calls).toMatch(/^verifier --dir \S+ --tag operator-darwin-111111111111 .*--repo \S+/m)
  })
})

describe("Verify operator darwin artifacts step with the real bun", () => {
  // The checkout is the dispatched ref: everything in it is attacker-controlled. The step must run only the pinned
  // verifier copy (OPERATOR_DARWIN_VERIFIER), from outside the checkout, with no Bun config, .env or proxy/TLS env.
  const run = (checkout: (root: string) => void) => {
    const root = tempDir("operator-darwin-ref-")
    const pinned = tempDir("operator-darwin-pinned-")
    const seen = join(pinned, "SEEN.json")
    // Stand-in for the pinned verifier: records what it saw and writes the rows the step cats.
    writeFileSync(
      join(pinned, "operator-darwin-verify.ts"),
      `await Bun.write(${JSON.stringify(seen)}, JSON.stringify({ cwd: process.cwd(), tls: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null, proxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null }))\nawait Bun.write(process.env.RUNNER_TEMP + "/operator-darwin-rows.md", "| rows |\\n")\n`,
    )
    checkout(root)
    const manifest = '{"source_sha":"1111111111111111111111111111111111111111"}'
    writeFileSync(join(root, "operator-darwin-manifest.json"), manifest)
    const result = spawnSync(
      "bash",
      [
        "-c",
        `jq() { echo 1111111111111111111111111111111111111111; }\ngit() { :; }\n${stepRun("Verify operator darwin artifacts")}`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...windowsProcessEnv(),
          PATH: stepPath(),
          HOME: forBash(process.env.HOME ?? root),
          // A runner whose environment carries interception settings must not pass them to the verifier.
          HTTPS_PROXY: "http://127.0.0.1:9",
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          NODE_OPTIONS: "--require /nonexistent",
          GITHUB_WORKSPACE: forBash(root),
          OPERATOR_DARWIN_DIR: forBash(root),
          OPERATOR_DARWIN_VERIFIER: forBash(pinned),
          MANIFEST_SHA256: createHash("sha256").update(manifest).digest("hex"),
          PREPARED_RELEASE_SHA: "2".repeat(40),
          TAG: "operator-darwin-111111111111",
          VERSION: "5.1.75",
          ACTOR: "maintainer",
          TRIGGERING_ACTOR: "maintainer",
          REPOSITORY: "o/r",
          RUNNER_TEMP: forBash(pinned),
          GITHUB_STEP_SUMMARY: forBash(join(root, "summary")),
        },
      },
    )
    const facts = existsSync(seen) ? JSON.parse(readFileSync(seen, "utf8")) : null
    return { status: result.status, root, facts, evil: existsSync(join(root, "EVIL_RAN")) }
  }
  const evil = (root: string) => `await Bun.write(${JSON.stringify(join(root, "EVIL_RAN"))}, "ran")\n`

  test("#13964 L1: a top-level preload in the checkout's bunfig.toml does not run", () => {
    const outcome = run((root) => {
      writeFileSync(join(root, "bunfig.toml"), 'preload = ["./evil.ts"]\n')
      writeFileSync(join(root, "evil.ts"), evil(root))
    })
    expect({ status: outcome.status, verifierRan: outcome.facts !== null, evil: outcome.evil }).toEqual({
      status: 0,
      verifierRan: true,
      evil: false,
    })
  })

  test("#13964 M1: a checkout tsconfig.json/jsconfig.json paths:'*' cannot swap the verifier", () => {
    const outcome = run((root) => {
      for (const config of ["tsconfig.json", "jsconfig.json"])
        writeFileSync(
          join(root, config),
          JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "*": ["./evil.ts"] } } }),
        )
      mkdirSync(join(root, ".github/workflows"), { recursive: true })
      writeFileSync(join(root, ".github/workflows/operator-darwin-verify.ts"), evil(root))
      writeFileSync(join(root, "evil.ts"), evil(root))
    })
    expect({ status: outcome.status, verifierRan: outcome.facts !== null, evil: outcome.evil }).toEqual({
      status: 0,
      verifierRan: true,
      evil: false,
    })
    expect(outcome.facts?.cwd.startsWith(outcome.root)).toBe(false)
  })

  test("#13964 M1: a checkout .env and the runner env cannot turn off TLS or route the verifier through a proxy", () => {
    const outcome = run((root) =>
      writeFileSync(
        join(root, ".env"),
        "NODE_TLS_REJECT_UNAUTHORIZED=0\nHTTPS_PROXY=http://127.0.0.1:9\nNODE_OPTIONS=--require /nonexistent\n",
      ),
    )
    expect({ status: outcome.status, facts: outcome.facts }).toEqual({
      status: 0,
      facts: { cwd: expect.any(String), tls: null, proxy: null, nodeOptions: null },
    })
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
    writeFileSync(join(checkout, "bunfig.toml"), "[test]\n")
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
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          DEFAULT_BRANCH: "dev",
          GIT_CONFIG_NOSYSTEM: "1",
          RUNNER_TEMP: root,
          GITHUB_ENV: join(root, "github-env"),
        },
        encoding: "utf8",
      },
    )
    const env = existsSync(join(root, "github-env")) ? readFileSync(join(root, "github-env"), "utf8") : ""
    const pinned = env.match(/^OPERATOR_DARWIN_VERIFIER=(.+)$/m)?.[1] ?? ""
    return { status: result.status, stdout: result.stdout, pinned }
  }

  test("#13964 M1: the guard exports a pinned copy of the default branch's verifier outside the checkout", () => {
    const outcome = dispatch((checkout) =>
      writeFileSync(join(checkout, ".github/workflows/publish.yml"), "name: publish\n# release\n"),
    )
    expect(outcome.status).toBe(0)
    expect(outcome.pinned).not.toBe("")
    expect(readFileSync(join(outcome.pinned, "operator-darwin-verify.ts"), "utf8")).toBe(
      'export const TEAM_ID = "523JNR86LZ"\n',
    )
  })

  test("LOW-5: a release ref that changes the verifier's pins is refused", () => {
    const outcome = dispatch((checkout) =>
      writeFileSync(
        join(checkout, ".github/workflows/operator-darwin-verify.ts"),
        'export const TEAM_ID = "ATTACKER99"\n',
      ),
    )
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toContain(
      "::error::operator_darwin_artifacts refused: .github/workflows/operator-darwin-*.ts or bunfig.toml differ from dev",
    )
  })

  test("#13964 L1: a release ref that changes bunfig.toml is refused", () => {
    const outcome = dispatch((checkout) => writeFileSync(join(checkout, "bunfig.toml"), 'preload = ["./probe.ts"]\n'))
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toContain("operator-darwin-*.ts or bunfig.toml differ from dev")
  })

  test("a release ref carrying the merged verifier (other workflow files may differ) is admitted", () => {
    const outcome = dispatch((checkout) =>
      writeFileSync(join(checkout, ".github/workflows/publish.yml"), "name: publish\n# release-branch only\n"),
    )
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain("The operator darwin verifier equals dev; pinned copy at ")
  })
})
