#!/usr/bin/env node
// team.mjs - the teammode controller CLI. Thin argv dispatch over team-state.mjs (the
// state model) and team-guide.mjs (the member field manual). It replaces hand-written
// team.json / guide.md so the model never has to author those files by hand.
//
// Zero external dependencies (node builtins only): runs identically under node and bun on
// macOS, Linux, and Windows.
//
//   node "<skill-root>/scripts/team.mjs" init        --name "<team>" --session-name "<sess>" [--session <id>] [--worktree] [--base-branch dev]
//   node "<skill-root>/scripts/team.mjs" add-member  --team <id> --id A --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>" [--branch <b>]
//   node "<skill-root>/scripts/team.mjs" bind-thread  --team <id> --id A --thread <thread-id> [--cwd <path>]
//   node "<skill-root>/scripts/team.mjs" member-prompt --team <id> --id A
//   node "<skill-root>/scripts/team.mjs" set-status   --team <id> --id A --status reported|blocked|active|archived [--note "<...>"]
//   node "<skill-root>/scripts/team.mjs" archive      --team <id> [--id A] [--note "<...>"]
//   node "<skill-root>/scripts/team.mjs" delete       --team <id> [--force]
//   node "<skill-root>/scripts/team.mjs" status       --team <id>
//   node "<skill-root>/scripts/team.mjs" guide        --team <id>

import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildGuide, buildMemberPrompt } from "./team-guide.mjs";
import {
	addMember,
	archive,
	bindThread,
	buildTeam,
	ensureTeamDir,
	isUnderstaffed,
	MIN_MEMBERS,
	readTeam,
	resolveTeamDir,
	setMemberStatus,
	teamExists,
	writeTeamAtomic,
} from "./team-state.mjs";

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

async function persist(team) {
	await writeTeamAtomic(team);
	await writeFile(team.paths.guide, buildGuide(team), "utf8");
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
		await persist(team);
		process.stdout.write(`created: ${dir}\n`);
		process.stdout.write(`team.json + guide.md written; artifacts/ ready. session id: ${sessionId}\n`);
		process.stdout.write(`next: add-member --team ${sessionId} --id A --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>"\n`);
	},

	async "add-member"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		addMember(team, {
			id: requireFlag(flags, "id"),
			focus: requireFlag(flags, "focus"),
			lens: requireFlag(flags, "lens"),
			deliverable: typeof flags.deliverable === "string" ? flags.deliverable : "",
			branch: typeof flags.branch === "string" ? flags.branch : null,
		});
		await persist(team);
		process.stdout.write(`added member ${flags.id} to team ${sessionId}.\n\nSend this as the new thread's first message (title it "${team.threadTitleConvention}"):\n---\n${buildMemberPrompt(team, flags.id)}\n---\n`);
	},

	async "bind-thread"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		bindThread(team, {
			id: requireFlag(flags, "id"),
			threadId: requireFlag(flags, "thread"),
			cwd: typeof flags.cwd === "string" ? flags.cwd : null,
			worktreePath: typeof flags["worktree-path"] === "string" ? flags["worktree-path"] : null,
		});
		await persist(team);
		process.stdout.write(`bound member ${flags.id} to thread ${flags.thread}.\n`);
	},

	async "member-prompt"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		process.stdout.write(`${buildMemberPrompt(team, requireFlag(flags, "id"))}\n`);
	},

	async "set-status"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		setMemberStatus(team, {
			id: requireFlag(flags, "id"),
			status: requireFlag(flags, "status"),
			note: typeof flags.note === "string" ? flags.note : "",
		});
		await persist(team);
		process.stdout.write(`member ${flags.id} -> ${flags.status}\n`);
	},

	async archive(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		archive(team, {
			id: typeof flags.id === "string" ? flags.id : null,
			note: typeof flags.note === "string" ? flags.note : "",
		});
		await persist(team);
		process.stdout.write(flags.id ? `archived member ${flags.id}\n` : `archived team ${sessionId} and closed all members\n`);
	},

	async delete(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const dir = resolveTeamDir(cwd, sessionId);
		const team = await readTeam(dir);
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
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		process.stdout.write(`Team ${team.teamName} [${team.status}] - leader: main session - ${team.members.length} member(s)\n`);
		for (const m of team.members) {
			process.stdout.write(`  ${m.id} (${m.lens}) ${m.focus} -> ${m.deliverable || "(no deliverable)"} [${m.status}]${m.threadId ? ` thread=${m.threadId}` : ""}${m.cwd ? ` cwd=${m.cwd}` : ""}\n`);
		}
		if (isUnderstaffed(team)) {
			process.stdout.write(
				`WARNING: a team needs at least ${MIN_MEMBERS} members; this team has ${team.members.length}. A single-member team is not a team - add another distinct slice or use a subagent.\n`,
			);
		}
	},

	async guide(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const team = await readTeam(resolveTeamDir(cwd, sessionId));
		await writeFile(team.paths.guide, buildGuide(team), "utf8");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
