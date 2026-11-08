/**
 * Changelog gate rules — the ONE shared implementation for every repo in the fragments rollout.
 * Vendored byte-identical from sisyphuslabs/common-infra modules/changelog-gate/. The rule is
 * deliberately simple so bypass classes cannot exist (lead order, 2026-10-18):
 *
 * 1. A non-release PR may not touch the changelog at all — any add, modification or deletion
 *    (including a rename, because the runner lists both sides with --no-renames) fails.
 * 2. A user-facing PR adds EXACTLY ONE fragment: changes/unreleased/<pr-number>.md, non-empty.
 *    Modifying or deleting ANY existing fragment outside a release fails. The no-changelog
 *    label is an escape only when the PR touches no user-facing path.
 * 3. Only a release PR may edit the changelog — identified by the release branch pattern AND
 *    the release workflow's marker AND the PR author's login (pull_request.user.login) being
 *    the configured release identity. A PR cannot forge its author. It must touch the
 *    changelog and delete every numeric fragment the base carried.
 * 4. References inside a fragment are plain text. The gate does not validate them. A COPIED
 *    fragment is indistinguishable from new text and is accepted under the copier's own PR
 *    number; the gate cannot and should not tell them apart.
 *
 * Runner contract (part of this module): changed paths come as three lists — addedFiles,
 * modifiedFiles, deletedFiles — computed with git diff --no-renames, so a rename appears as
 * its two sides and can never hide a changelog touch.
 */

export const FRAGMENT_DIR = "changes/unreleased";

export function fragmentPath(pr: number): string {
  return `${FRAGMENT_DIR}/${pr}.md`;
}

const NUMERIC_FRAGMENT = /^\d+\.md$/;

export type GatePolicy = {
  /** Branch names that may carry release commits, e.g. /^release\//. */
  readonly releaseBranchPattern: RegExp;
  /** Logins (pull_request.user.login) allowed to author a release PR, e.g. ["release-bot[bot]"]. */
  readonly releaseActors: readonly string[];
  readonly userFacingRoots: readonly string[];
  /** A repo whose shipped surface is computed (for example from its package manifests) passes
   * its own classifier. When present it REPLACES userFacingRoots (pass []) and the default
   * exemptions for every verdict, including the release PR's check. The changelog and fragment
   * paths are never user-facing, whatever it answers. A classifier that throws fails the run.
   * Absent means the root-based classifier below. */
  readonly isUserFacing?: (path: string) => boolean;
  /** Paths a release PR may carry besides the changelog and fragments, even under a
   * user-facing root: the version bumps, lockfile and generated bundles the release workflow
   * itself writes, e.g. /^packages\/[^/]+\/package\.json$/. A pattern must start with ^ (an
   * unanchored one fails the release); a match covers an add, a modify or a delete. Any other
   * user-facing path still fails a release PR. Absent means none. Matched with `search`, which
   * ignores lastIndex, so a /g or /y flag cannot change the answer between paths. */
  readonly releaseArtifacts?: readonly RegExp[];
};

/** Directory exemptions are anchored at the repo root (docs/, dist/, fixtures/, tests/):
 * a docs PAGE inside an app is user-facing. Test-shaped names (including snapshots) and
 * node_modules are exempt anywhere. Roots are compared with a guaranteed trailing slash. */
const DEFAULT_NON_USER_FACING =
  /^(?:docs?|dist|fixtures?|tests?|__tests__)\/|(?:^|\/)node_modules\/(?:$|\/.*)|(?:^|\/)__tests__\/|\.(?:test|spec|snap|fixture)(?:\.[cm]?[jt]sx?)?$|\.generated\.[cm]?[jt]sx?$/i;

/** A path whose behaviour a user or client of the repo can observe: the repo's own classifier
 * when the policy has one, else the root rule. Markdown is NOT exempt by default: prompts and
 * docs shipped under a user-facing root are user-facing. */
