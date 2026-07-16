import { buildGuide } from "./team-guide.mjs";
import {
	assertSafeTeamDir,
	readTeam,
	withTeamLock,
	writeGuideAtomic,
	writeTeamAtomic,
} from "./team-state.mjs";

export function requireFlag(flags, name) {
	const value = flags[name];
	if (value === undefined || value === true)
		throw new Error(`missing required flag --${name}`);
	return value;
}

export async function loadTeam(cwd, sessionId) {
	const dir = await assertSafeTeamDir(cwd, sessionId);
	return { dir, team: await readTeam(dir) };
}

export function memberOrThrow(team, id) {
	const member = team.members.find((candidate) => candidate.id === id);
	if (!member) throw new Error(`no member with id "${id}"`);
	return member;
}

export async function persistTeam(team, dir) {
	await writeTeamAtomic(team, dir);
	await writeGuideAtomic(team, buildGuide(team), dir);
}

export async function mutateTeam(cwd, sessionId, command, operation) {
	const dir = await assertSafeTeamDir(cwd, sessionId);
	return withTeamLock(dir, command, async () => {
		const team = await readTeam(dir);
		return operation(team, dir);
	});
}
