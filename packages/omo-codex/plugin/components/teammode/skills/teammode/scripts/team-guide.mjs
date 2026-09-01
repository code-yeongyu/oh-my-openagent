// team-guide.mjs - render the member-facing field manual (guide.md) and the short
// bootstrap trigger a new member reads on startup. Pure string builders, no I/O.
//
// The manual is the durable, two-channel replacement for per-prompt guidance: the leader
// writes it once at team creation, and every member is told to READ it instead of
// receiving the rules inline each turn. Every rendered surface branches on the team's
// transport: multi_agent_v2 members are native agents addressed by agent path; codex_app
// members are app threads addressed by thread id.

import { isMultiAgentV2, LEADER_AGENT_PATH } from "./team-transport.mjs";

export function codexThreadLink(threadId) {
	return `codex://threads/${threadId}`;
}

function transportLabel(team) {
	return isMultiAgentV2(team)
		? "MultiAgentV2 (native agents: flat `spawn_agent` / `send_message` / `followup_task`)"
		: "Codex App threads (`codex_app.*` tools)";
}

function memberEndpoint(member, v2) {
	if (v2) {
		return member.agentPath ? ` | task \`${member.taskName}\` | agent \`${member.agentPath}\`` : " | agent not spawned yet";
	}
	const thread = member.threadId ? ` | thread ${member.threadId} (${codexThreadLink(member.threadId)})` : " | thread not created yet";
	const title = member.threadTitle ? ` | thread title \`${member.threadTitle}\`` : "";
	return `${title}${thread}`;
}

function memberLine(member, v2) {
	const wt = member.worktree?.path ? ` | worktree ${member.worktree.path}` : "";
	const name = member.name ? ` "${member.name}"` : "";
	return `- **${member.id}**${name} (${member.lens}) - ${member.focus}${member.deliverable ? ` -> ${member.deliverable}` : ""}${memberEndpoint(member, v2)}${wt} [${member.status}]`;
}

function worktreeMemberEndpoint(member, v2) {
	if (v2) return member.agentPath ? `; agent \`${member.agentPath}\`` : "";
	return member.threadId ? `; thread ${codexThreadLink(member.threadId)}` : "";
}

function worktreeReadinessNote(v2) {
	if (v2) {
		return `Your worktree is created by the leader BEFORE you spawn; the exact path is in your row
above and in your bootstrap. If the leader enables isolation mid-run, the new path arrives
as a \`followup_task\` - switch to it before your next edit.`;
	}
	return `If Codex returns only \`pendingWorktreeId\` while the leader is creating a worktree-backed member
thread, the thread is not ready yet. The leader must wait until Codex surfaces a real thread id,
then bind that real id and send the bootstrap.`;
}

function worktreeSection(team) {
	const v2 = isMultiAgentV2(team);
	if (!team.worktree?.enabled) {
		return `## Worktrees

This team does not use isolated git worktrees. Work in the shared repository checkout
the leader is running from. If your changes would collide with another member's files,
that is a coordination signal: mark yourself \`blocked\` and tell the leader at once.`;
	}
	const lines = team.members
		.filter((m) => m.worktree?.path || m.worktree?.branch)
		.map((m) => {
			const bindHint = v2 ? "(assign with bind-agent --cwd)" : "(assign with bind-thread --cwd)";
			return `- **${m.id}**: worktree \`${m.worktree.path ?? bindHint}\` on branch \`${m.worktree.branch ?? team.worktree.baseBranch}\`${worktreeMemberEndpoint(m, v2)}`;
		});
	return `## Worktrees (ISOLATION IS ON - this is not optional for you)

This team runs each member in its own git worktree branched off \`${team.worktree.baseBranch}\`.
**You MUST work only inside your own worktree.** The very first thing you do is \`cd\` into it;
every edit, command, and commit happens there. Never touch another member's worktree, and
never edit files outside your assigned scope. Commit your work so the leader can integrate it.
Before editing, verify that your assigned worktree exists and contains repo files. If the path is
missing, empty, or does not look like a git worktree/repository yet, send \`BLOCKED: worktree not ready\`
to the leader and wait instead of editing any parent checkout or empty directory.

${worktreeReadinessNote(v2)}

${lines.length ? lines.join("\n") : "- (worktree paths are assigned as members are bound; read team.json for yours)"}`;
}

function addressBookRules(team) {
	if (isMultiAgentV2(team)) {
		return `- **Reach the leader and your peers with \`send_message\` - not by narrating in your own
  transcript, where no one reads it.** The address book is in team.json: the leader's target
  is \`${LEADER_AGENT_PATH}\`, and each peer's target is its \`members[].agentPath\` (built from its
  \`members[].taskName\`).
- **Use \`send_message\` for updates and \`followup_task\` only when handing a peer a NEW task**
  that should wake it. Never invent an agent path - read it from team.json.`;
	}
	return `- **Reach the leader and your peers with \`codex_app.send_message_to_thread\` - not by narrating in
  your own thread, where no one reads it.** The address book is in team.json: the leader thread id
  is \`leader.sessionId\`, and each peer thread id is its \`members[].threadId\`.
- **When you mention a Codex thread, include its app link too:** \`codex://threads/<threadId>\`.
  These links are the fastest way for the leader to reopen worktree-backed member threads.`;
}

function identityHeaderLine(team) {
	if (isMultiAgentV2(team)) {
		return `- Member identity convention: each member is the agent path \`${LEADER_AGENT_PATH}/<task name>\` - your row below shows yours; two members never share a task name`;
	}
	return `- Thread title convention: \`${team.threadTitleConvention}\` - each member's thread takes its OWN title from its name (your row below shows yours); two members never share a title`;
}

