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
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
	agentPathForTaskName,
	assertTransport,
	isMultiAgentV2,
	LEADER_AGENT_PATH,
	parseTaskName,
	parseTeamTransport,
	TEAM_SCHEMA_VERSION,
} from "./team-transport.mjs";

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
const LOCK_TIMEOUT_MS = Number.parseInt(process.env.OMO_TEAMMODE_LOCK_TIMEOUT_MS ?? "10000", 10);
const LOCK_RETRY_MS = Number.parseInt(process.env.OMO_TEAMMODE_LOCK_RETRY_MS ?? "25", 10);

function isoNow(now) {
	return now ?? new Date().toISOString();
}

export function buildTeam({ teamName, sessionName, sessionId = null, dir = null, worktreeEnabled = false, baseBranch = "dev", transport, now }) {
	if (!teamName?.trim()) throw new Error("team name is required");
	if (!sessionName?.trim()) throw new Error("session name is required");
	const teamTransport = parseTeamTransport(transport);
	const v2 = teamTransport === "multi_agent_v2";
	const ts = isoNow(now);
	return {
		schemaVersion: TEAM_SCHEMA_VERSION,
		transport: teamTransport,
		teamId: randomUUID(),
		teamName: teamName.trim(),
		sessionName: sessionName.trim(),
		sessionId,
		threadTitleConvention: v2 ? null : `[${teamName.trim()}] <member name>`,
		status: "active",
		createdAt: ts,
		updatedAt: ts,
		archivedAt: null,
		leader: { kind: "main-session", sessionId: v2 ? null : sessionId, agentPath: v2 ? LEADER_AGENT_PATH : null },
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

function assertUniqueMemberTaskName(team) {
	const seen = new Map();
	for (const member of team.members) {
		const taskName = parseTaskName(member.taskName);
		const previous = seen.get(taskName);
		if (previous) {
			throw new Error(`member taskName "${taskName}" duplicates "${previous.taskName}" (no two members may share an agent path)`);
		}
		if (member.agentPath !== agentPathForTaskName(taskName)) {
			throw new Error(`member "${member.id}" agentPath "${member.agentPath}" does not match task name "${taskName}"`);
		}
		seen.set(taskName, member);
	}
}

function assertUniqueTransportIdentity(team) {
	if (isMultiAgentV2(team)) assertUniqueMemberTaskName(team);
	else assertUniqueMemberThreadTitle(team);
}

function assertTeamReadyForBinding(team) {
	if (isUnderstaffed(team)) {
		throw new Error(
			`cannot bind members until the team has at least ${MIN_MEMBERS} distinct members; current count is ${team.members.length}`,
		);
	}
	assertUniqueMemberFocus(team);
	assertUniqueMemberName(team);
	assertUniqueTransportIdentity(team);
}

export function addMember(team, { id, focus, lens, deliverable = "", branch = null, name = null, taskName = null }) {
	if (!id?.trim()) throw new Error("member id is required");
	if (!focus?.trim()) throw new Error("member focus is required - a concrete part, ownership area, or perspective");
	if (!LENSES.includes(lens)) throw new Error(`invalid lens "${lens}" - use one of: ${LENSES.join(", ")}`);
	const v2 = isMultiAgentV2(team);
	if (!v2 && taskName !== null) throw new Error("--task-name is only valid on multi_agent_v2 teams");
	const memberTaskName = v2 ? parseTaskName(taskName) : null;
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
	if (v2) {
		const duplicateTask = team.members.find((m) => m.taskName === memberTaskName);
		if (duplicateTask) throw new Error(`member taskName "${memberTaskName}" duplicates "${duplicateTask.taskName}" (no two members may share an agent path)`);
	}
	team.members.push({
		id: memberId,
		name: memberName,
		focus: memberFocus,
		lens,
		deliverable: deliverable.trim(),
		taskName: memberTaskName,
		agentPath: v2 ? agentPathForTaskName(memberTaskName) : null,
		threadId: null,
		threadTitle: v2 ? null : `[${team.teamName}] ${memberName}`,
		cwd: null,
		worktree: { path: null, branch: branch ?? null },
		status: "pending",
	});
	return touch(team, "add-member", `member ${memberId} (${lens}): ${memberFocus}`);
}

export function bindThread(team, { id, threadId, cwd = null, worktreePath = null }) {
	assertTransport(team, "codex_app", "bind-thread");
	if (!threadId?.trim()) throw new Error("thread id is required");
	assertTeamReadyForBinding(team);
	const m = memberById(team, id);
	m.threadId = threadId.trim();
	m.status = "active";
	if (cwd) m.cwd = cwd;
	if (team.worktree.enabled) m.worktree.path = worktreePath ?? cwd ?? m.worktree.path;
	return touch(team, "bind-thread", `member ${id} -> thread ${threadId.trim()}`);
}

export function bindAgent(team, { id, agentPath, cwd = null, worktreePath = null }) {
	assertTransport(team, "multi_agent_v2", "bind-agent");
	if (!agentPath?.trim()) throw new Error("agent path is required");
	assertTeamReadyForBinding(team);
	const m = memberById(team, id);
	const boundPath = agentPath.trim();
	if (boundPath !== m.agentPath) {
		throw new Error(`agent path mismatch for member ${m.id}: expected "${m.agentPath}" (task name "${m.taskName}"), got "${boundPath}"`);
	}
	m.status = "active";
	if (cwd) m.cwd = cwd;
	if (team.worktree.enabled) m.worktree.path = worktreePath ?? cwd ?? m.worktree.path;
	return touch(team, "bind-agent", `member ${id} -> agent ${boundPath}`);
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
		const memberQualifier = isMultiAgentV2(team) ? " (team state only; V2 exposes no runtime archive operation)" : "";
		return touch(team, "archive-member", `member ${id}${memberQualifier}${note ? `: ${note}` : ""}`);
	}
	for (const m of team.members) m.status = "archived";
	team.status = "archived";
	team.archivedAt = isoNow();
	// The default detail must never claim a runtime closure that did not happen: V2 exposes no
	// runtime archive operation, so only the durable team state is archived there.
	const defaultDetail = isMultiAgentV2(team)
		? "team archived; V2 exposes no runtime archive operation - durable team state is the archive"
		: "team archived; all members closed";
	return touch(team, "archive", note || defaultDetail);
}

// schemaVersion 2 predates transports; that skill allowed ONLY Codex App threads as members,
// so a legacy team is migrated in memory as codex_app and persisted on the next mutation.
function migrateLegacyTeam(team) {
	if (team?.schemaVersion !== 2) return team;
	team.schemaVersion = TEAM_SCHEMA_VERSION;
	team.transport = "codex_app";
	if (team.leader && typeof team.leader === "object") team.leader.agentPath = null;
	for (const member of team.members ?? []) {
		member.taskName = null;
		member.agentPath = null;
	}
	return team;
}

export function validateTeam(team) {
	migrateLegacyTeam(team);
	if (team?.schemaVersion !== TEAM_SCHEMA_VERSION) throw new Error(`invalid team: schemaVersion must be ${TEAM_SCHEMA_VERSION}`);
	parseTeamTransport(team.transport);
	if (!team.teamId || !team.teamName) throw new Error("invalid team: teamId and teamName are required");
	if (team.leader?.kind !== "main-session") throw new Error("invalid team: leader.kind must be main-session");
	if (!Array.isArray(team.members)) throw new Error("invalid team: members must be an array");
	assertUniqueMemberFocus(team);
	assertUniqueMemberName(team);
	assertUniqueTransportIdentity(team);
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

function positiveIntegerOrFallback(value, fallback) {
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function readLockOwner(lockDir) {
	return readFile(join(lockDir, "owner.json"), "utf8")
		.then((content) => JSON.parse(content))
		.catch(() => null);
}

async function describeLockOwner(lockDir) {
	const owner = await readLockOwner(lockDir);
	if (!owner || typeof owner !== "object") return "another team.mjs command";
	const parts = [];
	if (owner.command) parts.push(String(owner.command));
	if (owner.pid) parts.push(`pid ${owner.pid}`);
	if (owner.createdAt) parts.push(`since ${owner.createdAt}`);
	return parts.length > 0 ? parts.join(", ") : "another team.mjs command";
}

export async function withTeamLock(dir, command, fn, options = {}) {
	const timeoutMs = positiveIntegerOrFallback(options.timeoutMs ?? LOCK_TIMEOUT_MS, 10000);
	const retryMs = positiveIntegerOrFallback(options.retryMs ?? LOCK_RETRY_MS, 25);
	const lockDir = join(dir, ".team.lock");
	const deadline = Date.now() + timeoutMs;
	let acquired = false;
	for (;;) {
		try {
			await mkdir(lockDir, { mode: 0o700 });
			acquired = true;
			await writeFile(
				join(lockDir, "owner.json"),
				`${JSON.stringify({ pid: process.pid, command, createdAt: new Date().toISOString() }, null, 2)}\n`,
				{ encoding: "utf8", flag: "wx" },
			);
			break;
		} catch (error) {
			if (acquired) {
				await rm(lockDir, { recursive: true, force: true });
				throw error;
			}
			if (!error || error.code !== "EEXIST") throw error;
			const st = await lstatOrNull(lockDir);
			if (st?.isSymbolicLink()) throw new Error(`refused: team lock path is a symlink: ${lockDir}`);
			if (st && !st.isDirectory()) throw new Error(`refused: team lock path is not a directory: ${lockDir}`);
			if (Date.now() >= deadline) {
				const owner = await describeLockOwner(lockDir);
				throw new Error(`team state is locked by ${owner}; retry after that command completes`);
			}
			await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())));
		}
	}
	try {
		return await fn();
	} finally {
		await rm(lockDir, { recursive: true, force: true });
	}
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
