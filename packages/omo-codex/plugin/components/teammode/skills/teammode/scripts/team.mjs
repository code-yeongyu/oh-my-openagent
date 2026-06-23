#!/usr/bin/env node
// team.mjs - the teammode controller CLI. Thin argv dispatch over team-state.mjs (the
// state model) and team-guide.mjs (the member field manual). It replaces hand-written
// team.json / guide.md so the model never has to author those files by hand.
//
// Zero external dependencies (node builtins only): runs identically under node and bun on
// macOS, Linux, and Windows.
//
//   node "<skill-root>/scripts/team.mjs" init        --name "<team>" --session-name "<sess>" [--session <id>] [--worktree] [--base-branch dev]
//   node "<skill-root>/scripts/team.mjs" add-member  --team <id> --id A --name "<short role>" --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>" [--branch <b>]
//   node "<skill-root>/scripts/team.mjs" bind-thread  --team <id> --id A --thread <thread-id> [--cwd <path>]
//   node "<skill-root>/scripts/team.mjs" member-prompt --team <id> --id A
//   node "<skill-root>/scripts/team.mjs" set-status   --team <id> --id A --status reported|blocked|active|archived [--note "<...>"]
//   node "<skill-root>/scripts/team.mjs" archive      --team <id> [--id A] [--note "<...>"]
//   node "<skill-root>/scripts/team.mjs" delete       --team <id> [--force]
//   node "<skill-root>/scripts/team.mjs" status       --team <id>
//   node "<skill-root>/scripts/team.mjs" guide        --team <id>

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildGuide, buildMemberPrompt, codexThreadLink } from "./team-guide.mjs";
import {
	addMember,
	archive,
	assertSafeTeamDir,
	bindThread,
	buildTeam,
	clearMemberWorktree,
	ensureTeamDir,
	isUnderstaffed,
	MIN_MEMBERS,
	readTeam,
	setMemberStatus,
	setMemberWorktree,
	teamExists,
	writeGuideAtomic,
	writeTeamAtomic,
} from "./team-state.mjs";
import { addMemberWorktree, integrateMemberBranch, removeMemberWorktree } from "./team-worktree.mjs";

function parseFlags(args) {
	const flags = { _: [] };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			flags._.push(arg);
			continue;
		}
		const key = arg.slice(2);
		const next = args[i + 1];
		if (next === undefined || next.startsWith("--")) {
			flags[key] = true;
		} else {
			flags[key] = next;
			i++;
		}
	}
	return flags;
}

function requireFlag(flags, name) {
	const value = flags[name];
	if (value === undefined || value === true) throw new Error(`missing required flag --${name}`);
	return value;
}

async function loadTeam(cwd, sessionId) {
	const dir = await assertSafeTeamDir(cwd, sessionId);
	return { dir, team: await readTeam(dir) };
}

function memberOrThrow(team, id) {
	const member = team.members.find((m) => m.id === id);
	if (!member) throw new Error(`no member with id "${id}"`);
	return member;
}

async function persist(team, dir) {
	await writeTeamAtomic(team, dir);
	await writeGuideAtomic(team, buildGuide(team), dir);
}