export function buildGuide(team) {
	const v2 = isMultiAgentV2(team);
	const artifacts = team.paths?.artifacts ?? ".omo/teams/<session_id>/artifacts";
	const teamJson = team.paths?.team ?? ".omo/teams/<session_id>/team.json";
	const roster = team.members.length ? team.members.map((member) => memberLine(member, v2)).join("\n") : "- (no members yet)";
	return `# Team ${team.teamName} - Member Field Manual

> Auto-generated by the teammode script. This file is the single source of truth for how
> this team works. Re-read it whenever you are unsure - do not improvise the protocol.

- Team: **${team.teamName}** (id \`${team.teamId}\`)
- Transport: **${transportLabel(team)}**
- Team state: \`${teamJson}\`
${identityHeaderLine(team)}

## Who you are (your identity is fixed)

**You are a member of team ${team.teamName}, not a generic assistant.** You own exactly one
slice of this team's work - the focus and deliverable assigned to your id below - and you are
accountable for it end to end. Read your row, internalize it, and act as that owner for the
whole session. Do not drift into other members' scope.

${roster}

## Leader

**The main session is the leader. There is no other leader, and you are not it.** You report
to the leader, take direction from the leader, and send your results to the leader. Peers
coordinate with each other, but the leader owns the final decision and integration.

## Communication rules (hard rules)

- **All communication between team members, and from you to the leader, is in English.** This
  is mandatory regardless of the language the task was given in.
- **Exception: when the END USER addresses you directly, reply in the user's own language.**
  Team-internal traffic stays English; user-facing replies match the user.
${addressBookRules(team)}
- **Push a short message at each of these moments - never batch them into one report at the end:**
  - to the **leader**: every finding or decision, every file or sub-task you finish, a
    \`WORKING: <focus> - <phase>\` heartbeat every few tool calls so you never look stale, a
    \`BLOCKED: <reason>\` the instant you cannot proceed, and your result the moment your slice is done.
  - to a **peer**: the instant you learn anything that touches their slice - a shared finding, a
    changed assumption, an interface they depend on. When unsure who owns it, send it to the leader.
- **Going quiet is the only failure.** Many small lean messages beat one end-of-work dump; keep
  every message short. Your heartbeats are what let the leader relax and leave you to work: a leader
  who can see your progress has no reason to interrupt you, while silence forces it to break in and
  ask where things stand. Frequent lean updates buy you uninterrupted focus.

## Artifacts (how you hand work off)

Exchange files and memos through the team artifacts directory:

\`${artifacts}\`

Drop deliverables, notes, diffs, and findings there as files, and reference them by path in
your messages instead of pasting large content into a thread. Treat it as the team's shared
desk: if a peer or the leader needs something from you, leave it in artifacts and point them to it.

${worktreeSection(team)}

## Done means reported and verified

Your slice is done only when (1) the deliverable exists, (2) you have evidence it works, and
(3) you have reported it to the leader. Until all three are true, keep going.`;
}

function memberIdentityLine(team, member) {
	if (isMultiAgentV2(team)) {
		return `Your task name is \`${member.taskName}\` (agent path \`${member.agentPath}\`).`;
	}
	return `Your thread title is \`${member.threadTitle}\`.`;
}

function memberEndpointNote(team, member) {
	if (isMultiAgentV2(team)) return "";
	return member.threadId ? `\nYour Codex thread link is ${codexThreadLink(member.threadId)}. Include it when reporting handoffs or worktree status.` : "";
}

function pushInstruction(team) {
	if (isMultiAgentV2(team)) {
		return `Push updates to the leader (target \`${LEADER_AGENT_PATH}\`) and relevant peers (their team.json \`members[].agentPath\`) with \`send_message\` as you work`;
	}
	return "Push updates to the leader and relevant peers with `codex_app.send_message_to_thread` as you work";
}

export function buildMemberPrompt(team, id) {
	const member = team.members.find((m) => m.id === id);
	if (!member) throw new Error(`no member with id "${id}"`);
	const guide = team.paths?.guide ?? ".omo/teams/<session_id>/guide.md";
	const teamJson = team.paths?.team ?? ".omo/teams/<session_id>/team.json";
	const where = member.cwd
		? `Work inside \`${member.cwd}\`.`
		: team.worktree?.enabled
			? "Wait for the leader to bind your worktree cwd before editing."
			: "Work from the repository root unless your manual assigns a worktree.";
	const readiness =
		team.worktree?.enabled
			? "\nBefore editing, verify that your assigned worktree exists and contains repo files. If this prompt arrived before your Codex worktree checkout is ready, or the path is missing, empty, or not a git worktree/repository yet, report `BLOCKED: worktree not ready` to the leader and wait."
			: "";
	return `You are member ${member.id}${member.name ? ` (${member.name})` : ""} of team ${team.teamName} - owner of: ${member.focus}. ${memberIdentityLine(team, member)}
FIRST read your field manual at \`${guide}\`, then the team state at \`${teamJson}\`; they define your scope, deliverable, the leader, the artifacts directory, and the communication rules.
${where}${memberEndpointNote(team, member)}${readiness}
Communicate with the team and leader in English; reply to the end user in the user's own language.
Start now. ${pushInstruction(team)} - findings, \`WORKING:\` heartbeats, and \`BLOCKED:\` the instant you stall - never just one report at the end.`;
}
