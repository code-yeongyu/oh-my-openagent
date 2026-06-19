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
		threadTitleConvention: `[${teamName.trim()}] ${sessionName.trim()}`,
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

export function addMember(team, { id, focus, lens, deliverable = "", branch = null }) {
	if (!id?.trim()) throw new Error("member id is required");
	if (!focus?.trim()) throw new Error("member focus is required - a concrete part, ownership area, or perspective");
	if (!LENSES.includes(lens)) throw new Error(`invalid lens "${lens}" - use one of: ${LENSES.join(", ")}`);
	if (team.members.some((m) => m.id === id)) throw new Error(`member id "${id}" already exists (duplicate)`);
	team.members.push({
		id: id.trim(),
		focus: focus.trim(),
		lens,
		deliverable: deliverable.trim(),
		threadId: null,
		threadTitle: team.threadTitleConvention,
		cwd: null,
		worktree: { path: null, branch: branch ?? null },
		status: "pending",
	});
	return touch(team, "add-member", `member ${id.trim()} (${lens}): ${focus.trim()}`);
}

export function bindThread(team, { id, threadId, cwd = null, worktreePath = null }) {
	if (!threadId?.trim()) throw new Error("thread id is required");
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

export async function ensureTeamDir(cwd, sessionId) {
	const workspaceRoot = resolve(cwd);
	const teamsRoot = resolve(cwd, ".omo", "teams");
	const dir = resolveTeamDir(cwd, sessionId);
	await mkdirNoSymlink(teamsRoot, workspaceRoot);
	await mkdirNoSymlink(dir, teamsRoot);
	await mkdirNoSymlink(join(dir, "artifacts"), dir);
	return dir;
}

export async function readTeam(dir) {
	return validateTeam(JSON.parse(await readFile(join(dir, "team.json"), "utf8")));
}

export async function teamExists(dir) {
	return (await lstatOrNull(join(dir, "team.json"))) !== null;
}

export async function writeTeamAtomic(team) {
	validateTeam(team);
	const target = team.paths.team;
	const st = await lstatOrNull(target);
	if (st?.isSymbolicLink()) throw new Error(`refused: team.json is a symlink: ${target}`);
	const tmp = `${target}.tmp-${process.pid}`;
	await writeFile(tmp, `${JSON.stringify(team, null, 2)}\n`, "utf8");
	await rename(tmp, target);
	return team;
}
