import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runPostCompactHook } from "../src/codex-hook.js";
import {
	cleanupPostCompactFixtures,
	compactSessionStartInput,
	EXPANDED_POST_COMPACT_ENV,
	makeOversizedProject,
	postCompactInput,
	readOptionalAdditionalContext,
	writeCompactedWarningTranscript,
} from "./post-compact-test-fixture.ts";

type CliResult = {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
};

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

beforeAll(() => {
	execFileSync("npm", ["run", "build", "--silent"], { cwd: PLUGIN_ROOT, stdio: "pipe" });
});

afterAll(() => {
	cleanupPostCompactFixtures();
});

describe("codex rules post-compact cross-process recovery", () => {
	it("#given two compact hook processes share session state #when both start concurrently #then only one emits the budgeted recovery context", async () => {
		// given
		const { root, pluginData } = makeOversizedProject("process");
		const transcriptPath = writeCompactedWarningTranscript(root, "G".repeat(760_000));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);
		const input = `${JSON.stringify(compactSessionStartInput(root, transcriptPath))}\n`;

		// when
		const [first, second] = await Promise.all([
			runHookCli(input, "session-start", { ...EXPANDED_POST_COMPACT_ENV, PLUGIN_DATA: pluginData }),
			runHookCli(input, "session-start", { ...EXPANDED_POST_COMPACT_ENV, PLUGIN_DATA: pluginData }),
		]);

		// then
		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect(first.stderr).toBe("");
		expect(second.stderr).toBe("");
		const contexts = [first.stdout, second.stdout].map(readOptionalAdditionalContext);
		expect(contexts.filter((context) => context.length > 0)).toHaveLength(1);
		expect(contexts.join("").length).toBeLessThan(1_000);
	});
});

function runHookCli(input: string, subcommand: string, env: NodeJS.ProcessEnv): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_PATH, "hook", subcommand], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (exitCode) => {
			resolve({ exitCode, stdout, stderr });
		});
		child.stdin.end(input);
	});
}
