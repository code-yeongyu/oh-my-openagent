#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	analyzeCuratedAgentRun,
	analyzeCuratedSandboxFiles,
} from "./curated-agents-e2e-analysis.mjs";
import {
	CURATED_AGENT_OMO_CONFIG,
	CURATED_AGENT_SCRIPT,
} from "./curated-agents-e2e-scenarios.mjs";
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs";
import {
	changedRealPaths,
	classifyRealSenpiChanges,
	parseJsonEvents,
	snapshotDir,
} from "./task-e2e-analysis.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "curated-agents-e2e-mock-provider.ts");
const realSenpiAgentDir = join(homedir(), ".senpi", "agent");
const childContextsFile = "curated-child-contexts.jsonl";
const probeContents = "export const probe: string = 42\n";

function seedScenario() {
	const sandbox = createSandbox();
	seedSandbox(sandbox);
	const sessionDir = join(sandbox.root, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	const omoDir = join(sandbox.cwd, ".omo");
	mkdirSync(omoDir, { recursive: true });
	writeFileSync(
		join(omoDir, "omo.json"),
		`${JSON.stringify(CURATED_AGENT_OMO_CONFIG, null, 2)}\n`,
	);
	writeFileSync(
		join(sandbox.cwd, "mock-script.json"),
		`${JSON.stringify(CURATED_AGENT_SCRIPT, null, 2)}\n`,
	);
	writeFileSync(
		join(sandbox.cwd, "qa-probe.ts"),
		probeContents,
	);
	return {
		sandbox,
		sessionDir,
		stateDir: join(sandbox.cwd, ".omo", "senpi-task"),
		childContextsPath: join(sandbox.cwd, childContextsFile),
	};
}

function driveSenpi(senpiBin, scenario) {
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
			"exercise the curated explore child and unknown-target error",
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
			timeout: 120_000,
			maxBuffer: 64 * 1024 * 1024,
		},
	);
}

function readExploreRecord(stateDir) {
	const tasksDir = join(stateDir, "tasks");
	if (!existsSync(tasksDir)) return {};
	for (const entry of readdirSync(tasksDir).filter((name) =>
		name.endsWith(".json"),
	)) {
		const record = JSON.parse(readFileSync(join(tasksDir, entry), "utf8"));
		if (record?.agent_type === "explore")
			return { taskId: entry.replace(/\.json$/, ""), record };
	}
	return {};
}

function readTaskEvents(stateDir, taskId) {
	if (typeof taskId !== "string") return [];
	const path = join(stateDir, "logs", `${taskId}.jsonl`);
	return existsSync(path) ? parseJsonEvents(readFileSync(path, "utf8")) : [];
}

function readChildContexts(path) {
	return existsSync(path) ? parseJsonEvents(readFileSync(path, "utf8")) : [];
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
		join(outDir, "curated-agents-e2e.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

function main() {
	const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR
		? "IGNORED"
		: "unset";
	const beforeDigest = digestDirectory(realSenpiAgentDir);
	const beforeSnapshot = snapshotDir(realSenpiAgentDir);
	const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi");
	if (senpiBin === null) {
		console.log(
			JSON.stringify({
				result: "SKIP",
				reason: "senpi-binary-unavailable",
				providedAgentDir,
			}),
		);
		return;
	}

	const scenario = seedScenario();
	const run = driveSenpi(senpiBin, scenario);
	const { taskId, record } = readExploreRecord(scenario.stateDir);
	const analysis = analyzeCuratedAgentRun({
		record,
		childContexts: readChildContexts(scenario.childContextsPath),
		taskEvents: readTaskEvents(scenario.stateDir, taskId),
		parentOutput: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
	});
	const afterDigest = digestDirectory(realSenpiAgentDir);
	const allRealSenpiChangedPaths = changedRealPaths(
		beforeSnapshot,
		snapshotDir(realSenpiAgentDir),
	);
	const { qaAttributedPaths, concurrentSessionPaths } =
		classifyRealSenpiChanges(allRealSenpiChangedPaths, [
			basename(scenario.sandbox.root),
		]);
	const checks = {
		...analysis.checks,
		senpi_exit: run.status === 0 ? "PASS" : "FAIL",
		...analyzeCuratedSandboxFiles(scenario.sandbox.cwd, probeContents),
		real_senpi_untouched: qaAttributedPaths.length === 0 ? "PASS" : "FAIL",
	};
	const payload = {
		result: Object.values(checks).every((check) => check === "PASS")
			? "PASS"
			: "FAIL",
		checks,
		taskId,
		sandboxAgentDir: scenario.sandbox.agentDir,
		sandboxCwd: scenario.sandbox.cwd,
		stateDir: scenario.stateDir,
		childContextCaptures: readChildContexts(scenario.childContextsPath).length,
		realSenpiChangedPaths: qaAttributedPaths,
		concurrentRealSenpiChangedPaths: concurrentSessionPaths,
		allRealSenpiChangedPaths,
		realSenpiDigestUnchanged: beforeDigest === afterDigest,
		providedAgentDir,
		senpiExit: run.status,
		senpiSignal: run.signal ?? null,
	};
	const configuredOutDir = process.env.CURATED_AGENTS_E2E_OUT_DIR?.trim();
	writeVerdict(
		configuredOutDir ? resolve(configuredOutDir) : undefined,
		payload,
	);
	console.log(JSON.stringify(payload));
	if (payload.result !== "PASS") process.exitCode = 1;
}

main();
