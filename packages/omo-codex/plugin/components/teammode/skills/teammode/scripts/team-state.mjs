// team-state.mjs - the teammode state model + atomic, symlink-guarded persistence.
//
// Zero external dependencies (node builtins only) so it runs byte-identically under
// `node` and `bun` on macOS, Linux, and Windows with no install step, no POSIX shell,
// and no python3 precondition. This is the SINGLE source of the team-state shape: the
// model never hand-writes team.json - it calls these helpers through scripts/team.mjs.
//
// Rendering (the member field manual + bootstrap trigger) lives in team-guide.mjs so
// this file stays the state concern only.

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const LENSES = ["area", "ownership", "perspective"];
export const MEMBER_STATUSES = ["pending", "active", "reported", "blocked", "archived"];
// A team is never a single member: two or more distinct slices is the minimum. One isolated
// job is a subagent, not a team.
export const MIN_MEMBERS = 2;

export function isUnderstaffed(team) {
	return team.members.length < MIN_MEMBERS;
}
// A team dir is a single child of .omo/teams. This pattern alone blocks "/", "\", and a
// leading "." so ".." and "a/b" can never name a team dir (the escape guard).
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isoNow(now) {
	return now ?? new Date().toISOString();
}

export function buildTeam({ teamName, sessionName, sessionId = null, dir = null, worktreeEnabled = false, baseBranch = "dev", now }) {
	if (!teamName?.trim()) throw new Error("team name is required");
	if (!sessionName?.trim()) throw new Error("session name is required");
	const ts = isoNow(now);
	return {
		schemaVersion: 2,
		teamId: randomUUID(),
		teamName: teamName.trim(),
		sessionName: sessionName.trim(),
		sessionId,
		threadTitleConvention: `[${teamName.trim()}] <member name>`,
		status: "active",
		createdAt: ts,
		updatedAt: ts,
		archivedAt: null,
		leader: { kind: "main-session", sessionId },
		communication: { memberLanguage: "english", replyToUserInUserLanguage: true },
		worktree: { enabled: Boolean(worktreeEnabled), baseBranch, root: dir ? join(dir, "worktrees") : null },
		paths: dir
			? { dir, team: join(dir, "team.json"), guide: join(dir, "guide.md"), artifacts: join(dir, "artifacts") }
			: null,
		members: [],
		log: [{ ts, event: "created", detail: `team ${teamName.trim()}` }],
	};
}

function touch(team, event, detail) {
	const ts = isoNow();
	team.updatedAt = ts;
	team.log.push({ ts, event, detail });
	return team;
}

function memberById(team, id) {
	const found = team.members.find((m) => m.id === id);
	if (!found) throw new Error(`no member with id "${id}"`);
	return found;
}