export function isUserFacingPath(path: string, policy: GatePolicy): boolean {
  if (path === "CHANGELOG.md" || path === "changes.md" || path.startsWith(`${FRAGMENT_DIR}/`)) return false;
  if (policy.isUserFacing) return policy.isUserFacing(path);
  if (DEFAULT_NON_USER_FACING.test(path)) return false;
  return policy.userFacingRoots.some((root) => path.startsWith(root.endsWith("/") ? root : `${root}/`));
}

/** The one assembly order: fragments joined newest-PR-first with one blank line between
 * entries. A repo's stamp step must use THIS function. */
export const assembleUnreleasedBody = (fragments: readonly { pr: number; content: string }[]): string =>
  [...fragments]
    .sort((left, right) => right.pr - left.pr)
    .map((fragment) => fragment.content)
    .join("\n\n");

export type GateInput = {
  /** All three computed with --no-renames, so a rename lists both of its sides. */
  readonly addedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly branch: string;
  /** True only when the release workflow itself runs the gate (its own marker, never a label). */
  readonly isReleaseWorkflow: boolean;
  /** The PR author's login (pull_request.user.login), as the CI gate passes it; a PR cannot forge its author. */
  readonly actor: string;
  readonly labels: readonly string[];
  /** This PR's number; the single added fragment must be exactly fragmentPath(prNumber). */
  readonly prNumber: number;
  /** The single added fragment's content, or null when no fragment was added. */
  readonly addedFragment: { readonly content: string } | null;
  /** The added changelog file's content AT HEAD (git show <head>:<path>, never the working tree), when one was added (else null). */
  readonly addedChangelog: string | null;
  /** The added file's git mode at head ("100644" regular, "120000" symlink); symlinks refuse. */
  readonly addedChangelogMode: string;
  /** Whether the base already carried a changelog file (either name). */
  readonly baseHasChangelog: boolean;
  /** Fragment file names present under changes/unreleased at the base and at the head. */
  readonly baseFragments: readonly string[];
  readonly headFragments: readonly string[];
};

const allPaths = (input: GateInput): readonly string[] => [
  ...input.addedFiles,
  ...input.modifiedFiles,
  ...input.deletedFiles,
];

