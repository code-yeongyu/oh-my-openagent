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

  // #11554: CI checks out refs/pull/<n>/merge, the release head merged into a base that gained fragments after the cut.
  test.each([
    { name: "a release merged into a moved base owes only the cut's fragments", deleted: ["1.md", "2.md"], status: 0, verdict: /changelog-gate: PASS/ },
    { name: "a release that leaves a cut fragment still fails on the merge tree", deleted: ["1.md"], status: 1, verdict: /changelog-gate: FAIL - a release PR must delete every fragment it consumes/ },
  ])("$name", ({ deleted, status, verdict }) => {
    // given: the cut holds two fragments, the release consumes them, and the base then gains five more
    const { root, git, write } = fixture()
    for (const name of ["1.md", "2.md"]) write(`changes/unreleased/${name}`, `Fragment ${name}.\n`)
    git("add", ".")
    git("commit", "-qm", "cut")
    git("checkout", "-qb", "release-side")
    git("rm", "-q", ...deleted.map((name) => `changes/unreleased/${name}`))
    write("CHANGELOG.md", changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\n## [5.1.50] - 2026-10-28\n\nStamped.\n"))
    git("commit", "-qam", "release: v5.1.50")
    git("checkout", "-q", "-")
    for (const name of ["3.md", "4.md", "5.md", "6.md", "7.md"]) write(`changes/unreleased/${name}`, `Next ${name}.\n`)
    git("add", ".")
    git("commit", "-qm", "post-cut fragments")
    const movedBase = git("rev-parse", "HEAD")
    git("merge", "-q", "--no-ff", "--no-edit", "release-side")

    // when: the gate judges the merge tree as the release-state PR
    const result = runGate(root, {
      CHANGELOG_GATE_BASE: movedBase,
      CHANGELOG_GATE_PR: "11554",
      CHANGELOG_GATE_BRANCH: "release/v5.1.50-source-state",
      CHANGELOG_GATE_ACTOR: "sisyphus-dev-ai",
      CHANGELOG_GATE_RELEASE: "1",
      CHANGELOG_GATE_TITLE: "release: v5.1.50",
      CHANGELOG_GATE_BODY: "Automated release-state PR for v5.1.50.",
    })

    // then: the verdict reflects the cut's fragments, not the next release's
    expect(result.status, result.stderr).toBe(status)
    expect(result.stdout).toMatch(verdict)
  })

  // #11704: publish.yml reuses any open PR on its fixed branch, so the author does not identify the release-state PR.
  test.each([
    { name: "a marked release PR opened by a maintainer account passes", actor: "maintainer", release: "1", title: "release: v5.1.51", status: 0 },
    { name: "a marked release PR opened by the release bot passes", actor: "sisyphus-dev-ai", release: "1", title: "release: v5.1.51", status: 0 },
    { name: "a hand-made release branch without the marker still fails", actor: "sisyphus-dev-ai", release: "1", title: "chore: stamp the changelog", status: 1 },
    { name: "a marked release branch whose head is not in this repository still fails", actor: "maintainer", release: "0", title: "release: v5.1.51", status: 1 },
  ])("$name", ({ actor, release, title, status }) => {
    // given: a release commit that stamps the changelog and a package log and consumes the only fragment
    const { root, git, write } = fixture()
    write("packages/fixture/changes.md", "# fixture\n")
    write("changes/unreleased/1.md", "Fragment. (#1)\n")
    git("add", ".")
    git("commit", "-qm", "cut")
    const base = git("rev-parse", "HEAD")
    git("rm", "-q", "changes/unreleased/1.md")
    write("CHANGELOG.md", changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\n## [5.1.51] - 2026-10-31\n\nFragment. (#1)\n"))
    write("packages/fixture/changes.md", "# fixture\n\n## 2026-10-31 - Stamped\n")
    git("commit", "-qam", "release: v5.1.51")

    // when: the gate judges the PR with the facts the workflow passes
    const result = runGate(root, {
      CHANGELOG_GATE_BASE: base,
      CHANGELOG_GATE_PR: "11672",
      CHANGELOG_GATE_BRANCH: "release/v5.1.51-source-state",
      CHANGELOG_GATE_ACTOR: actor,
      CHANGELOG_GATE_RELEASE: release,
      CHANGELOG_GATE_TITLE: title,
      CHANGELOG_GATE_BODY: "Automated release-state PR for v5.1.51. This must merge before npm publication starts.",
    })

    // then: the release marker decides, for the changelog and the package logs alike
    expect(result.status, result.stdout + result.stderr).toBe(status)
    if (status === 0) expect(result.stdout).toMatch(/changelog-gate: PASS[\s\S]*package logs PASS/)
    else expect(result.stdout).toMatch(/only the release PR may edit the changelog[\s\S]*package logs FAIL/)
  })
})

function runGate(cwd: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [runner], {
    cwd, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, GIT_MASTER: "1", CHANGELOG_GATE_BASE_REF: "", CHANGELOG_GATE_LABELS: "[]", ...env },
  })
}
