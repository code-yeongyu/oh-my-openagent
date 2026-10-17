import { describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { load } from "js-yaml"
import { checkPrChangelog, hasAddedUnreleasedLine, isUserFacingPath } from "./check-pr-changelog.mjs"
import { shippingPolicy } from "./changelog-shipping-policy.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
const policy = shippingPolicy(tracked, (path) => readFileSync(join(root, path), "utf8"))
const manifestPolicy = (manifest) => shippingPolicy(["package.json"], () => JSON.stringify(manifest))

describe("shipped path classifier", () => {
  test.each([
    "packages/omo-opencode/src/tools/delegate-task/categories.ts",
    "packages/omo-senpi/src/components/onboarding/component.ts",
    "crates/senpi-desktop-backend-macos/src/ax/menus/select.rs",
    "crates/senpi-desktop-core/src/menus/mod.rs",
    "packages/omo-native/compile-entry.ts", "packages/omo-native/compiled-update.ts",
    "packages/omo-native/bin/lib/daemon-operations.js",
    "packages/omo-senpi/plugin/runtime/dag/sdk.js",
    "packages/omo-senpi/plugin/package.json",
    "packages/omo-senpi/plugin/daemon-launch-spec.json",
    "packages/omo-senpi/plugin/scripts/install.mjs",
    "packages/omo-opencode/src/testing/create-plugin-module.ts",
    "packages/omo-senpi/skills/onboarding/SKILL.md",
    "packages/shared-skills/skills/ulw-research/SKILL.md",
    "packages/prompts-core/prompts/ultrawork/codex.md",
    ".agents/skills/opencode-qa/SKILL.md",
    "bin/oh-my-opencode.js", "postinstall.mjs", "package.json",
    "script/build-binaries.ts", "script/build-omo-binary.ts", "script/build-omo-native.ts",
    "script/build.ts", "script/qa/strip-ansi.mjs",
  ])("requires a note for %s", (path) => {
    expect(tracked).toContain(path)
    expect(isUserFacingPath(path, policy)).toBe(true)
  })
  test.each([
    "packages/omo-senpi/src/components/onboarding/component.test.ts",
    "packages/omo-senpi/src/components/onboarding/test-harness.ts",
    "packages/isolation-core/src/backends/git-fixture.ts",
    "packages/isolation-core/src/merge/abandoned-concurrent-merge.fixture.ts",
    "packages/isolation-core/src/merge/merge-fixture.ts",
    "packages/omo-opencode/src/testing/module-mock-lifecycle.ts",
    "packages/omo-opencode/src/features/team-mode/test-support/async-test-helpers.ts",
    "crates/senpi-desktop-backend-macos/src/ax/menus/live_tests.rs",
    "crates/senpi-desktop-backend-macos/src/ax/menus/tests.rs",
    "packages/omo-senpi/plugin/extensions/omo.js",
    "packages/omo-codex/scripts/install-dist/install-local.mjs",
    "docs/reference/omo-ai-publishing.md", "README.md", "AGENTS.md", "changes.md",
    "scripts/check-third-party-notices.mjs",
    "script/qa/omo-native-eval-smoke-stop.mjs", "script/qa/omo-native-eval-smoke.mjs",
    ".github/workflows/ci.yml", "bun.lock",
  ])("does not require a note for %s", (path) => {
    expect(tracked).toContain(path)
    expect(isUserFacingPath(path, policy)).toBe(false)
  })
  test("uses manifest glob, bin and negative entries", () => {
    const packagePolicy = manifestPolicy({ files: ["assets/*.json", "!assets/private.json"], bin: { cli: "launcher.mjs" } })
    expect(isUserFacingPath("assets/runtime.json", packagePolicy)).toBe(true)
    expect(isUserFacingPath("assets/private.json", packagePolicy)).toBe(false)
    expect(isUserFacingPath("launcher.mjs", packagePolicy)).toBe(true)
    expect(isUserFacingPath("unpublished.mjs", packagePolicy)).toBe(false)
  })
})

describe("Unreleased added-line detection", () => {
  const before = "# Changelog\n\n## [Unreleased]\n\nExisting note.\n\n## [1.0.0]\n\nOld note.\n"
  test.each([
    ["adds content", "## [Unreleased]\n\nNew note.\n", "@@ -0,0 +3 @@\n+New note.", true],
    ["edits content", "## [Unreleased]\n\nEdited note.\n", "@@ -5 +3 @@\n-Existing note.\n+Edited note.", true],
    ["adds bullets", "## [Unreleased]\n### Fixed\n- New note.\n", "@@ -0,0 +3 @@\n+- New note.", true],
    ["adds only heading", "## [Unreleased]\n### Fixed\n", "@@ -0,0 +2 @@\n+### Fixed", false],
    ["adds only blank", "## [Unreleased]\n\n", "@@ -0,0 +2 @@\n+", false],
    ["adds a released note", "## [Unreleased]\n\n## [1.0.0]\nNew note.\n", "@@ -0,0 +4 @@\n+New note.", false],
    ["has no section", "# Changelog\nNew note.\n", "@@ -0,0 +2 @@\n+New note.", false],
    ["moves existing content", "## [Unreleased]\nExisting note.\n", "@@ -0,0 +2 @@\n+Existing note.", false],
    ["adds comment", "## [Unreleased]\n<!-- hidden -->\n", "@@ -0,0 +2 @@\n+<!-- hidden -->", false],
    ["adds multiline comment", "## [Unreleased]\n<!--\nhidden\n-->\n", "@@ -0,0 +3 @@\n+hidden", false],
    ["stops at any level-two heading", "## [Unreleased]\n## Notes\nNew note.\n", "@@ -0,0 +3 @@\n+New note.", false],
    ["does not accept an unchanged section", before, "", false],
    ["ignores additions before the section", "New note.\n## [Unreleased]\nExisting note.\n", "@@ -0,0 +1 @@\n+New note.", false],
  ])("%s", (_name, after, diff, expected) => {
    expect(hasAddedUnreleasedLine(before, after, diff)).toBe(expected)
  })
  test("tracks line numbers through deletion, context and separate hunks", () => {
    const after = "# Changelog\n## [Unreleased]\nExisting note.\nNew note.\n## [1.0.0]\nOld note.\n"
    const diff = "@@ -1,2 +1 @@\n # Changelog\n-\n@@ -3,3 +2,3 @@\n ## [Unreleased]\n-\n Existing note.\n+New note.\n"
    expect(hasAddedUnreleasedLine(before, after, diff)).toBe(true)
  })
})

describe("gate verdict", () => {
  const facts = { changedFiles: ["packages/omo-native/compile-entry.ts"], policy, before: "", after: "", diff: "" }
  test("fails a runtime change despite unrelated labels", () => {
    expect(checkPrChangelog({ ...facts, labels: ["No-changelog", "ci:full-matrix"] }).pass).toBe(false)
  })
  test("passes the exact escape label", () => {
    expect(checkPrChangelog({ ...facts, labels: ["no-changelog"] }).pass).toBe(true)
  })
  test("passes a docs-only change", () => {
    expect(checkPrChangelog({ ...facts, changedFiles: ["docs/guide.md"] }).pass).toBe(true)
  })
  test("classifies removed shipped entries using the previous manifest", () => {
    expect(checkPrChangelog({ ...facts, changedFiles: ["assets/runtime.json"], policy: manifestPolicy({ files: [] }), previousPolicy: manifestPolicy({ files: ["assets/*.json"] }) }).pass).toBe(false)
  })
  const notes = "### Fixed\n- Existing fix.\n- Another fix."
  const history = "## [1.0.0]\nOld note.\n"
  const beforeRelease = `## [Unreleased]\n\n${notes}\n\n${history}`
  test.each([
    ["complete release transition", `## [Unreleased]\n\n## [1.1.0] - 2026-10-11\n\n${notes}\n\n${history}`, true],
    ["unrelated release heading", `${beforeRelease}\n## [1.1.0]\nUnrelated note.\n`, false],
    ["copied notes without clearing Unreleased", `## [Unreleased]\n${notes}\n\n## [1.1.0]\n${notes}\n\n${history}`, false],
    ["partial release transition", `## [Unreleased]\n\n## [1.1.0]\n### Fixed\n- Existing fix.\n\n${history}`, false],
    ["edited released notes", `## [Unreleased]\n\n## [1.1.0]\n${notes.replace("Existing fix.", "Unrelated fix.")}\n\n${history}`, false],
    ["existing release version", `## [Unreleased]\n\n## [1.0.0] - 2026-10-11\n${notes}\n\n${history}`, false],
    ["release after another section", `## [Unreleased]\n\n${history}\n## [1.1.0]\n${notes}\n`, false],
    ["complete prerelease transition", `## [Unreleased]\n\n## [1.1.0-beta.1] - 2026-10-15\n\n${notes}\n\n${history}`, true],
  ])("%s with shipped code", (_name, after, pass) => {
    expect(checkPrChangelog({ ...facts, before: beforeRelease, after, diff: "" }).pass).toBe(pass)
  })
  test("does not count an already released prerelease version as a new release", () => {
    const releasedBeta = `## [1.1.0-beta.1] - 2026-10-14\nOld beta.\n\n${history}`
    expect(checkPrChangelog({
      ...facts,
      before: `## [Unreleased]\n\n${notes}\n\n${releasedBeta}`,
      after: `## [Unreleased]\n\n## [1.1.0-beta.1] - 2026-10-15\n\n${notes}\n\n${releasedBeta}`,
      diff: "",
    }).pass).toBe(false)
  })
  test.each(["", "### Fixed", "<!-- hidden note -->"])("does not release an empty or heading/comment-only section: %s", (body) => {
    expect(checkPrChangelog({
      ...facts,
      before: `## [Unreleased]\n${body}\n\n${history}`,
      after: `## [Unreleased]\n\n## [1.1.0]\n${body}\n\n${history}`,
    }).pass).toBe(false)
  })
})

describe("own-PR link on added Unreleased paragraphs", () => {
  const link = (n) => `[#${n}](https://github.com/code-yeongyu/oh-my-openagent/pull/${n})`
  const before = "## [Unreleased]\n\n**Old fix.** Existing text (${link(1)}).\n\n## [1.0.0]\nOld note.\n".replace("${link(1)}", link(1))
  const facts = { changedFiles: ["packages/omo-native/compile-entry.ts"], policy, before }
  const add = (paragraph) => ({
    after: `## [Unreleased]\n\n${paragraph}\n\n**Old fix.** Existing text (${link(1)}).\n\n## [1.0.0]\nOld note.\n`,
    diff: `@@ -0,0 +3,2 @@\n+${paragraph}\n+`,
  })
  test("refuses an added paragraph with no link to its own PR", () => {
    const result = checkPrChangelog({ ...facts, ...add("**New fix.** No link here."), prNumber: 123 })
    expect(result.pass).toBe(false)
    expect(result.reason).toContain("#123")
  })
  test("passes an added paragraph that links its own PR", () => {
    expect(checkPrChangelog({ ...facts, ...add(`**New fix.** Linked (${link(123)}).`), prNumber: 123 }).pass).toBe(true)
  })
  test("refuses an added paragraph that links only a different PR", () => {
    expect(checkPrChangelog({ ...facts, ...add(`**New fix.** Linked (${link(99)}).`), prNumber: 123 }).pass).toBe(false)
  })
  test("accepts an edit of an existing paragraph without its own link", () => {
    const after = `## [Unreleased]\n\n**Old fix.** Existing text (${link(1)}, ${link(2)}).\n\n## [1.0.0]\nOld note.\n`
    const diff = `@@ -3 +3 @@\n-**Old fix.** Existing text (${link(1)}).\n+**Old fix.** Existing text (${link(1)}, ${link(2)}).`
    expect(checkPrChangelog({ ...facts, after, diff, prNumber: 123 }).pass).toBe(true)
  })
  test("checks an entry written directly under a heading", () => {
    const { after } = add("### Fixed\n**New fix.** No link here.")
    const diff = "@@ -0,0 +3,3 @@\n+### Fixed\n+**New fix.** No link here.\n+"
    expect(checkPrChangelog({ ...facts, after, diff, prNumber: 123 }).pass).toBe(false)
    const linked = add(`### Fixed\n**New fix.** Linked (${link(123)}).`).after
    expect(checkPrChangelog({ ...facts, after: linked, diff: diff.replace("No link here.", `Linked (${link(123)}).`), prNumber: 123 }).pass).toBe(true)
  })
  test("keeps the old verdict when no PR number is known", () => {
    expect(checkPrChangelog({ ...facts, ...add("**New fix.** No link here.") }).pass).toBe(true)
  })
})

test("CLI uses the PR merge base, includes deleted sources, and accepts a real note", () => {
  const repo = mkdtempSync(join(tmpdir(), "changelog-gate-cli-"))
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()
  const script = fileURLToPath(new URL("./check-pr-changelog.mjs", import.meta.url))
  const run = (base, labels = "[]") => spawnSync(process.execPath, [script, "--repo", repo, "--base", base, "--labels", labels], { encoding: "utf8", cwd: "/tmp" })
  try {
    git("init", "-q")
    git("config", "user.name", "YeonGyu-Kim")
    git("config", "user.email", "code.yeon.gyu@gmail.com")
    writeFileSync(join(repo, "package.json"), JSON.stringify({ files: ["assets/runtime.json"] }))
    writeFileSync(join(repo, "CHANGELOG.md"), "## [Unreleased]\n\n## [1.0.0]\nOld note.\n")
    mkdirSync(join(repo, "assets"))
    writeFileSync(join(repo, "assets/runtime.json"), "{}\n")
    git("add", ".")
    git("commit", "-qm", "initial fixture")
    const base = git("rev-parse", "HEAD")
    git("branch", "base")
    rmSync(join(repo, "assets/runtime.json"))
    git("add", ".")
    git("commit", "-qm", "remove shipped asset")
    expect(run(base).status).toBe(1)
    expect(run(base, '["no-changelog"]').status).toBe(0)
    writeFileSync(join(repo, "CHANGELOG.md"), "## [Unreleased]\nRemoved asset.\n\n## [1.0.0]\nOld note.\n")
    git("add", ".")
    git("commit", "-qm", "document removal")
    const head = git("rev-parse", "HEAD")
    git("checkout", "-q", "base")
    writeFileSync(join(repo, "CHANGELOG.md"), "## [Unreleased]\nBase-only note.\n\n## [1.0.0]\nOld note.\n")
    git("add", ".")
    git("commit", "-qm", "advance base")
    const advancedBase = git("rev-parse", "HEAD")
    git("checkout", "-q", head)
    expect(run(advancedBase).status).toBe(0)
    const runPr = (pr) => spawnSync(process.execPath, [script, "--repo", repo, "--base", advancedBase, "--pr", pr], { encoding: "utf8", cwd: "/tmp" })
    expect(runPr("7").status).toBe(1)
    expect(runPr("7").stdout).toContain("pull/7")
    expect(runPr("not-a-number").status).toBe(1)
    expect(run("--invalid-option").status).toBe(1)
    expect(run(base, "{}").status).toBe(1)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test("workflow emits one real gate verdict for every label event and passes the merge queue", () => {
  const workflow = load(readFileSync(new URL("../.github/workflows/changelog-gate.yml", import.meta.url), "utf8"))
  const ci = load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))
  const checks = Object.values(workflow.jobs).filter((job) => job.name === "Changelog gate")
  expect(checks).toHaveLength(1)
  const [job] = checks
  expect(workflow.on.pull_request.branches).toEqual(["dev"])
  expect(workflow.on.pull_request.types).toEqual(["opened", "synchronize", "reopened", "labeled", "unlabeled"])
  expect(workflow.concurrency).toBeUndefined()
  expect(job.if).toBeUndefined()
  expect(job.concurrency.group).not.toBe(ci.concurrency.group)
  expect(ci.on.pull_request.types).not.toContain("labeled")
  expect(ci.on.pull_request.types).not.toContain("unlabeled")
  expect(workflow.on.merge_group.types).toContain("checks_requested")
  const gate = job.steps.find((step) => step.env?.EVENT_NAME)
  expect(gate.if).toBeUndefined()
  const repo = mkdtempSync(join(tmpdir(), "changelog-workflow-"))
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()
  const run = (eventName, labels, base, head) => spawnSync("bash", ["-eo", "pipefail", "-c", gate.run], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, EVENT_NAME: eventName, CHANGELOG_GATE_LABELS: JSON.stringify(labels), CHANGELOG_GATE_BASE: base, PR_HEAD: head },
  })
  try {
    git("init", "-q")
    git("config", "user.name", "YeonGyu-Kim")
    git("config", "user.email", "code.yeon.gyu@gmail.com")
    writeFileSync(join(repo, "package.json"), JSON.stringify({ files: ["runtime.mjs"] }))
    writeFileSync(join(repo, "runtime.mjs"), "export const value = 1\n")
    writeFileSync(join(repo, "CHANGELOG.md"), "## [Unreleased]\n\n")
    git("add", ".")
    git("commit", "-qm", "initial fixture")
    const ancestor = git("rev-parse", "HEAD")
    writeFileSync(join(repo, "runtime.mjs"), "export const value = 2\n")
    git("add", ".")
    git("commit", "-qm", "old PR without gate or note")
    const head = git("rev-parse", "HEAD")
    git("checkout", "-q", ancestor)
    mkdirSync(join(repo, "script"))
    for (const name of ["check-pr-changelog.mjs", "changelog-shipping-policy.mjs"]) {
      writeFileSync(join(repo, "script", name), readFileSync(new URL(name, import.meta.url), "utf8"))
    }
    git("add", ".")
    git("commit", "-qm", "base adopts gate")
    const base = git("rev-parse", "HEAD")
    // The gate comes from this base checkout, not the older PR head.
    expect(spawnSync("git", ["-C", repo, "cat-file", "-e", `${head}:script/check-pr-changelog.mjs`]).status).not.toBe(0)
    for (const labels of [[], ["bug"], ["ci:full-matrix"], ["no-changelog"]]) {
      const result = run("pull_request", labels, base, head)
      expect(result.status, `${result.stderr}\nsignal=${result.signal}`).toBe(labels.includes("no-changelog") ? 0 : 1)
      expect(result.stdout.match(/changelog-gate: (?:PASS|FAIL)/g)).toHaveLength(1)
    }
    expect(run("merge_group", [], "", "").status).toBe(0)
    const summary = job.steps.find((step) => step.name === "Write job summary")
    const summaryPath = join(repo, "summary.md")
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", summary.run], {
      cwd: repo, env: { ...process.env, JOB_STATUS: "failure", GITHUB_STEP_SUMMARY: summaryPath }, encoding: "utf8",
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(summaryPath, "utf8")).toContain("failure")
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}, 20_000)
