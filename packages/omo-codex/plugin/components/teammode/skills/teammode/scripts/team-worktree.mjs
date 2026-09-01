// team-worktree.mjs - git worktree provisioning + merge integration for teammode.
//
// Shells out to `git` through node:child_process so the leader never hand-runs worktree or
// merge commands and never improvises a branch name. Zero npm dependencies, like the rest of
// the skill. team-state.mjs stays the pure state model; this file owns the git side only.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// A member id that also names a directory and a branch segment: no "/", no "..", no leading dot.
const MEMBER_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Compare two on-disk paths regardless of OS. realpathSync canonicalizes separators, Windows
// 8.3 short names (RUNNER~1) and drive-letter case, and the macOS /var -> /private/var symlink -
// none of which plain resolve() reconciles. Returns false if either side no longer exists.
function samePath(a, b) {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return false;
	}
}

function git(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.error) throw new Error(`git ${args.join(" ")} could not run: ${result.error.message}`);
	return result;
}

function gitOrThrow(cwd, args) {
	const result = git(cwd, args);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
	return result.stdout ?? "";
}

export function deriveMemberBranch(team, member) {
	if (member.worktree?.branch) return member.worktree.branch;
	return `team/${team.sessionId ?? team.teamId}/${member.id}`;
}

// Confine a member worktree to <worktree.root>/<member id>; reject any id that would escape it.
export function memberWorktreePath(team, member) {
	if (!MEMBER_ID_SEGMENT.test(member.id ?? "")) throw new Error(`unsafe member id for a worktree path: "${member.id}"`);
	const root = team.worktree?.root;
	if (!root) throw new Error("team has no worktree root; re-init the team");
	const path = join(root, member.id);
	const rel = relative(root, path);
	if (rel !== member.id || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refused: worktree path escapes ${root}`);
	return path;
}

export function listWorktrees(cwd) {
	const out = gitOrThrow(cwd, ["worktree", "list", "--porcelain"]);
	const worktrees = [];
	let current = null;
	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			current = { path: line.slice("worktree ".length) };
			worktrees.push(current);
		} else if (line.startsWith("branch ") && current) {
			current.branch = line.slice("branch ".length);
		}
	}
	return worktrees;
}

function branchExists(cwd, branch) {
	return git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}

function currentBranch(cwd) {
	return gitOrThrow(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

export function addMemberWorktree(cwd, team, member, { baseBranch } = {}) {
	const base = baseBranch || team.worktree?.baseBranch || "dev";
	const branch = deriveMemberBranch(team, member);
	const path = memberWorktreePath(team, member);
	// Idempotent: skip if a worktree is already checked out on this member's branch (matched on the
	// branch ref, which is OS-agnostic) or already lives at this path (matched on realpath, so a
	// Windows 8.3 git path vs an 8.3-or-long script path still compares equal). Plain string/resolve
	// comparison missed the 8.3-vs-canonical case and re-`git worktree add`-ed into a fatal error.
	if (listWorktrees(cwd).some((w) => w.branch === `refs/heads/${branch}` || samePath(resolve(cwd, w.path), resolve(cwd, path)))) {
		return { path, branch, base, created: false };
	}
	const add = branchExists(cwd, branch)
		? ["worktree", "add", path, branch]
		: ["worktree", "add", "-b", branch, path, base];
	gitOrThrow(cwd, add);
	return { path, branch, base, created: true };
}

export function removeMemberWorktree(cwd, team, member, { force = false } = {}) {
	const path = memberWorktreePath(team, member);
	gitOrThrow(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), path]);
	return { path };
}

// Land a member branch with a MERGE COMMIT (--no-ff). Never squash, never rebase (repo policy).
// On conflict the working tree is left mid-merge so the leader can resolve and re-run.
export function integrateMemberBranch(cwd, branch) {
	const result = git(cwd, ["merge", "--no-ff", "--no-edit", branch]);
	if (result.status === 0) return { branch, merged: true, into: currentBranch(cwd) };
	const conflicts = gitOrThrow(cwd, ["diff", "--name-only", "--diff-filter=U"]).trim();
	return {
		branch,
		merged: false,
		into: currentBranch(cwd),
		conflicts: conflicts ? conflicts.split("\n") : [],
		message: (result.stderr || result.stdout || "").trim(),
	};
}
