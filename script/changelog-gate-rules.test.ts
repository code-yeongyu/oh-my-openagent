import { describe, expect, test } from "bun:test";
import { checkPrChangelog, isUserFacingPath } from "./changelog-gate-rules.ts";

const POLICY = {
  releaseBranchPattern: /^release\//,
  releaseActors: ["release-bot[bot]"],
  userFacingRoots: ["apps/", "src/"],
};
const base = {
  addedFragment: null,
  addedChangelog: null,
  addedChangelogMode: "100644",
  baseHasChangelog: true,
  branch: "feat/thing",
  isReleaseWorkflow: false,
  actor: "someone",
  labels: [] as string[],
  prNumber: 7,
  addedFiles: [] as string[],
  modifiedFiles: [] as string[],
  deletedFiles: [] as string[],
  baseFragments: [] as string[],
  headFragments: [] as string[],
};

describe("the simple rule (identical in every repo)", () => {
  test("any changelog touch — add, modify, delete, or rename side — fails a non-release PR", () => {
    for (const files of [
      { addedFiles: ["CHANGELOG.md"] },
      { modifiedFiles: ["changes.md"] },
      { deletedFiles: ["CHANGELOG.md"] },
    ]) {
      const result = checkPrChangelog({ ...base, ...files }, POLICY);
      expect(result.pass).toBe(false);
      expect(result.reason).toContain("only the release PR");
    }
  });
  test("modifying or deleting an existing fragment fails; only ADDING one's own is allowed", () => {
    const editOthers = checkPrChangelog(
      { ...base, addedFiles: ["apps/api/src/index.ts"], modifiedFiles: ["changes/unreleased/5.md"], addedFragment: { content: "x" } },
      POLICY,
    );
    expect(editOthers.pass).toBe(false);
    expect(editOthers.reason).toContain("immutable");
    const deleteOthers = checkPrChangelog({ ...base, deletedFiles: ["changes/unreleased/5.md"] }, POLICY);
    expect(deleteOthers.pass).toBe(false);
    expect(deleteOthers.reason).toContain("immutable");
  });
  test("a non-numeric fragment name fails at add time", () => {
    const stray = checkPrChangelog(
      { ...base, addedFiles: ["apps/api/src/index.ts", "changes/unreleased/notes.txt"], addedFragment: { content: "x" } },
      POLICY,
    );
    expect(stray.pass).toBe(false);
    expect(stray.reason).toContain("<pr-number>.md");
  });
  test("a user-facing PR with ZERO fragments and no label is refused", () => {
    const zero = checkPrChangelog({ ...base, addedFiles: ["apps/api/src/index.ts"] }, POLICY);
    expect(zero.pass).toBe(false);
    expect(zero.reason).toContain("exactly one fragment (found 0)");
  });
  test("the fragment must be named for THIS PR's number", () => {
    const wrong = checkPrChangelog(
      { ...base, prNumber: 9, addedFiles: ["apps/api/src/index.ts", "changes/unreleased/7.md"], addedFragment: { content: "text" } },
      POLICY,
    );
    expect(wrong.pass).toBe(false);
    expect(wrong.reason).toContain("named for this PR");
  });
  test("a user-facing PR adds exactly one non-empty fragment; two or empty fail", () => {
    const one = checkPrChangelog(
      { ...base, addedFiles: ["apps/api/src/index.ts", "changes/unreleased/7.md"], addedFragment: { content: "Any text. (#7)" } },
      POLICY,
    );
    expect(one.pass).toBe(true);
    expect(one.reason).toContain("#7");
    const two = checkPrChangelog(
      { ...base, addedFiles: ["apps/api/src/index.ts", "changes/unreleased/7.md", "changes/unreleased/8.md"], addedFragment: { content: "x" } },
      POLICY,
    );
    expect(two.pass).toBe(false);
    expect(two.reason).toContain("exactly one");
    const empty = checkPrChangelog(
      { ...base, addedFiles: ["apps/api/src/index.ts", "changes/unreleased/7.md"], addedFragment: { content: " " } },
      POLICY,
    );
    expect(empty.reason).toContain("empty");
  });
  test("the no-changelog label is refused for user-facing paths and passes otherwise", () => {
    expect(checkPrChangelog({ ...base, addedFiles: ["apps/api/src/index.ts"], labels: ["no-changelog"] }, POLICY).pass).toBe(false);
    expect(checkPrChangelog({ ...base, addedFiles: ["docs/guide.md"], labels: ["no-changelog"] }, POLICY).pass).toBe(true);
  });
  test("the no-changelog label cannot carry fragment additions", () => {
    const withFragment = checkPrChangelog(
      { ...base, labels: ["no-changelog"], addedFiles: ["docs/guide.md", "changes/unreleased/999.md"], addedFragment: { content: "x" } },
      POLICY,
    );
    expect(withFragment.pass).toBe(false);
    expect(withFragment.reason).toContain("cannot carry fragment additions");
  });
  test("a renamed fragment (delete + add under --no-renames) is refused as immutable", () => {
    const renamed = checkPrChangelog(
      { ...base, addedFiles: ["changes/unreleased/7.md"], deletedFiles: ["changes/unreleased/5.md"], addedFragment: { content: "text" } },
      POLICY,
    );
    expect(renamed.pass).toBe(false);
    expect(renamed.reason).toContain("immutable");
  });
  test("bootstrap: a greenfield PR adds the empty skeleton and passes", () => {
    const boot = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n\n## [Unreleased]\n\n" },
      POLICY,
    );
    expect(boot.pass).toBe(true);
  });
  test("bootstrap: an added changelog with entries fails; entries go in fragments", () => {
    const withEntries = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n\n## [Unreleased]\n\n**Note.** text (#7)\n" },
      POLICY,
    );
    expect(withEntries.pass).toBe(false);
    expect(withEntries.reason).toContain("empty skeleton");
  });
  test("bootstrap: recreating the changelog when the base already has one still refuses", () => {
    const recreate = checkPrChangelog(
      { ...base, baseHasChangelog: true, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n\n## [Unreleased]\n\n" },
      POLICY,
    );
    expect(recreate.pass).toBe(false);
    expect(recreate.reason).toContain("only the release PR");
  });
  test("bootstrap: entries ABOVE the heading fail; only an optional # title passes", () => {
    const aboveEntries = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "## [1.0.0]\n- **Big feature** shipped (#9)\n## [Unreleased]\n" },
      POLICY,
    );
    expect(aboveEntries.pass).toBe(false);
    const bulletTitle = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n- **Feature** (#9)\n## [Unreleased]\n" },
      POLICY,
    );
    expect(bulletTitle.pass).toBe(false);
    const plainTitle = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n## [Unreleased]\n" },
      POLICY,
    );
    expect(plainTitle.pass).toBe(true);
  });
  test("bootstrap: adding BOTH changelog files fails; the exception needs the PR's single changelog path", () => {
    const both = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md", "CHANGELOG.md"], addedChangelog: "# Changelog\n## [Unreleased]\n" },
      POLICY,
    );
    expect(both.pass).toBe(false);
    expect(both.reason).toContain("only the release PR");
  });
  test("bootstrap: an added changelog alongside a MODIFIED or DELETED one fails", () => {
    const mixed = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], modifiedFiles: ["CHANGELOG.md"], addedChangelog: "# Changelog\n## [Unreleased]\n" },
      POLICY,
    );
    expect(mixed.pass).toBe(false);
    const removed = checkPrChangelog(
      { ...base, addedFiles: ["changes.md"], deletedFiles: ["CHANGELOG.md"], baseHasChangelog: true, addedChangelog: "# Changelog\n## [Unreleased]\n" },
      POLICY,
    );
    expect(removed.pass).toBe(false);
  });
  test("bootstrap: a symlinked changelog fails", () => {
    const link = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n## [Unreleased]\n", addedChangelogMode: "120000" },
      POLICY,
    );
    expect(link.pass).toBe(false);
    expect(link.reason).toContain("regular file");
  });
  test("bootstrap: CHANGELOG.md as the added name takes the same skeleton rule", () => {
    const upper = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["CHANGELOG.md"], addedChangelog: "# Changelog\n## [Unreleased]\n" },
      POLICY,
    );
    expect(upper.pass).toBe(true);
  });
  test("bootstrap: carriage-return, entry-as-title, comment-in-title and fake-heading titles all fail", () => {
    const cases: readonly [string, boolean][] = [
      ["# Changelog\r- **Big feature** shipped (#9)\r\n## [Unreleased]\n", false],
      ["# Changelog: shipped OAuth login and billing (#9)\n## [Unreleased]\n", false],
      ["# Changelog <!-- - **secret** (#9) -->\n## [Unreleased]\n", false],
      ["# ## [1.0.0] - entries\n## [Unreleased]\n", false],
      ["# Changelog\n## [Unreleased]\n", true],
      ["## [Unreleased]\n", true],
    ];
    for (const [content, expected] of cases) {
      const result = checkPrChangelog(
        { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: content },
        POLICY,
      );
      expect(result.pass).toBe(expected);
    }
  });
  test("bootstrap: a gitlink (160000) mode is refused alongside symlinks", () => {
    const gitlink = checkPrChangelog(
      { ...base, baseHasChangelog: false, addedFiles: ["changes.md"], addedChangelog: "# Changelog\n## [Unreleased]\n", addedChangelogMode: "160000" },
      POLICY,
    );
    expect(gitlink.pass).toBe(false);
    expect(gitlink.reason).toContain("regular file");
  });
  test("a non-user-facing PR without fragments passes", () => {
    expect(checkPrChangelog({ ...base, modifiedFiles: ["README.md", "scripts/build.ts"] }, POLICY).pass).toBe(true);
  });
});

