import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isOckBeadFirstProject } from "./ock-bead-first-project";

const OPTIONAL_WORKFLOW_COMMANDS = ["research", "start", "plan", "ship"];

function writeCommand(directory: string, name: string): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, `${name}.md`),
		`---\ndescription: ${name}\n---\n`,
		"utf-8",
	);
}

function createOckWorkflowRoot(rootDirectory: string): void {
	mkdirSync(join(rootDirectory, ".git"), { recursive: true });
	mkdirSync(join(rootDirectory, ".beads"), { recursive: true });
	const commandDirectory = join(rootDirectory, ".opencode", "command");

	writeCommand(commandDirectory, "create");
	for (const commandName of OPTIONAL_WORKFLOW_COMMANDS) {
		writeCommand(commandDirectory, commandName);
	}
}

describe("isOckBeadFirstProject", () => {
	const tempDirectories: string[] = [];

	afterEach(() => {
		for (const tempDirectory of tempDirectories) {
			rmSync(tempDirectory, { force: true, recursive: true });
		}
		tempDirectories.length = 0;
	});

	it("returns true when nearest ancestor has .beads and OCK workflow commands", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		const projectRoot = join(tempDirectory, "project");
		const nestedDirectory = join(projectRoot, "apps", "desktop");

		createOckWorkflowRoot(projectRoot);
		mkdirSync(nestedDirectory, { recursive: true });

		expect(isOckBeadFirstProject(nestedDirectory)).toBe(true);
	});

	it("returns false when only .opencode exists", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		mkdirSync(join(tempDirectory, ".git"), { recursive: true });
		const commandDirectory = join(tempDirectory, ".opencode", "command");

		writeCommand(commandDirectory, "create");

		expect(isOckBeadFirstProject(tempDirectory)).toBe(false);
	});

	it("returns false when only .beads exists", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		mkdirSync(join(tempDirectory, ".git"), { recursive: true });

		mkdirSync(join(tempDirectory, ".beads"), { recursive: true });

		expect(isOckBeadFirstProject(tempDirectory)).toBe(false);
	});

	it("returns false without a git boundary even when OCK markers exist", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);

		mkdirSync(join(tempDirectory, ".beads"), { recursive: true });
		const commandDirectory = join(tempDirectory, ".opencode", "command");
		writeCommand(commandDirectory, "create");
		writeCommand(commandDirectory, "research");
		writeCommand(commandDirectory, "start");
		writeCommand(commandDirectory, "plan");

		expect(isOckBeadFirstProject(tempDirectory)).toBe(false);
	});

	it("uses nearest matching ancestor inside nested directories", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		const outerRoot = join(tempDirectory, "outer");
		const innerRoot = join(outerRoot, "inner");
		const nestedDirectory = join(innerRoot, "apps", "desktop");

		mkdirSync(join(outerRoot, ".beads"), { recursive: true });
		writeCommand(join(outerRoot, ".opencode", "command"), "create");
		createOckWorkflowRoot(innerRoot);
		mkdirSync(nestedDirectory, { recursive: true });

		expect(isOckBeadFirstProject(nestedDirectory)).toBe(true);
	});

	it("returns false when only two optional workflow commands are present", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		mkdirSync(join(tempDirectory, ".git"), { recursive: true });
		mkdirSync(join(tempDirectory, ".beads"), { recursive: true });
		const commandDirectory = join(tempDirectory, ".opencode", "command");

		writeCommand(commandDirectory, "create");
		writeCommand(commandDirectory, "research");
		writeCommand(commandDirectory, "start");

		expect(isOckBeadFirstProject(tempDirectory)).toBe(false);
	});

	it("returns true when pr.md is the third optional workflow command", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		mkdirSync(join(tempDirectory, ".git"), { recursive: true });
		mkdirSync(join(tempDirectory, ".beads"), { recursive: true });
		const commandDirectory = join(tempDirectory, ".opencode", "command");

		writeCommand(commandDirectory, "create");
		writeCommand(commandDirectory, "research");
		writeCommand(commandDirectory, "start");
		writeCommand(commandDirectory, "pr");

		expect(isOckBeadFirstProject(tempDirectory)).toBe(true);
	});

	it("returns true when canonical commands are under the plural commands alias", () => {
		const tempDirectory = mkdtempSync(
			join(tmpdir(), "ock-bead-first-project-"),
		);
		tempDirectories.push(tempDirectory);
		mkdirSync(join(tempDirectory, ".git"), { recursive: true });
		mkdirSync(join(tempDirectory, ".beads"), { recursive: true });
		const commandDirectory = join(tempDirectory, ".opencode", "commands");

		writeCommand(commandDirectory, "create");
		writeCommand(commandDirectory, "research");
		writeCommand(commandDirectory, "start");
		writeCommand(commandDirectory, "plan");

		expect(isOckBeadFirstProject(tempDirectory)).toBe(true);
	});
});
