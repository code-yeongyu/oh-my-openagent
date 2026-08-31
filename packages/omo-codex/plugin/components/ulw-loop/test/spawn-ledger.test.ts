import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applySpawnLedger,
	applySpawnLedgerPostCompact,
	runSpawnLedgerCli,
	runSpawnLedgerPostCompactCli,
	type SpawnLedgerPostToolUsePayload,
} from "../src/spawn-ledger-hook.ts";

let workDir: string;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "ulw-spawn-ledger-"));
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

function sessionDir(): string {
	return join(workDir, ".omo", "ulw-loop", "s1");
}

function ledgerPath(): string {
	return join(sessionDir(), "spawn-ledger.jsonl");
}

function pendingPath(): string {
	return join(sessionDir(), "pending-spawns.jsonl");
}

function writeActivePlan(): void {
	mkdirSync(sessionDir(), { recursive: true });
	writeFileSync(
		join(sessionDir(), "goals.json"),
		JSON.stringify({
			goals: [{ id: "g1", title: "research axis", status: "in_progress" }],
		}),
	);
}

function postToolUsePayload(overrides: Partial<SpawnLedgerPostToolUsePayload> = {}): SpawnLedgerPostToolUsePayload {
	return {
		hook_event_name: "PostToolUse",
		session_id: "s1",
		cwd: workDir,
		tool_name: "spawn_agent",
		tool_use_id: "tu1",
		tool_input: { message: "TASK: act as an explorer. AXIS: swarm internals." },
		tool_response: {},
		...overrides,
	};
}

function readLines(path: string): Array<Record<string, unknown>> {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function runCli(
	runner: (stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream) => Promise<void>,
	payload: unknown,
): Promise<string> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	stdin.write(JSON.stringify(payload));
	stdin.end();
	let output = "";
	stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString("utf8");
	});
	await runner(stdin, stdout);
	return output;
}

describe("applySpawnLedger", () => {
	it("#given an active loop plan #when a v1 spawn succeeds with agent_id #then the worker is appended to the ledger and output stays silent", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "agent-7f2a" } }));

		// then
		expect(output).toBe("");
		expect(existsSync(pendingPath())).toBe(false);
		const lines = readLines(ledgerPath());
		expect(lines).toHaveLength(1);
		expect(lines[0]?.["event"]).toBe("spawned");
		expect(lines[0]?.["workerId"]).toBe("agent-7f2a");
		expect(lines[0]?.["sessionId"]).toBe("s1");
	});

	it("#given an active loop plan #when a v2 flat spawn succeeds with agent_path #then the agent path is recorded as the worker id and request metadata comes from tool_input", () => {
		// given
		writeActivePlan();

		// when
		applySpawnLedger(
			postToolUsePayload({
				tool_input: {
					task_name: "axis_web",
					agent_type: "librarian",
					message: "TASK: web axis.",
				},
				tool_response: { agent_path: "/root/axis_web", status: "running" },
			}),
		);

		// then
		const lines = readLines(ledgerPath());
		expect(lines[0]?.["workerId"]).toBe("/root/axis_web");
		expect(lines[0]?.["taskName"]).toBe("axis_web");
		expect(lines[0]?.["agentType"]).toBe("librarian");
		expect(lines[0]?.["messageHead"]).toBe("TASK: web axis.");
	});

	it("#given an active loop plan #when the response arrives as a JSON string carrying agentId #then the worker is still recorded", () => {
		// given
		writeActivePlan();

		// when
		applySpawnLedger(postToolUsePayload({ tool_response: '{"agentId":"ag-9"}' }));

		// then
		expect(readLines(ledgerPath())[0]?.["workerId"]).toBe("ag-9");
	});

	it("#given an active loop plan #when the response reports the agent thread limit and carries no worker id #then the request is queued durably and the lead is told to drain the queue", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_use_id: "tu-refused-1",
				tool_response: { error: "agent thread limit reached" },
			}),
		);

		// then
		expect(output).toContain("pending-spawns.jsonl");
		expect(output).toContain("PostToolUse");
		const lines = readLines(pendingPath());
		expect(lines).toHaveLength(1);
		expect(lines[0]?.["event"]).toBe("refused");
		expect(lines[0]?.["toolUseId"]).toBe("tu-refused-1");
		expect(JSON.stringify(lines[0]?.["toolInput"])).toContain("AXIS: swarm internals");
	});

	it("#given a thread-limit refusal #when the response is a plain error string #then the refusal is still detected", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_response: "AgentLimitReached: too many running agents",
			}),
		);

		// then
		expect(output).toContain("pending-spawns.jsonl");
		expect(readLines(pendingPath())[0]?.["event"]).toBe("refused");
	});

	it("#given a thread-limit refusal #when the error payload echoes an unrelated request id #then it is queued as refused, never recorded as spawned", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_use_id: "tu-echoed-id",
				tool_response: { id: "req_8842", error: "agent thread limit reached" },
			}),
		);

		// then
		expect(output).toContain("pending-spawns.jsonl");
		expect(existsSync(ledgerPath())).toBe(false);
		expect(readLines(pendingPath())[0]?.["toolUseId"]).toBe("tu-echoed-id");
	});

	it("#given a successful spawn #when its message text happens to mention thread limits #then it is recorded as spawned, never as a refusal", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_input: {
					message: "TASK: research agent thread limit reached errors.",
				},
				tool_response: { agent_id: "ag-ok" },
			}),
		);

		// then
		expect(output).toBe("");
		expect(existsSync(pendingPath())).toBe(false);
		expect(readLines(ledgerPath())[0]?.["workerId"]).toBe("ag-ok");
	});

	it("#given an active loop plan #when the spawn fails for an unrelated reason with no id #then nothing is written and output stays silent", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(postToolUsePayload({ tool_response: { error: "invalid schema" } }));

		// then
		expect(output).toBe("");
		expect(existsSync(ledgerPath())).toBe(false);
		expect(existsSync(pendingPath())).toBe(false);
	});

	it("#given no active loop plan #when a spawn is refused by the thread limit #then nothing is written and output stays silent", () => {
		// given
		// (no goals.json)

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_response: { error: "agent thread limit reached" },
			}),
		);

		// then
		expect(output).toBe("");
		expect(existsSync(sessionDir())).toBe(false);
	});

	it("#given a non-spawn tool #when PostToolUse fires #then output stays silent and nothing is written", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedger(
			postToolUsePayload({
				tool_name: "exec_command",
				tool_response: { ok: true },
			}),
		);

		// then
		expect(output).toBe("");
		expect(existsSync(ledgerPath())).toBe(false);
	});

	it("#given an existing ledger #when another outcome lands #then the new line is appended without truncating history", () => {
		// given
		writeActivePlan();
		applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "ag-1" } }));

		// when
		applySpawnLedger(
			postToolUsePayload({
				tool_use_id: "tu-2",
				tool_response: { error: "agent thread limit reached" },
			}),
		);

		// then
		expect(readLines(ledgerPath())).toHaveLength(1);
		expect(readLines(pendingPath())).toHaveLength(1);
	});
});