const handlers = {
	async init(cwd, flags) {
		const teamName = requireFlag(flags, "name");
		const sessionName = requireFlag(flags, "session-name");
		const sessionId = typeof flags.session === "string" ? flags.session : `team-${randomUUID().slice(0, 8)}`;
		const dir = await ensureTeamDir(cwd, sessionId);
		if (await teamExists(dir)) {
			process.stdout.write(`exists: ${dir} (left untouched; re-init is a safe no-op)\n`);
			return;
		}
		const team = buildTeam({
			teamName,
			sessionName,
			sessionId,
			dir,
			worktreeEnabled: flags.worktree === true,
			baseBranch: typeof flags["base-branch"] === "string" ? flags["base-branch"] : "dev",
		});
		await persist(team, dir);
		process.stdout.write(`created: ${dir}\n`);
		process.stdout.write(`team.json + guide.md written; artifacts/ ready. session id: ${sessionId}\n`);
		process.stdout.write(`next: add-member --team ${sessionId} --id A --name "<short role>" --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>"\n`);
	},

	async "add-member"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		const memberId = requireFlag(flags, "id").trim();
		addMember(team, {
			id: memberId,
			name: typeof flags.name === "string" ? flags.name : null,
			focus: requireFlag(flags, "focus"),
			lens: requireFlag(flags, "lens"),
			deliverable: typeof flags.deliverable === "string" ? flags.deliverable : "",
			branch: typeof flags.branch === "string" ? flags.branch : null,
		});
		await persist(team, dir);
		const member = team.members.find((m) => m.id === memberId);
		process.stdout.write(`added member ${memberId} to team ${sessionId}.\n\nSend this as the new thread's first message (title the thread "${member.threadTitle}"):\n---\n${buildMemberPrompt(team, memberId)}\n---\n`);
	},

	async "bind-thread"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		bindThread(team, {
			id: requireFlag(flags, "id"),
			threadId: requireFlag(flags, "thread"),
			cwd: typeof flags.cwd === "string" ? flags.cwd : null,
			worktreePath: typeof flags["worktree-path"] === "string" ? flags["worktree-path"] : null,
		});
		await persist(team, dir);
		process.stdout.write(`bound member ${flags.id} to thread ${flags.thread}.\n`);
	},

	async "member-prompt"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		process.stdout.write(`${buildMemberPrompt(team, requireFlag(flags, "id"))}\n`);
	},

	async "set-status"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		setMemberStatus(team, {
			id: requireFlag(flags, "id"),
			status: requireFlag(flags, "status"),
			note: typeof flags.note === "string" ? flags.note : "",
		});
		await persist(team, dir);
		process.stdout.write(`member ${flags.id} -> ${flags.status}\n`);
	},

	async "worktree-add"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		const member = memberOrThrow(team, requireFlag(flags, "id"));
		const result = addMemberWorktree(cwd, team, member, {
			baseBranch: typeof flags["base-branch"] === "string" ? flags["base-branch"] : null,
		});
		setMemberWorktree(team, { id: member.id, path: result.path, branch: result.branch });
		await persist(team, dir);
		const note = result.created ? "" : " (already exists)";
		const thread = member.threadId
			? `\nMember thread: ${codexThreadLink(member.threadId)}\nTell that member to: cd "${result.path}"`
			: "\nMember thread is not bound yet; wait for the real Codex thread id, then bind-thread before sending bootstrap. After binding, send the member this worktree path.";
		process.stdout.write(
			`worktree for member ${member.id}${note}: ${result.path} on branch ${result.branch} (off ${result.base}).${thread}\n`,
		);
	},

	async "worktree-remove"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		const member = memberOrThrow(team, requireFlag(flags, "id"));
		removeMemberWorktree(cwd, team, member, { force: flags.force === true });
		clearMemberWorktree(team, { id: member.id });
		await persist(team, dir);
		process.stdout.write(`removed worktree for member ${member.id}\n`);
	},

	async integrate(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		const targets = typeof flags.id === "string" ? [memberOrThrow(team, flags.id)] : team.members.filter((m) => m.worktree?.branch);
		if (targets.length === 0) throw new Error("no member has a worktree branch to integrate; run worktree-add first");
		for (const member of targets) {
			const result = integrateMemberBranch(cwd, member.worktree.branch);
			if (!result.merged) {
				if (result.conflicts.length > 0) {
					process.stdout.write(`member ${member.id} (${member.worktree.branch}): CONFLICT into ${result.into}\n`);
					throw new Error(
						`merge conflict integrating member ${member.id} (branch ${member.worktree.branch}). Resolve the conflict, commit the merge, then re-run integrate. Conflicting files: ${result.conflicts.join(", ")}`,
					);
				}
				process.stdout.write(`member ${member.id} (${member.worktree.branch}): could not start merge into ${result.into}\n`);
				throw new Error(
					`could not integrate member ${member.id} (branch ${member.worktree.branch}): ${result.message || "git merge failed; see git status"}`,
				);
			}
			process.stdout.write(`member ${member.id} (${member.worktree.branch}): merged into ${result.into}\n`);
		}
		process.stdout.write(`integrated ${targets.length} member branch(es) with merge commits\n`);
	},

	async archive(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		archive(team, {
			id: typeof flags.id === "string" ? flags.id : null,
			note: typeof flags.note === "string" ? flags.note : "",
		});
		await persist(team, dir);
		process.stdout.write(flags.id ? `archived member ${flags.id}\n` : `archived team ${sessionId} and closed all members\n`);
	},

	async delete(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		const active = team.members.filter((m) => m.status !== "archived");
		if (flags.force !== true && (team.status !== "archived" || active.length > 0)) {
			throw new Error(
				`refused: team "${sessionId}" is not archived or still has ${active.length} active member(s). Archive first, or pass --force to delete anyway.`,
			);
		}
		await rm(dir, { recursive: true, force: true });
		process.stdout.write(`deleted team state: ${dir}\n`);
	},

	async status(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		process.stdout.write(`Team ${team.teamName} [${team.status}] - leader: main session - ${team.members.length} member(s)\n`);
		for (const m of team.members) {
			const thread = m.threadId ? ` thread=${m.threadId} link=${codexThreadLink(m.threadId)}` : "";
			process.stdout.write(`  ${m.id} (${m.lens}) ${m.focus} -> ${m.deliverable || "(no deliverable)"} [${m.status}]${thread}${m.cwd ? ` cwd=${m.cwd}` : ""}\n`);
		}
		if (isUnderstaffed(team)) {
			process.stdout.write(
				`WARNING: a team needs at least ${MIN_MEMBERS} members; this team has ${team.members.length}. A single-member team is not a team - add another distinct slice or use a subagent.\n`,
			);
		}
	},

	async guide(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { dir, team } = await loadTeam(cwd, sessionId);
		await writeGuideAtomic(team, buildGuide(team), dir);
		process.stdout.write(`${team.paths.guide}\n`);
	},
};

async function main() {
	const [subcommand, ...rest] = process.argv.slice(2);
	const handler = handlers[subcommand];
	if (!handler) {
		throw new Error(`unknown subcommand "${subcommand ?? ""}" - expected one of: ${Object.keys(handlers).join(", ")}`);
	}
	await handler(process.cwd(), parseFlags(rest));
}

// Symlink-robust main-module check: a symlinked install invokes this file through a symlink
// path while node resolves import.meta.url to the realpath, so compare the resolved real paths
// (falling back to the literal url comparison if a path cannot be resolved).
function isInvokedAsScript() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
	} catch {
		return import.meta.url === pathToFileURL(entry).href;
	}
}

if (isInvokedAsScript()) {
	await main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
