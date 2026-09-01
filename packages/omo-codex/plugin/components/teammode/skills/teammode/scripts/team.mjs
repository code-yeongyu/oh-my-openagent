#!/usr/bin/env node
// team.mjs - the teammode controller CLI. Thin argv dispatch over team-state.mjs (the
// state model) and team-guide.mjs (the member field manual). It replaces hand-written
// team.json / guide.md so the model never has to author those files by hand.
//
// Zero external dependencies (node builtins only): runs identically under node and bun on
// macOS, Linux, and Windows.
//
//   node "<skill-root>/scripts/team.mjs" init        --name "<team>" --session-name "<sess>" [--transport multi_agent_v2|codex_app] [--session <id>] [--worktree] [--base-branch dev]
//   node "<skill-root>/scripts/team.mjs" add-member  --team <id> --id A --name "<short role>" --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>" [--task-name <v2 task name>] [--branch <b>]
//   node "<skill-root>/scripts/team.mjs" bind-agent   --team <id> --id A --agent-path /root/<task_name> [--cwd <path>]   (multi_agent_v2 teams)
//   node "<skill-root>/scripts/team.mjs" bind-thread  --team <id> --id A --thread <thread-id> [--cwd <path>]            (codex_app teams)
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
	bindAgent,
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
	withTeamLock,
	writeGuideAtomic,
	writeTeamAtomic,
} from "./team-state.mjs";
import { isMultiAgentV2, parseTeamTransport } from "./team-transport.mjs";
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

async function mutateTeam(cwd, sessionId, command, fn) {
	const dir = await assertSafeTeamDir(cwd, sessionId);
	return withTeamLock(dir, command, async () => {
		const team = await readTeam(dir);
		return fn(team, dir);
	});
}

