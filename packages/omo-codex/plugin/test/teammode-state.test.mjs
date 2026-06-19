import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pure team-state model tests. The script is tested through the SYNCED (shipped) copy,
// mirroring scaffold-plan.test.mjs; a sync drift test guarantees it equals the component
// source. Run `npm run sync:skills` before this suite (build/test:codex do that).
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stateModuleUrl = pathToFileURL(join(root, "skills", "teammode", "scripts", "team-state.mjs")).href;

test("#given buildTeam #when a team is created #then it carries the v2 shape, a uuid, and a main-session leader", async () => {
	// given
	const { buildTeam } = await import(stateModuleUrl);

	// when
	const team = buildTeam({
		teamName: "Refactor Crew",
		sessionName: "auth-cleanup",
		sessionId: "demo",
		dir: "/abs/.omo/teams/demo",
		now: "2026-06-19T00:00:00.000Z",
	});

	// then
	assert.equal(team.schemaVersion, 2);
	assert.match(team.teamId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.equal(team.teamName, "Refactor Crew");
	assert.equal(team.status, "active");
	assert.equal(team.leader.kind, "main-session");
	assert.equal(team.communication.memberLanguage, "english");
	assert.equal(team.communication.replyToUserInUserLanguage, true);
	assert.equal(team.threadTitleConvention, "[Refactor Crew] auth-cleanup");
	assert.equal(team.worktree.enabled, false);
	assert.deepEqual(team.members, []);
});

test("#given addMember #when members are added #then lens is constrained and ids are unique with concrete focus", async () => {
	// given
	const { buildTeam, addMember } = await import(stateModuleUrl);
	let team = buildTeam({ teamName: "T", sessionName: "s", sessionId: "demo", dir: "/abs/.omo/teams/demo" });

	// when
	team = addMember(team, { id: "A", focus: "packages/omo-opencode/src/hooks", lens: "ownership", deliverable: "audit hooks" });

	// then
	assert.equal(team.members.length, 1);
	assert.equal(team.members[0].id, "A");
	assert.equal(team.members[0].lens, "ownership");
	assert.equal(team.members[0].status, "pending");
	assert.equal(team.members[0].threadId, null);
	// and --- guardrails: a vague job role (bad lens), a duplicate id, and an empty focus are refused
	assert.throws(() => addMember(team, { id: "B", focus: "x", lens: "release-analyst", deliverable: "d" }), /lens/i);
	assert.throws(() => addMember(team, { id: "A", focus: "y", lens: "area", deliverable: "d" }), /duplicate|exists/i);
	assert.throws(() => addMember(team, { id: "C", focus: "   ", lens: "area", deliverable: "d" }), /focus/i);
});

test("#given bindThread and setMemberStatus #when a member is wired to a thread #then thread, cwd, and status update with a log entry", async () => {
	// given
	const { buildTeam, addMember, bindThread, setMemberStatus } = await import(stateModuleUrl);
	let team = buildTeam({ teamName: "T", sessionName: "s", sessionId: "demo", dir: "/abs/.omo/teams/demo" });
	team = addMember(team, { id: "A", focus: "the OpenCode adapter", lens: "area", deliverable: "map adapters" });

	// when
	team = bindThread(team, { id: "A", threadId: "019eddb9-eb73", cwd: "/abs/wt/a" });
	const logLenAfterBind = team.log.length;
	team = setMemberStatus(team, { id: "A", status: "reported", note: "done" });

	// then
	const member = team.members.find((m) => m.id === "A");
	assert.equal(member.threadId, "019eddb9-eb73");
	assert.equal(member.cwd, "/abs/wt/a");
	assert.equal(member.status, "reported");
	assert.ok(team.log.length > logLenAfterBind, "status change appends a log entry");
});

test("#given archive #when the team is archived #then every member closes and the team flips to archived", async () => {
	// given
	const { buildTeam, addMember, archive } = await import(stateModuleUrl);
	let team = buildTeam({ teamName: "T", sessionName: "s", sessionId: "demo", dir: "/abs/.omo/teams/demo" });
	team = addMember(team, { id: "A", focus: "a", lens: "area", deliverable: "d" });
	team = addMember(team, { id: "B", focus: "b", lens: "perspective", deliverable: "d" });

	// when
	team = archive(team, {});

	// then
	assert.equal(team.status, "archived");
	assert.ok(team.archivedAt);
	assert.ok(team.members.every((m) => m.status === "archived"));
});

test("#given resolveTeamDir #when the session id would escape #then it is refused and confined under .omo/teams", async () => {
	// given
	const { resolveTeamDir } = await import(stateModuleUrl);
	const cwd = "/tmp/ws";

	// then
	assert.ok(resolveTeamDir(cwd, "demo").replace(/\\/g, "/").endsWith(".omo/teams/demo"));
	assert.throws(() => resolveTeamDir(cwd, "../evil"));
	assert.throws(() => resolveTeamDir(cwd, "a/b"));
	assert.throws(() => resolveTeamDir(cwd, ""));
});

test("#given validateTeam #when a required field is missing #then it throws (schema drift guard)", async () => {
	// given
	const { buildTeam, validateTeam } = await import(stateModuleUrl);
	const team = buildTeam({ teamName: "T", sessionName: "s", sessionId: "demo", dir: "/abs/.omo/teams/demo" });

	// then
	assert.doesNotThrow(() => validateTeam(team));
	assert.throws(() => validateTeam({ ...team, schemaVersion: undefined }), /schemaVersion/i);
	assert.throws(() => validateTeam({ ...team, leader: { kind: "thread" } }), /leader|main-session/i);
});
