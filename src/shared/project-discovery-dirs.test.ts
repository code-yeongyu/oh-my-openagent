import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findProjectAgentsSkillDirs,
	findProjectClaudeSkillDirs,
	findProjectOpencodeCommandDirs,
	findProjectOpencodeSkillDirs,
} from "./project-discovery-dirs";

const TEST_DIR = join(tmpdir(), `project-discovery-dirs-${Date.now()}`);

function canonicalPath(path: string): string {
	return realpathSync(path);
}

describe("project-discovery-dirs", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("#given nested .opencode skill directories #when finding project opencode skill dirs #then returns nearest-first with aliases", () => {
		// given
		const projectDir = join(TEST_DIR, "project");
		const childDir = join(projectDir, "apps", "cli");
		mkdirSync(join(projectDir, ".opencode", "skill"), { recursive: true });
		mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true });

		// when
		const directories = findProjectOpencodeSkillDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "skills")),
			canonicalPath(join(projectDir, ".opencode", "skill")),
		]);
	});

	it("#given nested .opencode command directories #when finding project opencode command dirs #then returns nearest-first with aliases", () => {
		// given
		const projectDir = join(TEST_DIR, "project");
		const childDir = join(projectDir, "packages", "tool");
		mkdirSync(join(projectDir, ".opencode", "commands"), { recursive: true });
		mkdirSync(join(TEST_DIR, ".opencode", "command"), { recursive: true });

		// when
		const directories = findProjectOpencodeCommandDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "commands")),
		]);
	});

	it("#given ancestor claude and agents skill directories #when finding project compatibility dirs #then discovers both scopes", () => {
		// given
		const projectDir = join(TEST_DIR, "project");
		const childDir = join(projectDir, "src", "nested");
		mkdirSync(join(projectDir, ".claude", "skills"), { recursive: true });
		mkdirSync(join(TEST_DIR, ".agents", "skills"), { recursive: true });

		// when
		const claudeDirectories = findProjectClaudeSkillDirs(childDir);
		const agentsDirectories = findProjectAgentsSkillDirs(childDir);

		// then
		expect(claudeDirectories).toEqual([
			canonicalPath(join(projectDir, ".claude", "skills")),
		]);
		expect(agentsDirectories).toEqual([]);
	});

	it("#given a stop directory #when finding ancestor dirs #then it does not scan beyond the stop boundary", () => {
		// given
		const projectDir = join(TEST_DIR, "project");
		const childDir = join(projectDir, "apps", "cli");
		mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true });

		// when
		const directories = findProjectOpencodeSkillDirs(childDir, projectDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "skills")),
		]);
	});

	it("#given a non-git project root marker #when finding project opencode skill dirs #then it stops before outside ancestors", () => {
		// given
		const workspaceDir = join(TEST_DIR, "workspace");
		const projectDir = join(workspaceDir, "project");
		const childDir = join(projectDir, "apps", "cli");
		mkdirSync(childDir, { recursive: true });
		mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(workspaceDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });

		// when
		const directories = findProjectOpencodeSkillDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "skills")),
		]);
	});

	it("#given nested workspace package root outside a nearer project boundary #when finding project opencode skill dirs #then it stops at the nearer boundary", () => {
		// given
		const workspaceDir = join(TEST_DIR, "workspace");
		const projectDir = join(workspaceDir, "project");
		const childDir = join(projectDir, "apps", "cli");
		mkdirSync(childDir, { recursive: true });
		mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(workspaceDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });
		writeFileSync(join(workspaceDir, "package.json"), "{}");

		// when
		const directories = findProjectOpencodeSkillDirs(childDir, undefined);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "skills")),
		]);
	});

	it("#given temp workspace root boundary without inner markers #when finding project opencode skill dirs #then it stops before temp ancestors", () => {
		// given
		const workspaceDir = join(TEST_DIR, "workspace");
		const childDir = join(workspaceDir, "project", "apps", "cli");
		mkdirSync(childDir, { recursive: true });
		mkdirSync(join(workspaceDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(TEST_DIR, ".opencode", "skills"), { recursive: true });

		// when
		const directories = findProjectOpencodeSkillDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(workspaceDir, ".opencode", "skills")),
		]);
	});

	it("#given git worktree root with a nearer nested project boundary #when finding project opencode skill dirs #then the nearer boundary wins", () => {
		// given
		const workspaceDir = join(TEST_DIR, "workspace-git");
		const projectDir = join(workspaceDir, "packages", "app");
		const childDir = join(projectDir, "src");
		mkdirSync(childDir, { recursive: true });
		execFileSync("git", ["init"], {
			cwd: workspaceDir,
			stdio: ["ignore", "ignore", "ignore"],
		});
		mkdirSync(join(workspaceDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(projectDir, ".opencode", "skills"), { recursive: true });
		mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });

		// when
		const directories = findProjectOpencodeSkillDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(projectDir, ".opencode", "skills")),
		]);
	});

	it("#given git worktree with nested package project marker only #when finding project opencode skill dirs #then repo root skills remain visible", () => {
		// given
		const workspaceDir = join(TEST_DIR, "workspace-package-git");
		const projectDir = join(workspaceDir, "packages", "app");
		const childDir = join(projectDir, "src");
		mkdirSync(childDir, { recursive: true });
		execFileSync("git", ["init"], {
			cwd: workspaceDir,
			stdio: ["ignore", "ignore", "ignore"],
		});
		mkdirSync(join(workspaceDir, ".opencode", "skills"), { recursive: true });
		writeFileSync(join(projectDir, "package.json"), "{}");

		// when
		const directories = findProjectOpencodeSkillDirs(childDir);

		// then
		expect(directories).toEqual([
			canonicalPath(join(workspaceDir, ".opencode", "skills")),
		]);
	});
});