describe("release identity and consumption", () => {
  const releaseBase = {
    prNumber: 7,
    addedFragment: null,
    addedChangelog: null,
    addedChangelogMode: "100644",
    baseHasChangelog: true,
    branch: "release/v1.2.0",
    isReleaseWorkflow: true,
    actor: "release-bot[bot]",
    labels: [] as string[],
    addedFiles: [] as string[],
    modifiedFiles: [] as string[],
    deletedFiles: [] as string[],
    baseFragments: ["7.md"],
    headFragments: [] as string[],
  };
  test("branch + workflow marker + release actor may edit and must consume every numeric fragment", () => {
    const ok = checkPrChangelog({ ...releaseBase, deletedFiles: ["changes/unreleased/7.md"], modifiedFiles: ["CHANGELOG.md"] }, POLICY);
    expect(ok.pass).toBe(true);
  });
  test("a .gitkeep is not a fragment on either side", () => {
    const keep = checkPrChangelog({ ...releaseBase, deletedFiles: ["changes/unreleased/7.md"], modifiedFiles: ["CHANGELOG.md"], headFragments: [".gitkeep"] }, POLICY);
    expect(keep.pass).toBe(true);
  });
  test("a release with only .gitkeep at the base has nothing to consume and fails", () => {
    const nothing = checkPrChangelog({ ...releaseBase, modifiedFiles: ["CHANGELOG.md"], baseFragments: [".gitkeep"] }, POLICY);
    expect(nothing.pass).toBe(false);
    expect(nothing.reason).toContain("consume");
  });
  test("a release PR carrying user-facing code is refused", () => {
    const withCode = checkPrChangelog(
      { ...releaseBase, addedFiles: ["apps/api/src/index.ts"], deletedFiles: ["changes/unreleased/7.md"], modifiedFiles: ["CHANGELOG.md"] },
      POLICY,
    );
    expect(withCode.pass).toBe(false);
    expect(withCode.reason).toContain("must not change user-facing files");
  });
  test("declared release artifacts may ride a release PR; any other user-facing path still fails", () => {
    const policy = { ...POLICY, releaseArtifacts: [/^apps\/[^/]+\/package\.json$/, /^bun\.lock$/] };
    const release = { ...releaseBase, deletedFiles: ["changes/unreleased/7.md"] };
    const bump = checkPrChangelog({ ...release, modifiedFiles: ["CHANGELOG.md", "apps/api/package.json", "bun.lock"] }, policy);
    expect(bump).toEqual({ pass: true, reason: "release PR consumed the fragments" });
    const sneak = checkPrChangelog({ ...release, modifiedFiles: ["CHANGELOG.md", "apps/api/package.json", "apps/api/src/index.ts"] }, policy);
    expect(sneak.pass).toBe(false);
    expect(sneak.reason).toContain("apps/api/src/index.ts");
    // The same bump without the declaration is refused, and the declaration grants nothing outside a release.
    expect(checkPrChangelog({ ...release, modifiedFiles: ["CHANGELOG.md", "apps/api/package.json"] }, POLICY).pass).toBe(false);
    expect(checkPrChangelog({ ...base, modifiedFiles: ["apps/api/package.json"] }, policy).pass).toBe(false);
  });

  test("a global or sticky artifact pattern matches every path the same way", () => {
    const policy = { ...POLICY, releaseArtifacts: [/^apps\/[^/]+\/package\.json$/gy] };
    const files = ["CHANGELOG.md", "apps/api/package.json", "apps/web/package.json", "apps/cli/package.json"];
    const bump = checkPrChangelog({ ...releaseBase, deletedFiles: ["changes/unreleased/7.md"], modifiedFiles: files }, policy);
    expect(bump).toEqual({ pass: true, reason: "release PR consumed the fragments" });
  });

  test("an unanchored artifact pattern fails the release instead of exempting by substring", () => {
    const policy = { ...POLICY, releaseArtifacts: [/package\.json$/] };
    const result = checkPrChangelog({ ...releaseBase, deletedFiles: ["changes/unreleased/7.md"], modifiedFiles: ["CHANGELOG.md", "apps/api/package.json"] }, policy);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("anchored");
  });

  test("a release without a changelog edit fails", () => {
    const noEdit = checkPrChangelog({ ...releaseBase, deletedFiles: ["changes/unreleased/7.md"] }, POLICY);
    expect(noEdit.pass).toBe(false);
    expect(noEdit.reason).toContain("must edit the changelog");
  });
  test("the branch name, the marker, or a wrong actor alone is NOT a release PR", () => {
    const branchOnly = { 
...base, branch: "release/v1.2.0", baseFragments: ["7.md"] as string[] };
    expect(checkPrChangelog({ ...branchOnly, modifiedFiles: ["CHANGELOG.md"] }, POLICY).pass).toBe(false);
    const markerOnly = { 
...base, isReleaseWorkflow: true, baseFragments: ["7.md"] as string[] };
    expect(checkPrChangelog({ ...markerOnly, modifiedFiles: ["CHANGELOG.md"] }, POLICY).pass).toBe(false);
    const wrongActor = { 
...releaseBase, actor: "a-human" };
    expect(checkPrChangelog({ ...wrongActor, modifiedFiles: ["CHANGELOG.md"], deletedFiles: ["changes/unreleased/7.md"] }, POLICY).pass).toBe(false);
  });
});

