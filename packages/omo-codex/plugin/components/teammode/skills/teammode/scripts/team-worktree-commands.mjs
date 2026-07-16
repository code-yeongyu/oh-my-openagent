import {
	loadTeam,
	memberOrThrow,
	mutateTeam,
	persistTeam,
	requireFlag,
} from "./team-command-context.mjs";
import { codexThreadLink } from "./team-guide.mjs";
import { clearMemberWorktree, setMemberWorktree } from "./team-state.mjs";
import { isMultiAgentV2 } from "./team-transport.mjs";
import {
	addMemberWorktree,
	integrateMemberBranch,
	removeMemberWorktree,
} from "./team-worktree.mjs";

export const worktreeCommands = {
	async "worktree-add"(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const memberId = requireFlag(flags, "id");
		const baseBranch =
			typeof flags["base-branch"] === "string" ? flags["base-branch"] : null;
		const { team, member, result } = await mutateTeam(
			cwd,
			sessionId,
			"worktree-add",
			async (team, dir) => {
				const member = memberOrThrow(team, memberId);
				const result = addMemberWorktree(cwd, team, member, { baseBranch });
				setMemberWorktree(team, {
					id: member.id,
					path: result.path,
					branch: result.branch,
				});
				await persistTeam(team, dir);
				return { team, member, result };
			},
		);
		const note = result.created ? "" : " (already exists)";
		const followUp = isMultiAgentV2(team)
			? member.status === "active"
				? `\nMember agent: ${member.agentPath}\nSend it an agents.followup_task to: cd "${result.path}"`
				: `\nMember agent is not spawned yet; include this worktree path in its agents.spawn_agent message, then bind-agent.`
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
		const member = await mutateTeam(
			cwd,
			sessionId,
			"worktree-remove",
			async (team, dir) => {
				const member = memberOrThrow(team, memberId);
				removeMemberWorktree(cwd, team, member, { force });
				clearMemberWorktree(team, { id: member.id });
				await persistTeam(team, dir);
				return member;
			},
		);
		process.stdout.write(`removed worktree for member ${member.id}\n`);
	},

	async integrate(cwd, flags) {
		const sessionId = requireFlag(flags, "team");
		const { team } = await loadTeam(cwd, sessionId);
		const targets =
			typeof flags.id === "string"
				? [memberOrThrow(team, flags.id)]
				: team.members.filter((member) => member.worktree?.branch);
		if (targets.length === 0)
			throw new Error(
				"no member has a worktree branch to integrate; run worktree-add first",
			);
		for (const member of targets) {
			const result = integrateMemberBranch(cwd, member.worktree.branch);
			if (!result.merged) {
				if (result.conflicts.length > 0) {
					process.stdout.write(
						`member ${member.id} (${member.worktree.branch}): CONFLICT into ${result.into}\n`,
					);
					throw new Error(
						`merge conflict integrating member ${member.id} (branch ${member.worktree.branch}). Resolve the conflict, commit the merge, then re-run integrate. Conflicting files: ${result.conflicts.join(", ")}`,
					);
				}
				process.stdout.write(
					`member ${member.id} (${member.worktree.branch}): could not start merge into ${result.into}\n`,
				);
				throw new Error(
					`could not integrate member ${member.id} (branch ${member.worktree.branch}): ${result.message || "git merge failed; see git status"}`,
				);
			}
			process.stdout.write(
				`member ${member.id} (${member.worktree.branch}): merged into ${result.into}\n`,
			);
		}
		process.stdout.write(
			`integrated ${targets.length} member branch(es) with merge commits\n`,
		);
	},
};
