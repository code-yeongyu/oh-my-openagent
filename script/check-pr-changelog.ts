#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { checkPrChangelog, fetchBaseIfMissing, FRAGMENT_DIR, fragmentPath } from "./changelog-gate-rules.ts";
import { GATE_CONFIG } from "./changelog-gate.config.ts";
import { isUserFacingPath as isShippedPath, shippingPolicy } from "./changelog-shipping-policy.mjs";
import { checkPackageLogs } from "./package-log-gate.ts";
import { isReleaseStatePr } from "./release-pr-marker.ts";

function run(): number {
  const base = process.env["CHANGELOG_GATE_BASE"];
  const baseRef = process.env["CHANGELOG_GATE_BASE_REF"];
  const branch = process.env["CHANGELOG_GATE_BRANCH"] ?? "";
  const actor = process.env["CHANGELOG_GATE_ACTOR"] ?? "";
  const prRaw = process.env["CHANGELOG_GATE_PR"] ?? "";
  const labels: readonly string[] = JSON.parse(process.env["CHANGELOG_GATE_LABELS"] ?? "[]");
  // The release-state PR is what only publish.yml produces: a release branch pushed to this repository
  // (CHANGELOG_GATE_RELEASE) carrying publish.yml's own title/body/branch marker (#10709). Its author is NOT part of it:
  // publish.yml reuses whatever open PR sits on its fixed branch, so whoever opened that PR first decides nothing (#11704).
  const isReleaseWorkflow = process.env["CHANGELOG_GATE_RELEASE"] === "1"
    && GATE_CONFIG.releaseBranchPattern.test(branch)
    && isReleaseStatePr({ branch, title: process.env["CHANGELOG_GATE_TITLE"] ?? "", body: process.env["CHANGELOG_GATE_BODY"] ?? "" });
  if (!base) throw new Error("missing CHANGELOG_GATE_BASE");
  if (prRaw && !/^\d+$/.test(prRaw)) throw new Error("CHANGELOG_GATE_PR must be a PR number");
  const prNumber = prRaw ? Number(prRaw) : 0;
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
  const head = git("rev-parse", "--verify", "--end-of-options", "HEAD^{commit}").trim();
  fetchBaseIfMissing((args) => git(...args), base);
  const resolveBaseBranch = (): string | null => {
    if (!baseRef) return null;
    try {
      git("fetch", "origin", baseRef);
    } catch {
      /* already current or offline */
    }
    try {
      return git("rev-parse", "--verify", "--end-of-options", `origin/${baseRef}^{commit}`).trim();
    } catch {
      return null;
    }
  };
  const baseBranchHead = resolveBaseBranch();
  if (baseBranchHead === null) {
    console.error("changelog-gate: WARN - could not resolve the base branch head; diffing against the (possibly stale) PR base sha");
  }
  const baseHead = baseBranchHead ?? git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
  const mergeBase = git("merge-base", baseHead, head).trim();
  const list = (filter: string) => git("diff", "--no-renames", "--name-only", "--diff-filter=" + filter, "-z", mergeBase, head).split("\0").filter(Boolean);
  // User-facing means shipped, at either end of the diff (#10841): the manifests' files/bin, build generators and binary
  // crates decide, so a test helper or a CI script needs no fragment while a removed shipped file still does.
  const policyAt = (rev: string) => shippingPolicy(
    git("ls-tree", "-r", "--name-only", "-z", rev).split("\0").filter(Boolean),
    (path) => git("show", `${rev}:${path}`),
  );
  const shipped = [policyAt(head), policyAt(mergeBase)];
  // The vendored rules also match the PR author against releaseActors. Here the marker is the release identity, so the
  // author of a marked release PR is its release actor, and no account list exists for anyone to grow.
  const policy = {
    ...GATE_CONFIG,
    releaseActors: isReleaseWorkflow ? [actor] : [],
    isUserFacing: (path: string) => shipped.some((at) => isShippedPath(path, at)),
  };
  const addedFiles = list("A");
  const modifiedFiles = list("M");
  const deletedFiles = list("D");
  const dirNames = (rev: string) => {
    try {
      return git("ls-tree", "-r", "--name-only", rev, "--", FRAGMENT_DIR).split("\n").map((p) => p.trim()).filter((p) => p.length > FRAGMENT_DIR.length + 1).map((p) => p.slice(FRAGMENT_DIR.length + 1));
    } catch {
      return [];
    }
  };
  // CI checks out refs/pull/<n>/merge: the PR merged into the base tip. There the release owes the fragments at its
  // cut (the PR side's merge base), and fragments the base gained after the cut belong to the next release (#11554).
  const [, baseSide, prSide, ...extraParents] = git("rev-list", "--parents", "-n", "1", head).trim().split(" ");
  const mergedIntoBase = baseSide !== undefined && prSide !== undefined && extraParents.length === 0
    && isAncestor(baseSide, baseHead);
  const cut = mergedIntoBase ? git("merge-base", baseHead, prSide).trim() : mergeBase;
  const baseFragments = dirNames(cut);
  const postCut = mergedIntoBase ? dirNames(baseSide).filter((name) => !baseFragments.includes(name)) : [];
  const headFragments = dirNames(head).filter((name) => !postCut.includes(name));
  const ownPath = prNumber > 0 ? fragmentPath(prNumber) : null;
  const addedFragment = ownPath && addedFiles.includes(ownPath)
    ? { content: git("show", `${head}:${ownPath}`) }
    : null;
  // The module's bootstrap inputs: the base BRANCH head (never the merge base) decides whether a
  // changelog already exists, and an added changelog is read from the head blob with its mode.
  const existsAt = (rev: string, path: string): boolean => {
    try {
      execFileSync("git", ["cat-file", "-e", `${rev}:${path}`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const baseHasChangelog = existsAt(baseHead, "CHANGELOG.md") || existsAt(baseHead, "changes.md");
  const addedChangelogPath = addedFiles.find((path) => path === "CHANGELOG.md" || path === "changes.md");
  const addedChangelog = addedChangelogPath ? git("show", `${head}:${addedChangelogPath}`) : null;
  const addedChangelogMode = addedChangelogPath ? git("ls-tree", head, "--", addedChangelogPath).split(/\s/)[0] ?? "" : "100644";
  const result = checkPrChangelog(
    {
      addedFiles, modifiedFiles, deletedFiles, branch, isReleaseWorkflow, actor, labels, prNumber, addedFragment,
      addedChangelog, addedChangelogMode, baseHasChangelog, baseFragments, headFragments,
    },
    policy,
  );
  console.log(`changelog-gate: ${result.pass ? "PASS" : "FAIL"} - ${result.reason}`);
  const packageLogs = checkPackageLogs({
    addedFiles, modifiedFiles, deletedFiles,
    // The SAME release predicate as the shared gate (#10682 review HIGH): the release marker on a release branch.
    isRelease: isReleaseWorkflow,
    fragment: addedFragment?.content ?? null,
    existsAtHead: (path) => existsAt(head, path),
  });
  console.log(`changelog-gate: package logs ${packageLogs.pass ? "PASS" : "FAIL"} - ${packageLogs.reason}`);
  return result.pass && packageLogs.pass ? 0 : 1;
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`changelog-gate: ERROR - ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
