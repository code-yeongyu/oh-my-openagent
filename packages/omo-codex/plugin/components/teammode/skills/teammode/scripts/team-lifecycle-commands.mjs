import { rm } from "node:fs/promises";
import {
	loadTeam,
	mutateTeam,
	persistTeam,
	requireFlag,
} from "./team-command-context.mjs";
import { buildGuide, codexThreadLink } from "./team-guide.mjs";
import {
	archive as archiveTeam,
	assertSafeTeamDir,
	isUnderstaffed,
	MIN_MEMBERS,
	readTeam,
	withTeamLock,
	writeGuideAtomic,
} from "./team-state.mjs";
import { isMultiAgentV2 } from "./team-transport.mjs";

export const lifecycleCommands = {
	async archive(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const input = {
			id: typeof flags.id === "string" ? flags.id : null,
			note: typeof flags.note === "string" ? flags.note : "",
		};
		const team = await mutateTeam(
			cwd,
			sessionId,
			"archive",
			async (team, dir) => {
				archiveTeam(team, input);
				await persistTeam(team, dir);
				return team;
			},
		);
		const v2 = isMultiAgentV2(team);
		const teamSummary = v2
			? `archived team ${sessionId}; V2 has no runtime archive operation - the durable team state is the archive (agents.interrupt_agent any member still mid-turn)\n`
			: `archived team ${sessionId} and closed all members\n`;
		const memberSummary = v2
			? `archived member ${flags.id} in team state; V2 has no runtime archive operation (agents.interrupt_agent it if still mid-turn)\n`
			: `archived member ${flags.id}\n`;
		process.stdout.write(flags.id ? memberSummary : teamSummary);
	},

	async delete(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const dir = await assertSafeTeamDir(cwd, sessionId);
		await withTeamLock(dir, "delete", async () => {
			const team = await readTeam(dir);
			const active = team.members.filter(
				(member) => member.status !== "archived",
			);
			if (
				flags.force !== true &&
				(team.status !== "archived" || active.length > 0)
			) {
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
		for (const member of team.members) {
			const endpoint = isMultiAgentV2(team)
				? member.agentPath
					? ` agent=${member.agentPath}`
					: ""
				: member.threadId
					? ` thread=${member.threadId} link=${codexThreadLink(member.threadId)}`
					: "";
			process.stdout.write(
				`  ${member.id} (${member.lens}) ${member.focus} -> ${member.deliverable || "(no deliverable)"} [${member.status}]${endpoint}${member.cwd ? ` cwd=${member.cwd}` : ""}\n`,
			);
		}
		if (isUnderstaffed(team)) {
			process.stdout.write(
				`WARNING: a team needs at least ${MIN_MEMBERS} members; this team has ${team.members.length}. A single-member team is not a team - add another distinct slice or use a subagent.\n`,
			);
		}
	},

	async guide(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const guidePath = await mutateTeam(
			cwd,
			sessionId,
			"guide",
			async (team, dir) => {
				await writeGuideAtomic(team, buildGuide(team), dir);
				return team.paths.guide;
			},
		);
		process.stdout.write(`${guidePath}\n`);
	},
};