function normalizedFocus(focus) {
	return focus.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedMemberName(name) {
	return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedThreadTitle(title) {
	return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function assertUniqueMemberFocus(team) {
	const seen = new Map();
	for (const member of team.members) {
		const key = normalizedFocus(member.focus ?? "");
		const previous = seen.get(key);
		if (previous) {
			throw new Error(`member focus "${member.focus}" duplicates "${previous.focus}" (no two members may own the same thing)`);
		}
		seen.set(key, member);
	}
}

function assertUniqueMemberName(team) {
	const seen = new Map();
	for (const member of team.members) {
		const memberName = member.name ?? member.focus ?? "";
		const key = normalizedMemberName(memberName);
		const previous = seen.get(key);
		if (previous) {
			throw new Error(`member name "${memberName}" duplicates "${previous.name ?? previous.focus}" (no two members may produce the same thread title)`);
		}
		seen.set(key, member);
	}
}

function assertUniqueMemberThreadTitle(team) {
	const seen = new Map();
	for (const member of team.members) {
		const threadTitle = member.threadTitle;
		if (typeof threadTitle !== "string" || !threadTitle.trim()) {
			throw new Error(`member "${member.id ?? member.name ?? member.focus ?? "(unknown)"}" has invalid threadTitle (non-empty string required)`);
		}
		const key = normalizedThreadTitle(threadTitle);
		const previous = seen.get(key);
		if (previous) {
			throw new Error(`member threadTitle "${threadTitle}" duplicates "${previous.threadTitle}" (no two members may produce the same thread title)`);
		}
		seen.set(key, member);
	}
}

function assertTeamReadyForThreadBinding(team) {
	if (isUnderstaffed(team)) {
		throw new Error(
			`cannot bind member threads until the team has at least ${MIN_MEMBERS} distinct members; current count is ${team.members.length}`,
		);
	}
	assertUniqueMemberFocus(team);
	assertUniqueMemberName(team);
	assertUniqueMemberThreadTitle(team);
}

export function addMember(team, { id, focus, lens, deliverable = "", branch = null, name = null }) {
	if (!id?.trim()) throw new Error("member id is required");
	if (!focus?.trim()) throw new Error("member focus is required - a concrete part, ownership area, or perspective");
	if (!LENSES.includes(lens)) throw new Error(`invalid lens "${lens}" - use one of: ${LENSES.join(", ")}`);
	const memberId = id.trim();
	const memberFocus = focus.trim();
	// The member name is the short role label that titles this member's thread. Fall back to the
	// focus so the title is ALWAYS per-member and never the shared team-wide session name.
	const memberName = name?.trim() || memberFocus;
	if (team.members.some((m) => m.id === memberId)) throw new Error(`member id "${memberId}" already exists (duplicate)`);
	const duplicate = team.members.find((m) => normalizedFocus(m.focus) === normalizedFocus(memberFocus));
	if (duplicate) throw new Error(`member focus "${memberFocus}" duplicates "${duplicate.focus}" (no two members may own the same thing)`);
	const duplicateName = team.members.find((m) => normalizedMemberName(m.name ?? m.focus ?? "") === normalizedMemberName(memberName));
	if (duplicateName) {
		throw new Error(`member name "${memberName}" duplicates "${duplicateName.name ?? duplicateName.focus}" (no two members may produce the same thread title)`);
	}
	team.members.push({
		id: memberId,
		name: memberName,
		focus: memberFocus,
		lens,
		deliverable: deliverable.trim(),
		threadId: null,
		threadTitle: `[${team.teamName}] ${memberName}`,
		cwd: null,
		worktree: { path: null, branch: branch ?? null },
		status: "pending",
	});
	return touch(team, "add-member", `member ${memberId} (${lens}): ${memberFocus}`);
}

export function bindThread(team, { id, threadId, cwd = null, worktreePath = null }) {
	if (!threadId?.trim()) throw new Error("thread id is required");
	assertTeamReadyForThreadBinding(team);
	const m = memberById(team, id);
	m.threadId = threadId.trim();
	m.status = "active";
	if (cwd) m.cwd = cwd;
	if (team.worktree.enabled) m.worktree.path = worktreePath ?? cwd ?? m.worktree.path;
	return touch(team, "bind-thread", `member ${id} -> thread ${threadId.trim()}`);
}

export function setMemberStatus(team, { id, status, note = "" }) {
	if (!MEMBER_STATUSES.includes(status)) throw new Error(`invalid status "${status}" - use one of: ${MEMBER_STATUSES.join(", ")}`);
	memberById(team, id).status = status;
	return touch(team, "set-status", `member ${id} -> ${status}${note ? `: ${note}` : ""}`);
}

// Record a provisioned worktree. Isolation is conflict-triggered: the first worktree-add flips
// the whole team into worktree mode, so the leader can decide it mid-run, not only at init.
export function setMemberWorktree(team, { id, path, branch }) {
	const m = memberById(team, id);
	team.worktree.enabled = true;
	m.worktree.path = path;
	m.worktree.branch = branch;
	m.cwd = path;
	return touch(team, "worktree-add", `member ${id} -> ${path} (${branch})`);
}

export function clearMemberWorktree(team, { id }) {
	const m = memberById(team, id);
	if (m.cwd === m.worktree?.path) m.cwd = null;
	m.worktree.path = null;
	return touch(team, "worktree-remove", `member ${id}`);
}

export function archive(team, { id = null, note = "" } = {}) {
	if (id) {
		memberById(team, id).status = "archived";
		return touch(team, "archive-member", `member ${id}${note ? `: ${note}` : ""}`);
	}
	for (const m of team.members) m.status = "archived";
	team.status = "archived";
	team.archivedAt = isoNow();
	return touch(team, "archive", note || "team archived; all members closed");
}

export function validateTeam(team) {
	if (team?.schemaVersion !== 2) throw new Error("invalid team: schemaVersion must be 2");
	if (!team.teamId || !team.teamName) throw new Error("invalid team: teamId and teamName are required");
	if (team.leader?.kind !== "main-session") throw new Error("invalid team: leader.kind must be main-session");
	if (!Array.isArray(team.members)) throw new Error("invalid team: members must be an array");
	assertUniqueMemberFocus(team);
	assertUniqueMemberName(team);
	assertUniqueMemberThreadTitle(team);
	return team;
}

// Resolve (and confine) a team dir to a single child of <cwd>/.omo/teams.
export function resolveTeamDir(cwd, sessionId) {
	if (!SESSION_ID_PATTERN.test(sessionId ?? "")) throw new Error(`invalid or unsafe session id "${sessionId}"`);
	return resolve(cwd, ".omo", "teams", sessionId);
}

async function lstatOrNull(p) {
	return lstat(p).catch((error) => {
		if (error && error.code === "ENOENT") return null;
		throw error;
	});
}

// Create a directory chain refusing any symlinked component, so team state can never be
// written through a symlink that escapes the workspace.
async function mkdirNoSymlink(dir, stopAt) {
	if (dir === stopAt) return;
	const rel = relative(stopAt, dir);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refused: path escapes ${stopAt}: ${dir}`);
	await mkdirNoSymlink(dirname(dir), stopAt);
	const st = await lstatOrNull(dir);
	if (st) {
		if (st.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
		if (!st.isDirectory()) throw new Error(`refused: path component is not a directory: ${dir}`);
		return;
	}
	await mkdir(dir);
}

async function assertNoSymlinkComponents(dir, stopAt) {
	if (dir === stopAt) return;
	const rel = relative(stopAt, dir);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`refused: path escapes ${stopAt}: ${dir}`);
	await assertNoSymlinkComponents(dirname(dir), stopAt);
	const st = await lstatOrNull(dir);
	if (st?.isSymbolicLink()) throw new Error(`refused: path component is a symlink: ${dir}`);
}

export async function ensureTeamDir(cwd, sessionId) {
	const workspaceRoot = resolve(cwd);
	const teamsRoot = resolve(cwd, ".omo", "teams");
	const dir = resolveTeamDir(cwd, sessionId);
	await mkdirNoSymlink(teamsRoot, workspaceRoot);
	await mkdirNoSymlink(dir, teamsRoot);
	await mkdirNoSymlink(join(dir, "artifacts"), dir);
	return dir;
}

export async function assertSafeTeamDir(cwd, sessionId) {
	const workspaceRoot = resolve(cwd);
	const teamsRoot = resolve(cwd, ".omo", "teams");
	const dir = resolveTeamDir(cwd, sessionId);
	await assertNoSymlinkComponents(teamsRoot, workspaceRoot);
	await assertNoSymlinkComponents(dir, teamsRoot);
	return dir;
}

export async function readTeam(dir) {
	return validateTeam(JSON.parse(await readFile(join(dir, "team.json"), "utf8")));
}

export async function teamExists(dir) {
	return (await lstatOrNull(join(dir, "team.json"))) !== null;
}

async function persistedFileTarget(team, pathKey, fileName, expectedDir) {
	validateTeam(team);
	if (!team.paths?.dir || !team.paths?.[pathKey]) throw new Error(`invalid team: paths.${pathKey} is required`);
	const dir = resolve(expectedDir);
	if (resolve(team.paths.dir) !== dir) throw new Error(`refused: persisted team dir does not match trusted team dir: ${team.paths.dir}`);
	const target = resolve(team.paths[pathKey]);
	if (target !== resolve(dir, fileName)) throw new Error(`refused: ${fileName} persist target escapes team dir: ${team.paths[pathKey]}`);
	const dirStat = await lstatOrNull(dir);
	if (dirStat?.isSymbolicLink()) throw new Error(`refused: team dir is a symlink: ${dir}`);
	const st = await lstatOrNull(target);
	if (st?.isSymbolicLink()) throw new Error(`refused: ${fileName} is a symlink: ${target}`);
	if (st && !st.isFile()) throw new Error(`refused: ${fileName} is not a file: ${target}`);
	return target;
}

async function writePersistedFileAtomic(team, pathKey, fileName, content, expectedDir) {
	const target = await persistedFileTarget(team, pathKey, fileName, expectedDir);
	const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`;
	await writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
	await rename(tmp, target);
	return team;
}

export async function writeTeamAtomic(team, expectedDir) {
	return writePersistedFileAtomic(team, "team", "team.json", `${JSON.stringify(team, null, 2)}\n`, expectedDir);
}

export async function writeGuideAtomic(team, content, expectedDir) {
	return writePersistedFileAtomic(team, "guide", "guide.md", content, expectedDir);
}
