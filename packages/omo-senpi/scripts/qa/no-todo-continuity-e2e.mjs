#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "mock-provider", "index.ts");
const realAgentDir = join(homedir(), ".senpi", "agent");
const alpha = "Wait for alpha approval";
const beta = "Wait for beta approval";
const followUp = "ordinary follow-up after todo seed";

function scenarioEnv(sandbox, sessionDir) {
	const home = join(sandbox.root, "home");
	mkdirSync(home, { recursive: true });
	return {
		...process.env,
		HOME: home,
		USERPROFILE: home,
		XDG_CONFIG_HOME: sandbox.xdgConfigHome,
		SENPI_CODING_AGENT_DIR: sandbox.agentDir,
		SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
		PI_CODING_AGENT_DIR: sandbox.agentDir,
		PI_CODING_AGENT_SESSION_DIR: sessionDir,
		OMO_SENPI_QA: "1",
	};
}

function runPrint({
	senpiBin,
	sandbox,
	sessionDir,
	prompt,
	steps,
	continuation = false,
}) {
	writeFileSync(
		join(sandbox.cwd, "mock-script.json"),
		`${JSON.stringify({ steps }, null, 2)}\n`,
	);
	return spawnSync(
		senpiBin,
		[
			"-e",
			mockProvider,
			"-p",
			"--provider",
			"omo-mock",
			"--model",
			"mock-1",
			"--session-dir",
			sessionDir,
			...(continuation ? ["-c"] : []),
			prompt,
		],
		{
			cwd: sandbox.cwd,
			env: scenarioEnv(sandbox, sessionDir),
			encoding: "utf8",
			timeout: 120_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

function parseJsonLine(line) {
	try {
		return JSON.parse(line);
	} catch (error) {
		if (error instanceof SyntaxError) {
			return undefined;
		}
		throw error;
	}
}

function readSessionEntries(sessionDir) {
	const entries = [];
	const visit = (dir) => {
		if (!existsSync(dir)) {
			return;
		}
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, item.name);
			if (item.isDirectory()) {
				visit(full);
				continue;
			}
			if (!item.name.endsWith(".jsonl")) {
				continue;
			}
			for (const line of readFileSync(full, "utf8").split("\n")) {
				if (line.trim() === "") {
					continue;
				}
				const entry = parseJsonLine(line);
				if (entry !== undefined) {
					entries.push(entry);
				}
			}
		}
	};
	visit(sessionDir);
	return entries;
}

function main() {
	const senpiBin = process.env.SENPI_BIN?.trim() || "senpi";
	const beforeDigest = credentialDigest(realAgentDir);
	const sandbox = createSandbox();
	const sessionDir = join(sandbox.root, "sessions");
	let report;

	try {
		seedSandbox(sandbox);
		mkdirSync(sessionDir, { recursive: true });

		const seed = runPrint({
			senpiBin,
			sandbox,
			sessionDir,
			prompt: "seed approval todos",
			steps: [
				{
					type: "tool_call",
					name: "todo",
					arguments: {
						op: "init",
						list: [{ phase: "Approvals", items: [alpha, beta] }],
					},
				},
				{ type: "text", text: "approvals seeded" },
			],
		});
		const continuation = runPrint({
			senpiBin,
			sandbox,
			sessionDir,
			prompt: followUp,
			steps: [{ type: "text", text: "follow-up complete" }],
			continuation: true,
		});

		const entries = readSessionEntries(sessionDir);
		const serialized = JSON.stringify(entries);
		const continuityTags =
			serialized.match(/<omo-todo-continuity>/g)?.length ?? 0;
		const continuityGuidance =
			serialized.match(/todo items remain open/g)?.length ?? 0;
		const todoStatePresent =
			serialized.includes('"customType":"senpi.todo-state"') &&
			serialized.includes(alpha) &&
			serialized.includes(beta);
		const followUpPresent = serialized.includes(followUp);

		report = {
			result:
				seed.status === 0 &&
				continuation.status === 0 &&
				todoStatePresent &&
				followUpPresent &&
				continuityTags === 0 &&
				continuityGuidance === 0
					? "PASS"
					: "FAIL",
			seedExitStatus: seed.status,
			continuationExitStatus: continuation.status,
			todoStatePresent,
			followUpPresent,
			continuityTags,
			continuityGuidance,
			sandboxAgentDir: sandbox.agentDir,
			realAgentDirUnchanged: beforeDigest === credentialDigest(realAgentDir),
		};
	} finally {
		rmSync(sandbox.root, { recursive: true, force: true });
	}

	const finalReport = {
		...report,
		cleanup: existsSync(sandbox.root)
			? "FAIL: sandbox remains"
			: "PASS: sandbox removed",
	};
	console.log(JSON.stringify(finalReport, null, 2));
	if (
		finalReport.result !== "PASS" ||
		finalReport.cleanup !== "PASS: sandbox removed" ||
		finalReport.realAgentDirUnchanged !== true
	) {
		process.exitCode = 1;
	}
}

main();
