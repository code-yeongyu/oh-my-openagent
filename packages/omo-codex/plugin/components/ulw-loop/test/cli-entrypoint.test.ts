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
	return runProcessWithInput(command, args, cwd, "");
}

async function runProcessWithInput(
	command: string,
	args: readonly string[],
	cwd: string,
	input: string,
): Promise<CliResult> {
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
		child.stdin.end(input);
	});
}

let workspace: string;

async function runCli(args: readonly string[], input = ""): Promise<CliResult> {
	return runProcessWithInput(process.execPath, [builtCli, ...args], workspace, input);
}

beforeAll(async () => {
	const build =
		process.platform === "win32"
			? await runProcess("cmd.exe", ["/c", "npm", "run", "build"], componentRoot)
			: await runProcess("npm", ["run", "build"], componentRoot);
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

	it("#given standalone ulw-loop hook asks for ultrawork context #when user prompt is ulw #then emits the ultrawork directive", async () => {
		const payload = {
			cwd: workspace,
			hook_event_name: "UserPromptSubmit",
			model: "gpt-5.5",
			permission_mode: "default",
			prompt: "ulw this change",
			session_id: "s1",
			transcript_path: null,
			turn_id: "t1",
		};

		const result = await runCli(["hook", "user-prompt-submit", "--with-ultrawork"], `${JSON.stringify(payload)}\n`);
		const parsed = JSON.parse(result.stdout);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
	});
});
