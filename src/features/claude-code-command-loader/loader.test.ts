import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadOpencodeGlobalCommands,
	loadOpencodeProjectCommands,
} from "./loader";

function writeCommand(
	directory: string,
	name: string,
	description: string,
): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, `${name}.md`),
		`---\ndescription: ${description}\n---\nRun ${name}.\n`,
	);
}

describe("claude-code command loader", () => {
	let testDir: string;
	let originalOpencodeConfigDir: string | undefined;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "claude-code-command-loader-"));
		originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
	});

	afterEach(() => {
		if (originalOpencodeConfigDir === undefined) {
			delete process.env.OPENCODE_CONFIG_DIR;
		} else {
			process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
		}
		rmSync(testDir, { recursive: true, force: true });
	});

	it("#given a parent .opencode/commands directory #when loadOpencodeProjectCommands is called from child directory #then it loads the ancestor command", async () => {
		// given
		const projectDir = join(testDir, "project");
		const childDir = join(projectDir, "apps", "desktop");
		writeCommand(
			join(projectDir, ".opencode", "commands"),
			"ancestor",
			"Ancestor command",
		);

		// when
		const commands = await loadOpencodeProjectCommands(childDir);

		// then
		expect(commands.ancestor?.description).toBe(
			"(opencode-project) Ancestor command",
		);
	});

	it("#given a .opencode/command directory #when loadOpencodeProjectCommands is called #then it loads the singular alias directory", async () => {
		// given
		writeCommand(
			join(testDir, ".opencode", "command"),
			"singular",
			"Singular command",
		);

		// when
		const commands = await loadOpencodeProjectCommands(testDir);

		// then
		expect(commands.singular?.description).toBe(
			"(opencode-project) Singular command",
		);
	});

	it("#given duplicate project command names across ancestors #when loadOpencodeProjectCommands is called #then the nearest directory wins", async () => {
		// given
		const projectRoot = join(testDir, "project");
		const childDir = join(projectRoot, "apps", "desktop");
		const ancestorDir = join(testDir, ".opencode", "commands");
		const projectDir = join(projectRoot, ".opencode", "commands");
		writeCommand(ancestorDir, "duplicate", "Ancestor command");
		writeCommand(projectDir, "duplicate", "Nearest command");

		// when
		const commands = await loadOpencodeProjectCommands(childDir);

		// then
		expect(commands.duplicate?.description).toBe(
			"(opencode-project) Nearest command",
		);
	});

	it("#given a global .opencode/commands directory #when loadOpencodeGlobalCommands is called #then it loads the plural alias directory", async () => {
		// given
		const opencodeConfigDir = join(testDir, "opencode-config");
		process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir;
		writeCommand(
			join(opencodeConfigDir, "commands"),
			"global-plural",
			"Global plural command",
		);

		// when
		const commands = await loadOpencodeGlobalCommands();

		// then
		expect(commands["global-plural"]?.description).toBe(
			"(opencode) Global plural command",
		);
	});

	it("#given duplicate global command names across profile and parent dirs #when loadOpencodeGlobalCommands is called #then the profile dir wins", async () => {
		// given
		const opencodeRootDir = join(testDir, "opencode-root");
		const profileConfigDir = join(opencodeRootDir, "profiles", "codex");
		process.env.OPENCODE_CONFIG_DIR = profileConfigDir;
		writeCommand(
			join(opencodeRootDir, "commands"),
			"duplicate-global",
			"Parent global command",
		);
		writeCommand(
			join(profileConfigDir, "commands"),
			"duplicate-global",
			"Profile global command",
		);

		// when
		const commands = await loadOpencodeGlobalCommands();

		// then
		expect(commands["duplicate-global"]?.description).toBe(
			"(opencode) Profile global command",
		);
	});

	it("#given nested project opencode commands in a worktree #when loadOpencodeProjectCommands is called #then it preserves slash names and stops at the worktree root", async () => {
		// given
		const repositoryDir = join(testDir, "repo");
		const nestedDirectory = join(repositoryDir, "packages", "app", "src");
		mkdirSync(nestedDirectory, { recursive: true });
		execFileSync("git", ["init"], {
			cwd: repositoryDir,
			stdio: ["ignore", "ignore", "ignore"],
		});
		writeCommand(
			join(repositoryDir, ".opencode", "commands", "deploy"),
			"staging",
			"Deploy staging",
		);
		writeCommand(
			join(repositoryDir, ".opencode", "command"),
			"release",
			"Release command",
		);
		writeCommand(
			join(testDir, ".opencode", "commands"),
			"outside",
			"Outside command",
		);

		// when
		const commands = await loadOpencodeProjectCommands(nestedDirectory);

		// then
		expect(commands["deploy/staging"]?.description).toBe(
			"(opencode-project) Deploy staging",
		);
		expect(commands.release?.description).toBe(
			"(opencode-project) Release command",
		);
		expect(commands.outside).toBeUndefined();
		expect(commands["deploy:staging"]).toBeUndefined();
	});
});
