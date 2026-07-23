#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs";
import {
	changedRealPaths,
	classifyRealSenpiChanges,
	parseJsonEvents,
	snapshotDir,
} from "./task-e2e-analysis.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "variant-thinking-mock-provider.ts");
const realSenpiAgentDir = join(homedir(), ".senpi", "agent");
const capturesFile = "variant-thinking-captures.jsonl";

const CASES = [
	{ agent: "momus", prompt: "review the variant qa fixture plan", expected: "xhigh" },
	{ agent: "metis", prompt: "gap-analyze the variant qa fixture plan", expected: "medium" },
];

function mockScript(agent) {
	return {
		childSteps: [{ type: "text", text: "variant qa child done" }],
		parentSteps: [
			{
				type: "tool_call",
				name: "task",
				arguments: {
					subagent_type: agent,
					prompt: `run the ${agent} variant child`,
					run_in_background: false,
					name: `qa-${agent}`,
				},
			},
			{ type: "text", text: "parent done" },
		],
	};
}

function seedScenario(agent) {
	const sandbox = createSandbox();
	seedSandbox(sandbox);
	const sessionDir = join(sandbox.root, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(
		join(sandbox.cwd, "mock-script.json"),
		`${JSON.stringify(mockScript(agent), null, 2)}\n`,
	);
	return {
		sandbox,
		sessionDir,
		stateDir: join(sandbox.cwd, ".omo", "senpi-task"),
		capturesPath: join(sandbox.cwd, capturesFile),
	};
}

function driveSenpi(senpiBin, scenario, agent) {
	return spawnSync(
		senpiBin,
		[
			"-e",
			mockProvider,
			"-p",
			"--mode",
			"json",
			"--provider",
			"omo-mock",
			"--model",
			"mock-1",
			"--session-dir",
			scenario.sessionDir,
			`run the ${agent} variant child`,
		],
		{
			cwd: scenario.sandbox.cwd,
			env: {
				...process.env,
				SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
				SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
				OMO_SENPI_QA: "1",
			},
			encoding: "utf8",
			timeout: 180_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

function readCaptures(path) {
	return existsSync(path) ? parseJsonEvents(readFileSync(path, "utf8")) : [];
}

function readAgentVariant(stateDir, agent) {
	const tasksDir = join(stateDir, "tasks");
	if (!existsSync(tasksDir)) return { variant: null, statuses: [] };
	let found = null;
	const statuses = [];
	for (const entry of readdirSync(tasksDir).filter((name) => name.endsWith(".json"))) {
		const record = JSON.parse(readFileSync(join(tasksDir, entry), "utf8"));
		if (record?.agent_type === agent) {
			statuses.push(record?.status ?? "unknown");
			if (record?.status === "completed") {
				found = record?.resolved_model?.variant ?? null;
				writeFileSync("/tmp/metis-record-dump.json", JSON.stringify(record, null, 2));
			}
		}
	}
	return { variant: found, statuses };
}

function findOnPath(bin) {
	if (bin.includes("/")) return existsSync(bin) ? bin : null;
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		const candidate = resolve(dir || ".", bin);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function writeVerdict(outDir, payload) {
	if (outDir === undefined) return;
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, "variant-thinking-e2e.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

function runCase(senpiBin, fixture) {
	const scenario = seedScenario(fixture.agent);
	const run = driveSenpi(senpiBin, scenario, fixture.agent);
	const childCaptures = readCaptures(scenario.capturesPath).filter(
		(capture) => capture?.child === true,
	);
	const recordRead = readAgentVariant(scenario.stateDir, fixture.agent);
	const recordVariant = recordRead.variant;
	const applied = childCaptures[0]?.reasoning ?? null;
	return {
		agent: fixture.agent,
		sandboxCwd: scenario.sandbox.cwd,
		checks: {
			senpi_exit: run.status === 0 ? "PASS" : "FAIL",
			one_child_stream: childCaptures.length === 1 ? "PASS" : "FAIL",
			applied_matches_variant: applied === fixture.expected ? "PASS" : "FAIL",
			record_variant: recordVariant === fixture.expected ? "PASS" : "FAIL",
		},
		expected: fixture.expected,
		applied,
		recordVariant,
		recordStatuses: recordRead.statuses,
		childCaptures,
		parentTail: `${run.stdout ?? ""}\n${run.stderr ?? ""}`.split("\n").slice(-8),
	};
}

function main() {
	const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset";
	const beforeDigest = digestDirectory(realSenpiAgentDir);
	const beforeSnapshot = snapshotDir(realSenpiAgentDir);
	const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi");
	if (senpiBin === null) {
		console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }));
		return;
	}

	const cases = CASES.map((fixture) => runCase(senpiBin, fixture));
	const afterDigest = digestDirectory(realSenpiAgentDir);
	const allRealSenpiChangedPaths = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir));
	const { qaAttributedPaths, concurrentSessionPaths } = classifyRealSenpiChanges(
		allRealSenpiChangedPaths,
		["omo-senpi-qa-"],
	);
	const checks = {
		...Object.fromEntries(
			cases.flatMap((entry) =>
				Object.entries(entry.checks).map(([name, verdict]) => [`${entry.agent}_${name}`, verdict]),
			),
		),
		real_senpi_untouched: qaAttributedPaths.length === 0 ? "PASS" : "FAIL",
	};
	const payload = {
		result: Object.values(checks).every((check) => check === "PASS") ? "PASS" : "FAIL",
		checks,
		cases,
		realSenpiChangedPaths: qaAttributedPaths,
		concurrentRealSenpiChangedPaths: concurrentSessionPaths,
		realSenpiDigestUnchanged: beforeDigest === afterDigest,
		providedAgentDir,
	};
	const configuredOutDir = process.env.VARIANT_THINKING_E2E_OUT_DIR?.trim();
	writeVerdict(configuredOutDir ? resolve(configuredOutDir) : undefined, payload);
	console.log(JSON.stringify(payload));
	if (payload.result !== "PASS") process.exitCode = 1;
}

main();