const handlers = {
	async init(cwd, flags) {
		const teamName = requireFlag(flags, "name");
		const sessionName = requireFlag(flags, "session-name");
		// Validate the transport BEFORE any directory exists so a bad value leaves no state behind.
		// A valueless `--transport` parses as `true` and must fail loudly, never default silently.
		const transport = parseTeamTransport(flags.transport === undefined ? undefined : flags.transport);
		const sessionId = typeof flags.session === "string" ? flags.session : `team-${randomUUID().slice(0, 8)}`;
		const dir = await ensureTeamDir(cwd, sessionId);
		await withTeamLock(dir, "init", async () => {
			if (await teamExists(dir)) {
				const existing = await readTeam(dir);
				if (flags.transport !== undefined && existing.transport !== transport) {
					throw new Error(
						`team "${sessionId}" already exists with transport "${existing.transport}" - transport is immutable; keep using it or delete the team first`,
					);
				}
				process.stdout.write(`exists: ${dir} (transport: ${existing.transport}; left untouched; re-init is a safe no-op)\n`);
				return;
			}
			const team = buildTeam({
				teamName,
				sessionName,
				sessionId,
				dir,
				transport,
				worktreeEnabled: flags.worktree === true,
				baseBranch: typeof flags["base-branch"] === "string" ? flags["base-branch"] : "dev",
			});
			await persist(team, dir);
			const taskNameFlag = isMultiAgentV2(team) ? ' --task-name "<lowercase_digits_underscores>"' : "";
			process.stdout.write(`created: ${dir} (transport: ${team.transport})\n`);
			process.stdout.write(`team.json + guide.md written; artifacts/ ready. session id: ${sessionId}\n`);
			process.stdout.write(`next: add-member --team ${sessionId} --id A --name "<short role>"${taskNameFlag} --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>"\n`);
		});
	},

	async "add-member"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const memberId = requireFlag(flags, "id").trim();
		const memberInput = {
			id: memberId,
			name: typeof flags.name === "string" ? flags.name : null,
			focus: requireFlag(flags, "focus"),
			lens: requireFlag(flags, "lens"),
			deliverable: typeof flags.deliverable === "string" ? flags.deliverable : "",
			branch: typeof flags.branch === "string" ? flags.branch : null,
			taskName: typeof flags["task-name"] === "string" ? flags["task-name"] : null,
		};
		const { team, member } = await mutateTeam(cwd, sessionId, "add-member", async (team, dir) => {
			addMember(team, memberInput);
			await persist(team, dir);
			return { team, member: team.members.find((m) => m.id === memberId) };
		});
		const delivery = isMultiAgentV2(team)
			? `Send this with spawn_agent using only task_name "${member.taskName}", message <bootstrap>, and fork_turns "none"; then bind-agent --agent-path "${member.agentPath}"`
			: `Send this as the new thread's first message (title the thread "${member.threadTitle}")`;
		process.stdout.write(`added member ${memberId} to team ${sessionId}.\n\n${delivery}:\n---\n${buildMemberPrompt(team, memberId)}\n---\n`);
	},

	async "bind-thread"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = {
			id: requireFlag(flags, "id"),
			threadId: requireFlag(flags, "thread"),
			cwd: typeof flags.cwd === "string" ? flags.cwd : null,
			worktreePath: typeof flags["worktree-path"] === "string" ? flags["worktree-path"] : null,
		};
		await mutateTeam(cwd, sessionId, "bind-thread", async (team, dir) => {
			bindThread(team, input);
			await persist(team, dir);
		});
		process.stdout.write(`bound member ${flags.id} to thread ${flags.thread}.\n`);
	},

	async "bind-agent"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = {
			id: requireFlag(flags, "id"),
			agentPath: requireFlag(flags, "agent-path"),
			cwd: typeof flags.cwd === "string" ? flags.cwd : null,
			worktreePath: typeof flags["worktree-path"] === "string" ? flags["worktree-path"] : null,
		};
		await mutateTeam(cwd, sessionId, "bind-agent", async (team, dir) => {
			bindAgent(team, input);
			await persist(team, dir);
		});
		process.stdout.write(`bound member ${flags.id} to agent ${flags["agent-path"]}.\n`);
	},

	async "member-prompt"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		process.stdout.write(`${buildMemberPrompt(team, requireFlag(flags, "id"))}\n`);
	},

	async "set-status"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = {
			id: requireFlag(flags, "id"),
			status: requireFlag(flags, "status"),
			note: typeof flags.note === "string" ? flags.note : "",
		};
		await mutateTeam(cwd, sessionId, "set-status", async (team, dir) => {
			setMemberStatus(team, input);
			await persist(team, dir);
		});
		process.stdout.write(`member ${flags.id} -> ${flags.status}\n`);
	},

	async "worktree-add"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const memberId = requireFlag(flags, "id");
		const baseBranch = typeof flags["base-branch"] === "string" ? flags["base-branch"] : null;
		const { team, member, result } = await mutateTeam(cwd, sessionId, "worktree-add", async (team, dir) => {
			const member = memberOrThrow(team, memberId);
			const result = addMemberWorktree(cwd, team, member, { baseBranch });
			setMemberWorktree(team, { id: member.id, path: result.path, branch: result.branch });
			await persist(team, dir);
			return { team, member, result };
		});
		const note = result.created ? "" : " (already exists)";
		const v2 = isMultiAgentV2(team);
		const followUp = v2
			? member.status === "active"
				? `\nMember agent: ${member.agentPath}\nSend it a followup_task to: cd "${result.path}"`
				: `\nMember agent is not spawned yet; include this worktree path in its spawn_agent message, then bind-agent.`
			: member.threadId
				? `\nMember thread: ${codexThreadLink(member.threadId)}\nTell that member to: cd "${result.path}"`
				: "\nMember thread is not bound yet; wait for the real Codex thread id, then bind-thread before sending bootstrap. After binding, send the member this worktree path.";
		process.stdout.write(
			`worktree for member ${member.id}${note}: ${result.path} on branch ${result.branch} (off ${result.base}).${followUp}\n`,
		);
	},

	async "worktree-remove"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const memberId = requireFlag(flags, "id");
		const force = flags.force === true;
		const member = await mutateTeam(cwd, sessionId, "worktree-remove", async (team, dir) => {
			const member = memberOrThrow(team, memberId);
			removeMemberWorktree(cwd, team, member, { force });
			clearMemberWorktree(team, { id: member.id });
			await persist(team, dir);
			return member;
		});
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
		const input = {
			id: typeof flags.id === "string" ? flags.id : null,
			note: typeof flags.note === "string" ? flags.note : "",
		};
		const team = await mutateTeam(cwd, sessionId, "archive", async (team, dir) => {
			archive(team, input);
			await persist(team, dir);
			return team;
		});
		const v2 = isMultiAgentV2(team);
		const teamSummary = v2
			? `archived team ${sessionId}; V2 has no runtime archive operation - the durable team state is the archive (interrupt_agent any member still mid-turn)\n`
			: `archived team ${sessionId} and closed all members\n`;
		const memberSummary = v2
			? `archived member ${flags.id} in team state; V2 has no runtime archive operation (interrupt_agent it if still mid-turn)\n`
			: `archived member ${flags.id}\n`;
		process.stdout.write(flags.id ? memberSummary : teamSummary);
	},

	async delete(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const dir = await assertSafeTeamDir(cwd, sessionId);
		await withTeamLock(dir, "delete", async () => {
			const team = await readTeam(dir);
			const active = team.members.filter((m) => m.status !== "archived");
			if (flags.force !== true && (team.status !== "archived" || active.length > 0)) {
				throw new Error(
					`refused: team "${sessionId}" is not archived or still has ${active.length} active member(s). Archive first, or pass --force to delete anyway.`,
				);
			}
			await rm(dir, { recursive: true, force: true });
		});
		process.stdout.write(`deleted team state: ${dir}\n`);
	},

	async status(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		process.stdout.write(
			`Team ${team.teamName} [${team.status}] - transport=${team.transport} - leader: main session - ${team.members.length} member(s)\n`,
		);
		for (const m of team.members) {
			const endpoint = isMultiAgentV2(team)
				? m.agentPath
					? ` agent=${m.agentPath}`
					: ""
				: m.threadId
					? ` thread=${m.threadId} link=${codexThreadLink(m.threadId)}`
					: "";
			process.stdout.write(`  ${m.id} (${m.lens}) ${m.focus} -> ${m.deliverable || "(no deliverable)"} [${m.status}]${endpoint}${m.cwd ? ` cwd=${m.cwd}` : ""}\n`);
		}
		if (isUnderstaffed(team)) {
			process.stdout.write(
				`WARNING: a team needs at least ${MIN_MEMBERS} members; this team has ${team.members.length}. A single-member team is not a team - add another distinct slice or use a subagent.\n`,
			);
		}
	},

	async guide(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const guidePath = await mutateTeam(cwd, sessionId, "guide", async (team, dir) => {
			await writeGuideAtomic(team, buildGuide(team), dir);
			return team.paths.guide;
		});
		process.stdout.write(`${guidePath}\n`);
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
