import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const roots: string[] = []
const runner = fileURLToPath(new URL("./check-pr-changelog.ts", import.meta.url))
const changelog = "# Changelog\n\n## [Unreleased]\n\n## [5.1.44] - 2026-10-23\n\nPublished.\n"

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "changelog-cli-"))
  roots.push(root)
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", env: { ...process.env, GIT_MASTER: "1" },
  }).trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git("init", "-q")
  git("config", "user.name", "Changelog test")
  git("config", "user.email", "changelog@example.invalid")
  write("package.json", JSON.stringify({ files: ["packages/fixture/src", "launcher.mjs"] }))
  write("launcher.mjs", "export {}\n")
  write("packages/fixture/src/index.ts", "export const value = 1\n")
  write("CHANGELOG.md", changelog)
  git("add", ".")
  git("commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  return { root, git, write, base }
}

describe("changelog gate CLI", () => {
  test.each([
    { name: "fragment-only PR", files: { "changes/unreleased/7.md": "Fragment. (#7)\n" }, status: 0 },
    { name: "user-facing PR with its fragment", files: { "packages/fixture/src/index.ts": "export const value = 2\n", "changes/unreleased/7.md": "Fragment. (#7)\n" }, status: 0 },
    { name: "user-facing PR without a fragment or exemption", files: { "packages/fixture/src/index.ts": "export const value = 2\n" }, status: 1 },
    { name: "non-release Unreleased edit", files: { "CHANGELOG.md": changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\nHand edit.\n") }, status: 1 },
    { name: "fragment cannot exempt a non-release Unreleased edit", files: { "changes/unreleased/7.md": "Fragment. (#7)\n", "CHANGELOG.md": changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\nHand edit.\n") }, status: 1 },
    // #10841: user-facing means shipped (changelog-shipping-policy.mjs), the same classification the Unreleased-line gate used.
    { name: "test support under a shipped package needs no fragment", files: { "packages/fixture/src/seed.test-support.ts": "export const seed = 1\n" }, status: 0 },
    { name: "a CI-only script may carry the no-changelog label", files: { "script/ci-only.mjs": "export {}\n" }, labels: ["no-changelog"], status: 0 },
    { name: "a shipped file outside the package directories needs a fragment", files: { "launcher.mjs": "export const v = 2\n" }, status: 1 },
    { name: "a shipped file refuses the no-changelog label", files: { "launcher.mjs": "export const v = 2\n" }, labels: ["no-changelog"], status: 1 },
    // Removing a shipped file and its manifest entry together is still a shipped change: the base's manifest decides.
    { name: "a removed shipped file needs a fragment", files: { "package.json": JSON.stringify({ files: ["packages/fixture/src"] }), "launcher.mjs": null }, status: 1 },
  ])("$name", ({ files, status, labels = [] }) => {
    // given: committed base and head trees, not a mocked path inventory
    const { root, git, write, base } = fixture()
    for (const [path, content] of Object.entries(files)) {
      if (content === null) git("rm", "-q", path)
      else write(path, content)
    }
    git("add", ".")
    git("commit", "-qm", "PR change")

    // when: the workflow's real entry point evaluates this PR
    const result = spawnSync(process.execPath, [runner], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env,
        GIT_MASTER: "1",
        CHANGELOG_GATE_BASE: base,
        CHANGELOG_GATE_BASE_REF: "",
        CHANGELOG_GATE_PR: "7",
        CHANGELOG_GATE_BRANCH: "feature/fixture",
        CHANGELOG_GATE_ACTOR: "contributor",
        CHANGELOG_GATE_LABELS: JSON.stringify(labels),
        CHANGELOG_GATE_RELEASE: "0",
        CHANGELOG_GATE_TITLE: "",
        CHANGELOG_GATE_BODY: "",
      },
    })

    // then: the process exit and emitted verdict agree
    expect(result.status, result.stderr).toBe(status)
    expect(result.stdout).toMatch(status === 0 ? /changelog-gate: PASS/ : /changelog-gate: FAIL/)
  })
})