describe("the classifier", () => {
  test("directory exemptions are root-anchored; snapshots and nested tests are exempt", () => {
    expect(isUserFacingPath("docs/guide.md", POLICY)).toBe(false);
    expect(isUserFacingPath("apps/web/src/docs/page.tsx", POLICY)).toBe(true);
    expect(isUserFacingPath("packages/core/off-worker/statements.generated.ts", POLICY)).toBe(false);
    expect(isUserFacingPath("apps/web/src/fixtures/real-runtime.ts", POLICY)).toBe(true);
    expect(isUserFacingPath("apps/x/__tests__/a.ts", POLICY)).toBe(false);
    expect(isUserFacingPath("src/flow.test.ts.snap", POLICY)).toBe(false);
    expect(isUserFacingPath("src/agents/prompt.md", POLICY)).toBe(true);
    expect(isUserFacingPath("node_modules/x/y.js", POLICY)).toBe(false);
  });
  test("a root without a trailing slash does not swallow longer names", () => {
    const p = { ...POLICY, userFacingRoots: ["src"] } as typeof POLICY;
    expect(isUserFacingPath("srcfoo/x.ts", p)).toBe(false);
    expect(isUserFacingPath("src/x.ts", p)).toBe(true);
  });
  test("a repo classifier replaces the roots and the default exemptions in both directions", () => {
    const shipped = new Set(["package.json", "apps/api/test-support/seed.ts"]);
    const p = { ...POLICY, isUserFacing: (path: string) => shipped.has(path) };
    expect(isUserFacingPath("package.json", p)).toBe(true);
    expect(isUserFacingPath("apps/api/test-support/seed.ts", p)).toBe(true);
    expect(isUserFacingPath("apps/api/src/index.ts", p)).toBe(false);
    expect(isUserFacingPath("docs/guide.md", p)).toBe(false);
  });
  test("the changelog and fragment paths are never user-facing, whatever a repo classifier answers", () => {
    const p = { ...POLICY, isUserFacing: () => true };
    for (const path of ["CHANGELOG.md", "changes.md", "changes/unreleased/7.md", "changes/unreleased/README.md"]) {
      expect(isUserFacingPath(path, p)).toBe(false);
    }
    const release = {
      ...base,
      branch: "release/1.2.3",
      isReleaseWorkflow: true,
      actor: "release-bot[bot]",
      baseFragments: ["7.md"],
      modifiedFiles: ["CHANGELOG.md"],
      deletedFiles: ["changes/unreleased/7.md"],
    };
    expect(checkPrChangelog(release, p).pass).toBe(true);
  });
  test("the gate verdicts use the repo classifier", () => {
    const p = { ...POLICY, isUserFacing: (path: string) => path === "bin/cli.ts" };
    // Under a root but not shipped: no fragment needed, and the label escape stays open.
    expect(checkPrChangelog({ ...base, modifiedFiles: ["apps/api/src/ci-only.ts"] }, p)).toEqual({ pass: true, reason: "no user-facing changes" });
    expect(checkPrChangelog({ ...base, labels: ["no-changelog"], modifiedFiles: ["apps/api/src/ci-only.ts"] }, p).pass).toBe(true);
    // Shipped but outside every root: the fragment is required and the label is refused.
    expect(checkPrChangelog({ ...base, modifiedFiles: ["bin/cli.ts"] }, p).pass).toBe(false);
    expect(checkPrChangelog({ ...base, labels: ["no-changelog"], modifiedFiles: ["bin/cli.ts"] }, p).reason).toBe("no-changelog refused: user-facing paths changed");
    const withFragment = { ...base, modifiedFiles: ["bin/cli.ts"], addedFiles: ["changes/unreleased/7.md"], addedFragment: { content: "**Fixed.**" } };
    expect(checkPrChangelog(withFragment, p).pass).toBe(true);
  });
  test("a release PR is judged by the repo classifier too", () => {
    const p = { ...POLICY, isUserFacing: (path: string) => path === "bin/cli.ts" };
    const release = {
      ...base,
      branch: "release/1.2.3",
      isReleaseWorkflow: true,
      actor: "release-bot[bot]",
      baseFragments: ["7.md"],
      headFragments: [] as string[],
      deletedFiles: ["changes/unreleased/7.md"],
    };
    expect(checkPrChangelog({ ...release, modifiedFiles: ["CHANGELOG.md", "apps/api/src/index.ts"] }, p).pass).toBe(true);
    expect(checkPrChangelog({ ...release, modifiedFiles: ["CHANGELOG.md", "bin/cli.ts"] }, p).reason).toBe("a release PR must not change user-facing files: bin/cli.ts");
  });
});
