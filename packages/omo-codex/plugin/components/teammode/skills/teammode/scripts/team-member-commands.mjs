import { randomUUID } from "node:crypto";
import {
	loadTeam,
	mutateTeam,
	persistTeam,
	requireFlag,
} from "./team-command-context.mjs";
import { buildMemberPrompt } from "./team-guide.mjs";
import {
	addMember,
	bindAgent,
	bindThread,
	buildTeam,
	ensureTeamDir,
	readTeam,
	setMemberStatus,
	teamExists,
	withTeamLock,
} from "./team-state.mjs";
import { isMultiAgentV2, parseTeamTransport } from "./team-transport.mjs";

export const memberCommands = {
	async init(cwd, flags) {
		const teamName = requireFlag(flags, "name");
		const sessionName = requireFlag(flags, "session-name");
		const transport = parseTeamTransport(
			flags.transport === undefined ? undefined : flags.transport,
		);
		const sessionId =
			typeof flags.session === "string"
				? flags.session
				: `team-${randomUUID().slice(0, 8)}`;
		const dir = await ensureTeamDir(cwd, sessionId);
		await withTeamLock(dir, "init", async () => {
			if (await teamExists(dir)) {
				const existing = await readTeam(dir);
				if (flags.transport !== undefined && existing.transport !== transport) {
					throw new Error(
						`team "${sessionId}" already exists with transport "${existing.transport}" - transport is immutable; keep using it or delete the team first`,
					);
				}
				process.stdout.write(
					`exists: ${dir} (transport: ${existing.transport}; left untouched; re-init is a safe no-op)\n`,
				);
				return;
			}
			const team = buildTeam({
				teamName,
				sessionName,
				sessionId,
				dir,
				transport,
				worktreeEnabled: flags.worktree === true,
				baseBranch:
					typeof flags["base-branch"] === "string"
						? flags["base-branch"]
						: "dev",
			});
			await persistTeam(team, dir);
			const taskNameFlag = isMultiAgentV2(team)
				? ' --task-name "<lowercase_digits_underscores>"'
				: "";
			process.stdout.write(`created: ${dir} (transport: ${team.transport})\n`);
			process.stdout.write(
				`team.json + guide.md written; artifacts/ ready. session id: ${sessionId}\n`,
			);
			process.stdout.write(
				`next: add-member --team ${sessionId} --id A --name "<short role>"${taskNameFlag} --focus "<part/ownership/perspective>" --lens area|ownership|perspective --deliverable "<...>"\n`,
			);
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
			deliverable:
				typeof flags.deliverable === "string" ? flags.deliverable : "",
			branch: typeof flags.branch === "string" ? flags.branch : null,
			taskName:
				typeof flags["task-name"] === "string" ? flags["task-name"] : null,
		};
		const { team, member } = await mutateTeam(
			cwd,
			sessionId,
			"add-member",
			async (team, dir) => {
				addMember(team, memberInput);
				await persistTeam(team, dir);
				return {
					team,
					member: team.members.find((item) => item.id === memberId),
				};
			},
		);
		const delivery = isMultiAgentV2(team)
			? `Send this as agents.spawn_agent message (task_name "${member.taskName}", fork_turns "none"), then bind-agent --agent-path "${member.agentPath}"`
			: `Send this as the new thread's first message (title the thread "${member.threadTitle}")`;
		process.stdout.write(
			`added member ${memberId} to team ${sessionId}.\n\n${delivery}:\n---\n${buildMemberPrompt(team, memberId)}\n---\n`,
		);
	},

	async "bind-thread"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = bindingInput(flags, "threadId", "thread");
		await mutateTeam(cwd, sessionId, "bind-thread", async (team, dir) => {
			bindThread(team, input);
			await persistTeam(team, dir);
		});
		process.stdout.write(
			`bound member ${flags.id} to thread ${flags.thread}.\n`,
		);
	},

	async "bind-agent"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = bindingInput(flags, "agentPath", "agent-path");
		await mutateTeam(cwd, sessionId, "bind-agent", async (team, dir) => {
			bindAgent(team, input);
			await persistTeam(team, dir);
		});
		process.stdout.write(
			`bound member ${flags.id} to agent ${flags["agent-path"]}.\n`,
		);
	},

	async "member-prompt"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		process.stdout.write(
			`${buildMemberPrompt(team, requireFlag(flags, "id"))}\n`,
		);
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
			await persistTeam(team, dir);
		});
		process.stdout.write(`member ${flags.id} -> ${flags.status}\n`);
	},
};

function bindingInput(flags, property, flagName) {
	return {
		id: requireFlag(flags, "id"),
		[property]: requireFlag(flags, flagName),
		cwd: typeof flags.cwd === "string" ? flags.cwd : null,
		worktreePath:
			typeof flags["worktree-path"] === "string"
				? flags["worktree-path"]
				: null,
	};
}
