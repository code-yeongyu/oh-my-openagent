import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// #14818: the release-state landing contract of the changelog gate, driven through the workflow's real entry point.
const roots: string[] = []
const runner = fileURLToPath(new URL("./check-pr-changelog.ts", import.meta.url))
const changelog = "# Changelog\n\n## [Unreleased]\n\n## [5.1.50] - 2026-10-23\n\nPublished.\n"
const repo = "code-yeongyu/oh-my-openagent"
const releaseBody = "Automated release-state PR for v5.1.51. This must merge before npm publication starts."

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function landingFixture({ extraChangelogEdit = false, squash = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-landing-"))
  roots.push(root)
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_MASTER: "1" },
    }).trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git("init", "-q", "-b", "dev")
  git("config", "user.name", "Landing test")
  git("config", "user.email", "landing@example.invalid")
  write("package.json", JSON.stringify({ files: ["packages/fixture/src"] }))
  write("packages/omo-senpi/plugin/extensions/omo.js", "export const version = '5.1.50'\n")
  write("packages/fixture/changes.md", "# fixture\n")
  write("CHANGELOG.md", changelog)
  write("changes/unreleased/1.md", "Fragment. (#1)\n")
  git("add", ".")
  git("commit", "-qm", "pin")
  // given: the stamp, cut from the pin on its own branch, consumes the fragment and stamps both logs
  git("checkout", "-qb", "release/v5.1.51-source-state")
  git("rm", "-q", "changes/unreleased/1.md")
  write(
    "CHANGELOG.md",
    changelog.replace("## [Unreleased]\n", "## [Unreleased]\n\n## [5.1.51] - 2026-10-31\n\nFragment. (#1)\n"),
  )
  write("packages/fixture/changes.md", "# fixture\n\n## 2026-10-31 - Stamped\n")
  write("packages/omo-senpi/plugin/extensions/omo.js", "export const version = '5.1.51'\n")
  git("commit", "-qam", "release: v5.1.51")
  const stamp = git("rev-parse", "HEAD")
  // and: dev moves on after the pin with its own fragment and a regenerated file
  git("checkout", "-q", "dev")
  write("changes/unreleased/2.md", "Next. (#2)\n")
  write("packages/fixture/src/feature.js", "export const feature = 1\n")
  git("add", ".")
  git("commit", "-qm", "post-pin change (#2)")
  const base = git("rev-parse", "HEAD")
  // and: the landing branch merges the unchanged stamp into dev
  git("checkout", "-qb", "release/v5.1.51-land-stamp")
  if (squash) git("merge", "-q", "--squash", stamp)
  else git("merge", "-q", "--no-ff", "--no-commit", stamp)
  if (extraChangelogEdit) write("changes.md", "# Extra log\n")
  git("add", ".")
  git("commit", "-qm", "Merge release: v5.1.51 stamp into dev")
  return { root, git, write, base, stamp, head: git("rev-parse", "HEAD") }
}

// CI checks out refs/pull/<n>/merge: the landing merged into the base tip, which may have moved since the cut.
function checkoutMergeRef(
  fixture: ReturnType<typeof landingFixture>,
  { devGainsFragment }: { devGainsFragment: boolean },
) {
  const { git, write, head } = fixture
  git("checkout", "-q", "dev")
  if (devGainsFragment) {
    write("changes/unreleased/3.md", "After the landing branch was cut. (#3)\n")
    git("add", ".")
    git("commit", "-qm", "post-cut change (#3)")
  }
  const baseTip = git("rev-parse", "HEAD")
  git("checkout", "-q", "--detach")
  git("merge", "-q", "--no-ff", "-m", "Merge landing into dev", head)
  return baseTip
}

