import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { root } from "./aggregate-plugin-fixture.mjs";

const teamScript = join(
	root,
	"components",
	"teammode",
	"skills",
	"teammode",
	"scripts",
	"team.mjs",
);

export function createTeamRoot(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTeamRoot(tempRoot) {
	rmSync(tempRoot, { recursive: true, force: true });
}

export function teamDir(tempRoot, sessionId) {
	return join(tempRoot, ".omo", "teams", sessionId);
}

export function teamJsonPath(tempRoot, sessionId) {
	return join(teamDir(tempRoot, sessionId), "team.json");
}

export function readTeamJson(tempRoot, sessionId) {
	return JSON.parse(readFileSync(teamJsonPath(tempRoot, sessionId), "utf8"));
}

export function runTeam(cwd, ...args) {
	const result = runTeamRaw(cwd, ...args);
	assert.equal(
		result.status,
		0,
		`team.mjs ${args.join(" ")} failed: ${result.stderr}`,
	);
	return result;
}

export function runTeamRaw(cwd, ...args) {
	return spawnSync(process.execPath, [teamScript, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 10_000,
	});
}

export function addV2Members(tempRoot, sessionId) {
	runTeam(
		tempRoot,
		"add-member",
		"--team",
		sessionId,
		"--id",
		"A",
		"--name",
		"runtime-core",
		"--task-name",
		"runtime_core",
		"--focus",
		"runtime state and binding",
		"--lens",
		"ownership",
		"--deliverable",
		"runtime contract",
	);
	runTeam(
		tempRoot,
		"add-member",
		"--team",
		sessionId,
		"--id",
		"B",
		"--name",
		"mailbox-delivery",
		"--task-name",
		"mailbox_delivery",
		"--focus",
		"cross-agent message delivery",
		"--lens",
		"area",
		"--deliverable",
		"delivery evidence",
	);
}

export function runTeamRawWithEnv(cwd, env, ...args) {
	return spawnSync(process.execPath, [teamScript, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 10_000,
	});
}

export function runTeamAsync(cwd, ...args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [teamScript, ...args], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`team.mjs ${args.join(" ")} timed out`));
		}, 10_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (status, signal) => {
			clearTimeout(timer);
			resolve({ status, signal, stdout, stderr });
		});
	});
}

export function symlinkOrSkip(t, target, path, type) {
	try {
		symlinkSync(target, path, type);
		return true;
	} catch (error) {
		if (isUnavailableSymlinkError(error)) {
			t.skip(`symlink unavailable on this filesystem: ${error.code}`);
			return false;
		}
		throw error;
	}
}

function isUnavailableSymlinkError(error) {
	return (
		error?.code === "EPERM" ||
		error?.code === "EACCES" ||
		error?.code === "EINVAL"
	);
}

export function createArchivedOutsideTeam(tempRoot, sessionId) {
	const outsideTeams = join(tempRoot, "outside-teams");
	const outsideTeamDir = join(outsideTeams, sessionId);
	mkdirSync(outsideTeamDir, { recursive: true });
	writeFileSync(
		join(outsideTeamDir, "team.json"),
		`${JSON.stringify(
			{
				schemaVersion: 2,
				teamId: "outside-team",
				teamName: "Outside",
				sessionName: "Escape",
				leader: { kind: "main-session", sessionId },
				status: "archived",
				members: [],
			},
			null,
			2,
		)}\n`,
	);
	return { outsideTeams, outsideTeamDir };
}

export function assertOutsideTeamIntact(outsideTeamDir) {
	assert.equal(existsSync(outsideTeamDir), true);
	assert.equal(
		JSON.parse(readFileSync(join(outsideTeamDir, "team.json"), "utf8")).teamId,
		"outside-team",
	);
}