describe("spawnLedgerRehydrateContext", () => {
	it("#given no durable swarm state #when rehydrate runs #then the context is empty", () => {
		// given
		// (no files)

		// when
		const context = applySpawnLedgerPostCompact({
			hook_event_name: "PostCompact",
			session_id: "s1",
			cwd: workDir,
			trigger: "auto",
		});

		// then
		expect(context).toBe("");
	});

	it("#given ledger and pending queue #when PostCompact fires #then the injected context carries both truths and the queue path", () => {
		// given
		writeActivePlan();
		applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "ag-1" } }));
		applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "ag-2" } }));
		applySpawnLedger(
			postToolUsePayload({
				tool_use_id: "tu-r",
				tool_response: { error: "agent thread limit reached" },
			}),
		);

		// when
		const output = applySpawnLedgerPostCompact({
			hook_event_name: "PostCompact",
			session_id: "s1",
			cwd: workDir,
			trigger: "auto",
		});

		// then
		expect(output).toContain("PostCompact");
		expect(output).toContain("ag-1");
		expect(output).toContain("ag-2");
		expect(output).toContain("pending-spawns.jsonl");
	});

	it("#given only a spawn ledger #when PostCompact fires #then the context reports the spawned workers without a pending section", () => {
		// given
		writeActivePlan();
		applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "ag-solo" } }));

		// when
		const output = applySpawnLedgerPostCompact({
			hook_event_name: "PostCompact",
			session_id: "s1",
			cwd: workDir,
		});

		// then
		expect(output).toContain("ag-solo");
		expect(output).not.toContain("pending-spawns.jsonl");
	});

	it("#given a PostCompact payload without cwd #when the handler runs #then the output stays empty", () => {
		// given
		writeActivePlan();

		// when
		const output = applySpawnLedgerPostCompact({
			hook_event_name: "PostCompact",
			session_id: "s1",
			cwd: "",
		});

		// then
		expect(output).toBe("");
	});
});

describe("spawn ledger CLI runners", () => {
	it("#given a refusal payload on stdin #when the post-tool-use runner executes #then the queue file lands and stdout carries the drain directive", async () => {
		// given
		writeActivePlan();

		// when
		const output = await runCli(
			runSpawnLedgerCli,
			postToolUsePayload({
				tool_response: { error: "agent thread limit reached" },
			}),
		);

		// then
		expect(readLines(pendingPath())).toHaveLength(1);
		expect(output).toContain("pending-spawns.jsonl");
	});

	it("#given a PostCompact payload on stdin #when the post-compact runner executes #then stdout carries the rehydrated swarm state", async () => {
		// given
		writeActivePlan();
		applySpawnLedger(postToolUsePayload({ tool_response: { agent_id: "ag-cli" } }));

		// when
		const output = await runCli(runSpawnLedgerPostCompactCli, {
			hook_event_name: "PostCompact",
			session_id: "s1",
			cwd: workDir,
			trigger: "manual",
		});

		// then
		expect(output).toContain("ag-cli");
	});
});