/** The full gate verdict. The order is part of the contract. */
export function checkPrChangelog(input: GateInput, policy: GatePolicy): { pass: boolean; reason: string } {
  const paths = allPaths(input);
  const changelogTouched = paths.some((path) => path === "CHANGELOG.md" || path === "changes.md");
  const isRelease =
    input.isReleaseWorkflow && policy.releaseBranchPattern.test(input.branch) && policy.releaseActors.includes(input.actor);
  if (isRelease) {
    const artifacts = policy.releaseArtifacts ?? [];
    const unanchored = artifacts.find((pattern) => !pattern.source.startsWith("^"));
    if (unanchored) {
      return { pass: false, reason: `releaseArtifacts pattern must be anchored with ^: /${unanchored.source}/` };
    }
    const code = paths.filter((path) => isUserFacingPath(path, policy) && !artifacts.some((pattern) => path.search(pattern) !== -1));
    if (code.length > 0) {
      return { pass: false, reason: `a release PR must not change user-facing files: ${code.slice(0, 3).join(", ")}` };
    }
    if (!changelogTouched) {
      return { pass: false, reason: "a release PR must edit the changelog" };
    }
    const leftover = input.headFragments.filter((name) => NUMERIC_FRAGMENT.test(name));
    if (leftover.length > 0) {
      return { pass: false, reason: "a release PR must delete every fragment it consumes" };
    }
    if (!input.baseFragments.some((name) => NUMERIC_FRAGMENT.test(name))) {
      return { pass: false, reason: "a release PR must consume the base's fragments" };
    }
    return { pass: true, reason: "release PR consumed the fragments" };
  }
  // Bootstrap (guarded so it cannot become a backdoor): a repository gaining its FIRST
  // changelog may add the skeleton file on a non-release PR — a title plus an EMPTY
  // ## [Unreleased] with nothing under it. Any real entry still goes in a fragment, and a
  // repository that already has a changelog gets no exception (rename or recreate included).
  const skeleton = (text: string): boolean => {
    if (/\r(?!\n)/.test(text)) return false;
    const lines = text.split(/\r\n|\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const unreleased = lines.findIndex((line) => line === "## [Unreleased]");
    if (unreleased === -1 || lines.slice(unreleased + 1).length !== 0) return false;
    const above = lines.slice(0, unreleased);
    return above.length === 0 || (above.length === 1 && above[0] === "# Changelog");
  };
  const changelogPathsInPr = paths.filter((path) => path === "CHANGELOG.md" || path === "changes.md");
  const onlyChangelog = changelogPathsInPr.length === 1 ? changelogPathsInPr[0] : undefined;
  const changelogAdded = onlyChangelog !== undefined && input.addedFiles.includes(onlyChangelog);
  if (changelogTouched && !(changelogAdded && input.baseHasChangelog === false)) {
    return { pass: false, reason: "only the release PR may edit the changelog; add a fragment instead" };
  }
  if (changelogAdded && input.baseHasChangelog === false) {
    if (input.addedChangelogMode !== "100644" && input.addedChangelogMode !== "100755") {
      return { pass: false, reason: "the changelog file must be a regular file" };
    }
    if (input.addedChangelog === null || !skeleton(input.addedChangelog)) {
      return { pass: false, reason: "a first changelog must be the empty skeleton (the exact title line '# Changelog' plus an empty ## [Unreleased]); entries go in fragments" };
    }
  }
  const fragmentEdits = input.modifiedFiles.filter((path) => path.startsWith(`${FRAGMENT_DIR}/`));
  const fragmentRemovals = input.deletedFiles.filter((path) => path.startsWith(`${FRAGMENT_DIR}/`));
  if (fragmentEdits.length > 0 || fragmentRemovals.length > 0) {
    return { pass: false, reason: "fragments are immutable outside a release; add your own instead" };
  }
  const addedFragments = input.addedFiles.filter((path) => path.startsWith(`${FRAGMENT_DIR}/`));
  for (const path of addedFragments) {
    if (!NUMERIC_FRAGMENT.test(path.slice(FRAGMENT_DIR.length + 1))) {
      return { pass: false, reason: `changelog fragment must be named <pr-number>.md, got: ${path}` };
    }
  }
  const userFacing = paths.filter((path) => isUserFacingPath(path, policy));
  const labelled = input.labels.map((label) => label.trim()).includes("no-changelog");
  if (labelled && userFacing.length > 0) {
    return { pass: false, reason: "no-changelog refused: user-facing paths changed" };
  }
  if (labelled && addedFragments.length > 0) {
    return { pass: false, reason: "the no-changelog label cannot carry fragment additions" };
  }
  if (labelled) return { pass: true, reason: "no-changelog label present" };
  if (userFacing.length === 0 && addedFragments.length === 0) {
    return { pass: true, reason: "no user-facing changes" };
  }
  if (addedFragments.length !== 1) {
    return { pass: false, reason: `a user-facing PR adds exactly one fragment (found ${addedFragments.length})` };
  }
  if (addedFragments[0] !== fragmentPath(input.prNumber)) {
    return { pass: false, reason: `the fragment must be named for this PR: ${FRAGMENT_DIR}/<pr-number>.md` };
  }
  if (input.addedFragment === null || !input.addedFragment.content.trim()) {
    return { pass: false, reason: "the added fragment is empty" };
  }
  return { pass: true, reason: `added fragment #${input.prNumber}` };
}


/** The shared base-fetch the runners call when rev-parse cannot see the base commit: check
 * first (cheap), then deepen a shallow clone (a bare sha fetch would leave the histories
 * unconnected), re-check, then fall back to fetching the exact sha. */
export function fetchBaseIfMissing(git: (args: readonly string[]) => string, base: string): void {
  const present = (): boolean => {
    try {
      git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  if (present()) return;
  try {
    git(["fetch", "--unshallow", "origin"]);
  } catch {
    /* not shallow, or unshallow failed; the sha fetch below is the fallback */
  }
  if (present()) return;
  git(["fetch", "origin", base]);
}
