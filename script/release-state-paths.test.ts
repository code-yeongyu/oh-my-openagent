/// <reference types="bun-types" />

// Release contract: the release stamp and the CI classifier read one path list (release-state-paths.mjs). The stamp
// refuses to commit outside it, and base-platform-green.sh tells the classifier whether a release-state pull request's
// base already proved macOS/Windows.

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"

const checker = fileURLToPath(new URL("./release-state-paths.mjs", import.meta.url))
const probe = fileURLToPath(new URL("../.github/scripts/base-platform-green.sh", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "release-state-paths-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// The probe runs against a PATH stub for gh, which Windows bash cannot shadow reliably.
const posixBashTest = test.skipIf(process.platform === "win32" || spawnSync("bash", ["-c", "exit 0"]).status !== 0)

function check(paths: readonly string[]) {
  return spawnSync("node", [checker, "--check"], { encoding: "utf8", input: `${paths.join("\0")}\0` })
}

describe("#given the release stamp's path check", () => {
  test("#then a stamp of manifests, changelog and regenerated bundles passes", () => {
    const run = check([
      "CHANGELOG.md",
      "packages/oh-my-opencode-linux-x64/package.json",
      "packages/omo-senpi/plugin/extensions/a.mjs",
    ])
    expect(run.status).toBe(0)
  })

  test("#then a stamp that also changes source fails and names that path", () => {
    const run = check(["package.json", "packages/omo-native/sync-status-cli.ts"])
    expect(run.status).toBe(1)
    expect(run.stderr).toContain("packages/omo-native/sync-status-cli.ts")
  })

  test.each([
    ["hand-written launcher code beside the generated auth bundle", "packages/omo-native/bin/lib/launcher.js"],
    ["a plugin file the bundle check does not rebuild", "packages/omo-senpi/plugin/extensions/dream-persona.md"],
    ["a runtime bundle the bundle check does not compare", "packages/omo-senpi/plugin/runtime/dag/sdk.js"],
  ])("#then %s is outside the stamp", (_name, path) => {
    expect(check(["package.json", path]).status).toBe(1)
  })

  test("#then prepare-release-state pipes its staged stamp through the check before committing", () => {
    const workflow = load(readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")) as {
      jobs: { "prepare-release-state": { steps: { id?: string; run?: string }[] } }
    }
    const run = workflow.jobs["prepare-release-state"].steps.find((step) => step.id === "prepare")?.run ?? ""
    const checkAt = run.indexOf(
      "git diff --cached --no-renames --name-only -z | node script/release-state-paths.mjs --check",
    )
    expect(checkAt).toBeGreaterThan(-1)
    expect(checkAt).toBeLessThan(run.indexOf('git commit -m "release: v${VERSION}"'))
  })
})

// A real git history: base at 1.0.0, then one candidate commit per case. --check-stamp reads it with git, as CI does.
describe("#given the release stamp's content check", () => {
  const repo = join(root, "stamp-repo")
  const git = (...args: string[]) => {
    const run = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    })
    if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`)
    return run.stdout.trim()
  }
  const write = (path: string, body: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true })
    writeFileSync(join(repo, path), body)
  }
  const hooks = (version: string, windows: string) =>
    JSON.stringify({ command: `omo ${version}`, commandWindows: windows }, null, 2)
  mkdirSync(repo, { recursive: true })
  git("init", "-q")
  git("config", "user.email", "t@example.invalid")
  git("config", "user.name", "t")
  write("package.json", '{ "version": "1.0.0" }\n')
  write("packages/omo-native/package.json", '{ "version": "1.0.0-0" }\n')
  write("packages/omo-codex/plugin/hooks/hooks.json", hooks("1.0.0", "cmd /c omo"))
  write("src/a.ts", "export {}\n")
  git("add", "-A")
  git("commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  function candidate(change: () => void): string {
    git("checkout", "-q", "--detach", base)
    write("package.json", '{ "version": "1.0.1" }\n')
    write("packages/omo-native/package.json", '{ "version": "1.0.1-0" }\n')
    write("CHANGELOG.md", "## 1.0.1\n")
    change()
    git("add", "-A")
    git("commit", "-qm", "candidate")
    return git("rev-parse", "HEAD")
  }
  const checkStamp = (head: string) =>
    spawnSync("node", [checker, "--check-stamp", base, head], { cwd: repo, encoding: "utf8" })

  test("#then a version-only edit of a stamped file, a changelog and the manifests pass", () => {
    const head = candidate(() => write("packages/omo-codex/plugin/hooks/hooks.json", hooks("1.0.1", "cmd /c omo")))
    expect(checkStamp(head).status).toBe(0)
  })

  test("a stable pin stamps root and native beta versions independently, including the lockfile", () => {
    const lock = (rootVersion: string, nativeVersion: string) =>
      `{"workspaces":{"":{"version":"${rootVersion}"},"packages/omo-native":{"name":"omo-ai","version":"${nativeVersion}"}}}`
    git("checkout", "-q", "--detach", base)
    write("packages/omo-native/package.json", '{ "version": "1.0.0" }\n')
    write("bun.lock", lock("1.0.0", "1.0.0"))
    git("add", "-A")
    git("commit", "-qm", "stable pin")
    const pin = git("rev-parse", "HEAD")
    write("package.json", '{ "version": "1.0.1-beta.1" }\n')
    write("packages/omo-native/package.json", '{ "version": "1.0.1-0.beta.1" }\n')
    write("bun.lock", lock("1.0.1-beta.1", "1.0.1-0.beta.1"))
    git("add", "-A")
    git("commit", "-qm", "beta stamp")
    const run = spawnSync("node", [checker, "--check-stamp", pin, "HEAD"], { cwd: repo, encoding: "utf8" })
    expect(run.status, run.stderr).toBe(0)
  })

  test.each([
    [
      "a stamped hooks file whose Windows launch line also changes",
      () => write("packages/omo-codex/plugin/hooks/hooks.json", hooks("1.0.1", "powershell omo")),
      "hooks.json: changes more than the version",
    ],
    [
      "a source file renamed into a listed path",
      () => {
        mkdirSync(join(repo, "changes"), { recursive: true })
        git("mv", "src/a.ts", "changes/a.md")
      },
      "src/a.ts: outside",
    ],
    [
      "a new file at a stamped path",
      () => write("packages/omo-codex/plugin/hooks/extra.json", "{}"),
      "extra.json: added",
    ],
  ])("#then %s is refused and named", (_name, change, reason) => {
    const run = checkStamp(candidate(change))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain(reason)
  })
})

type Leg = "success" | "failure" | "skipped-tests"

// The fake gh runs the probe's own jq over a recorded API response, keyed by the request path.
function probeBase(name: string, legs: readonly Leg[] | null): string {
  const dir = join(root, name)
  const bin = join(dir, "bin")
  const api = join(dir, "api")
  mkdirSync(bin, { recursive: true })
  mkdirSync(api, { recursive: true })
  const answer = (path: string, body: unknown) =>
    writeFileSync(join(api, path.replace(/[^A-Za-z0-9]/g, "_")), JSON.stringify(body))
  const repo = "repos/owner/project"
  answer(`${repo}/actions/workflows/ci.yml/runs?branch=dev&event=push&status=completed&head_sha=abc&per_page=20`, {
    workflow_runs:
      legs === null
        ? []
        : [
            {
              id: 5,
              created_at: "2026-11-21T08:00:00Z",
              conclusion: "success",
              head_sha: "abc",
              head_branch: "dev",
              event: "push",
              status: "completed",
            },
          ],
  })
  answer(`${repo}/actions/runs/5/jobs?filter=latest&per_page=100`, {
    jobs: [
      { name: "test (ubuntu-latest, 1/2)", conclusion: "failure", html_url: "u", labels: ["ubuntu-26.04"], steps: [] },
      ...(legs ?? []).map((leg, index) => ({
        name: `test (windows-latest, ${index + 1}/2)`,
        conclusion: leg === "failure" ? "failure" : "success",
        html_url: "u",
        labels: ["windows-latest"],
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Run tests", conclusion: leg === "skipped-tests" ? "skipped" : leg },
        ],
      })),
    ],
  })
  writeFileSync(
    join(bin, "gh"),
    ["#!/bin/bash", 'key="$(printf %s "$2" | tr -c "A-Za-z0-9" _)"', 'jq -r "$4" "$FAKE_DIR/api/$key"', ""].join("\n"),
  )
  chmodSync(join(bin, "gh"), 0o755)
  const run = spawnSync("bash", [probe], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env["PATH"]}`,
      FAKE_DIR: dir,
      GH_REPO: "owner/project",
      BASE_SHA: "abc",
    },
  })
  expect(run.stderr).toMatch(/^base-platform-green: .*run (5|none)/)
  expect(run.status).toBe(0)
  return run.stdout.trim()
}

describe("#given the base-platform-green probe", () => {
  posixBashTest("#then a base whose macOS/Windows legs all ran green is proof, whatever Linux did", () => {
    expect(probeBase("green", ["success", "success"])).toBe("true")
  })

  posixBashTest.each([
    ["a red leg", ["success", "failure"] as const],
    ["a leg that skipped its tests", ["success", "skipped-tests"] as const],
    ["no macOS/Windows leg", [] as const],
    ["no completed dev push run", null],
  ])("#then %s is not proof", (_name, legs) => {
    expect(probeBase(`not-${_name.replace(/\W/g, "-")}`, legs)).toBe("false")
  })
})