function runGate(root: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [runner], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      GIT_MASTER: "1",
      CHANGELOG_GATE_BASE_REF: "",
      CHANGELOG_GATE_LABELS: "[]",
      CHANGELOG_GATE_PR: "14848",
      CHANGELOG_GATE_BRANCH: "release/v5.1.51-land-stamp",
      CHANGELOG_GATE_ACTOR: "maintainer",
      CHANGELOG_GATE_RELEASE: "1",
      CHANGELOG_GATE_TITLE: "release: merge the v5.1.51 release state into dev",
      CHANGELOG_GATE_BODY: "Lands the stamp.",
      CHANGELOG_GATE_REPO: repo,
      ...env,
    },
  })
}

const landedPr = (stamp: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: 14845,
    state: "OPEN",
    headSha: stamp,
    headRepo: repo,
    branch: "release/v5.1.51-source-state",
    title: "release: v5.1.51",
    body: releaseBody,
    ...overrides,
  })

describe("release-state landing", () => {
  test("a merge of the open release-state PR's unchanged stamp into the base is judged as that release PR", () => {
    const { root, base, stamp, head } = landingFixture()

    const result = runGate(root, {
      CHANGELOG_GATE_BASE: base,
      CHANGELOG_GATE_HEAD_SHA: head,
      CHANGELOG_GATE_LANDING_PR: landedPr(stamp),
    })

    // then: the landing passes both gates, and the base's post-pin fragment stays for the next release
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toMatch(/release-state landing[\s\S]*changelog-gate: PASS[\s\S]*package logs PASS/)
  })

  test.each([{ devGainsFragment: false }, { devGainsFragment: true }])(
    "on the merge ref the landing passes, devGainsFragment=$devGainsFragment",
    ({ devGainsFragment }) => {
      const fixture = landingFixture()
      const baseTip = checkoutMergeRef(fixture, { devGainsFragment })

      const result = runGate(fixture.root, {
        CHANGELOG_GATE_BASE: baseTip,
        CHANGELOG_GATE_HEAD_SHA: fixture.head,
        CHANGELOG_GATE_LANDING_PR: landedPr(fixture.stamp),
      })

      // then: a fragment the base gained after the landing branch was cut belongs to the next release
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toMatch(/release-state landing[\s\S]*changelog-gate: PASS[\s\S]*package logs PASS/)
    },
  )

  test.each([
    {
      name: "the second parent is not the release PR's head",
      fixture: {},
      pr: { headSha: "f".repeat(40) },
      reason: /second parent/,
    },
    {
      name: "the merge adds a changelog edit the stamp does not make",
      fixture: { extraChangelogEdit: true },
      pr: {},
      reason: /beyond the stamp/,
    },
    {
      name: "the release PR is closed",
      fixture: {},
      pr: { state: "CLOSED" },
      reason: /is not open/,
    },
    {
      name: "the release PR comes from a fork",
      fixture: {},
      pr: { headRepo: "someone/oh-my-openagent" },
      reason: /not from this repository/,
    },
    {
      name: "the PR it names is not a release-state PR",
      fixture: {},
      pr: { title: "chore: stamp" },
      reason: /not a release-state PR/,
    },
    {
      name: "a squash has one parent",
      fixture: { squash: true },
      pr: {},
      reason: /not a two-parent merge/,
    },
  ])("not a landing when $name", ({ fixture, pr, reason }) => {
    const { root, base, stamp, head } = landingFixture(fixture)

    const result = runGate(root, {
      CHANGELOG_GATE_BASE: base,
      CHANGELOG_GATE_HEAD_SHA: head,
      CHANGELOG_GATE_LANDING_PR: landedPr(stamp, pr),
    })

    // then: the gate falls back to an ordinary PR and refuses its changelog edits
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout).toMatch(reason)
    expect(result.stdout).toMatch(/not a release-state landing[\s\S]*only the release PR may edit the changelog/)
  })

  test("without the landed PR's facts the gate fails closed", () => {
    const { root, base, head } = landingFixture()

    const result = runGate(root, {
      CHANGELOG_GATE_BASE: base,
      CHANGELOG_GATE_HEAD_SHA: head,
    })

    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout).toMatch(/only the release PR may edit the changelog/)
  })
})
