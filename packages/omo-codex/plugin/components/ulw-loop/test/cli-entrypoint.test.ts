import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtCli = join(componentRoot, "dist", "cli.js");

type CliResult = {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
};

function sanitizedEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env["CODEX_SESSION_ID"];
	delete env["CODEX_THREAD_ID"];
	delete env["OMO_ULW_LOOP_SESSION_ID"];
	return env;
}

async function runProcess(command: string, args: readonly string[], cwd: string): Promise<CliResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, [...args], { cwd, env: sanitizedEnv() });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			resolvePromise({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

let workspace: string;

async function runCli(args: readonly string[]): Promise<CliResult> {
	return runProcess(process.execPath, [builtCli, ...args], workspace);
}

beforeAll(async () => {
	const build = await runProcess("npm", ["run", "build"], componentRoot);
	expect(build.code, `npm run build failed:\n${build.stderr}`).toBe(0);
}, 120_000);

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "ulw-loop-entrypoint-"));
});

afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

describe("dist/cli.js entrypoint dispatch", () => {
	it("#given no plan #when invoked with bare 'status --json' #then routes into ulw-loop instead of unknown command", async () => {
		const result = await runCli(["status", "--json"]);

		const combined = `${result.stdout}${result.stderr}`;
		expect(combined).toContain("No ulw-loop plan found");
		expect(combined).not.toContain("[omo] unknown command");
		expect(result.code).toBe(1);
	});

	it("#given no plan #when invoked with legacy 'ulw-loop status --json' #then still routes into ulw-loop", async () => {
		const result = await runCli(["ulw-loop", "status", "--json"]);

		const combined = `${result.stdout}${result.stderr}`;
		expect(combined).toContain("No ulw-loop plan found");
		expect(combined).not.toContain("[omo] unknown command");
		expect(result.code).toBe(1);
	});

	it("#given the top-level entrypoint #when invoked with 'help' #then prints usage and exits 0", async () => {
		const result = await runCli(["help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stdout).toContain("omo ulw-loop <subcommand>");
	});

	it("#given a command outside the ulw-loop vocabulary #when invoked with 'frobnicate' #then fails as unknown command", async () => {
		const result = await runCli(["frobnicate"]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain("[omo] unknown command: frobnicate");
	});
});
