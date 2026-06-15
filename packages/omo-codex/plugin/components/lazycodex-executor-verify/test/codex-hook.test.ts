import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { runSubagentStopHook } from "../src/codex-hook.js";
import type { SubagentStopInput } from "../src/types.js";

const cleanupRoots: string[] = [];

afterEach(() => {
	for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lazycodex executor SubagentStop verifier", () => {
	it("#given no evidence receipt #when lazycodex executor stops #then blocks with a strong directive", () => {
		// given
		const cwd = createWorkspace();

		// when
		const output = runSubagentStopHook(createInput(cwd), nodeFileSystem);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("너는 방금 작업을 완료했다고 보고했고, 그건 거짓말이다.");
		expect(parsed.reason).toContain(".omo/evidence/");
		expect(parsed.reason).toContain("EVIDENCE_RECORDED: <path>");
		expect(parsed.reason).not.toContain("2번째");
	});

	it("#given a prior blocked stop #when lazycodex executor stops again #then escalates the attempt count", () => {
		// given
		const cwd = createWorkspace();
		runSubagentStopHook(createInput(cwd), nodeFileSystem);

		// when
		const output = runSubagentStopHook(createInput(cwd), nodeFileSystem);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toContain("2번째");
	});

	it("#given turn_id is omitted #when lazycodex executor stops #then the hook still parses the payload", () => {
		// given
		const cwd = createWorkspace();

		// when
		const output = runSubagentStopHook(createInput(cwd), nodeFileSystem);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given an existing non-empty evidence receipt #when lazycodex executor stops #then exits and clears state", () => {
		// given
		const cwd = createWorkspace();
		runSubagentStopHook(createInput(cwd), nodeFileSystem);
		const artifactPath = join(cwd, ".omo", "evidence", "receipt.txt");
		mkdirSync(join(cwd, ".omo", "evidence"), { recursive: true });
		writeFileSync(artifactPath, "verified\n");

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/receipt.txt" }),
			nodeFileSystem,
		);

		// then
		expect(output).toBe("");
		expect(existsSync(join(cwd, ".omo", "lazycodex-executor-verify", "sess.1-agent_1.json"))).toBe(false);
	});

	it("#given a zero-byte evidence receipt #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		const artifactPath = join(cwd, ".omo", "evidence", "empty.txt");
		mkdirSync(join(cwd, ".omo", "evidence"), { recursive: true });
		writeFileSync(artifactPath, "");

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/empty.txt" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given an evidence receipt directory inside evidence root #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		mkdirSync(join(cwd, ".omo", "evidence", "receipt-dir"), { recursive: true });

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/receipt-dir" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given an evidence receipt symlink targets outside evidence root #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		const artifactPath = join(cwd, ".omo", "evidence", "passwd-link");
		mkdirSync(join(cwd, ".omo", "evidence"), { recursive: true });
		symlinkSync(existingReceiptTargetOutsideEvidenceRoot(), artifactPath);

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/passwd-link" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given an evidence receipt traverses a symlinked evidence subdirectory #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		const outsideRoot = createWorkspace();
		const outsideReceipt = join(outsideRoot, "receipt.txt");
		const linkPath = join(cwd, ".omo", "evidence", "outside-dir");
		mkdirSync(join(cwd, ".omo", "evidence"), { recursive: true });
		writeFileSync(outsideReceipt, "outside\n");
		symlinkSync(outsideRoot, linkPath, platform === "win32" ? "junction" : "dir");

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/outside-dir/receipt.txt" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given an existing absolute receipt outside evidence root #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		const receiptPath = existingAbsoluteReceiptOutsideEvidenceRoot();

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: `done\nEVIDENCE_RECORDED: ${receiptPath}` }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given a parent traversal receipt outside cwd #when lazycodex executor stops #then blocks", () => {
		// given
		const { cwd } = createWorkspaceWithParentOutsideReceipt();

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: ../outside.txt" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given a traversal receipt escaping evidence root #when lazycodex executor stops #then blocks", () => {
		// given
		const cwd = createWorkspace();
		mkdirSync(join(cwd, ".omo"), { recursive: true });
		writeFileSync(join(cwd, ".omo", "outside.txt"), "outside\n");

		// when
		const output = runSubagentStopHook(
			createInput(cwd, { last_assistant_message: "done\nEVIDENCE_RECORDED: .omo/evidence/../outside.txt" }),
			nodeFileSystem,
		);

		// then
		expect(parseBlockOutput(output).decision).toBe("block");
	});

	it("#given three prior attempts #when lazycodex executor stops #then exits and clears stale state", () => {
		// given
		const cwd = createWorkspace();
		const stateDir = join(cwd, ".omo", "lazycodex-executor-verify");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, "sess.1-agent_1.json"), JSON.stringify({ attempts: 3 }));

		// when
		const output = runSubagentStopHook(createInput(cwd), nodeFileSystem);

		// then
		expect(output).toBe("");
		expect(existsSync(join(stateDir, "sess.1-agent_1.json"))).toBe(false);
	});

	it("#given an unrelated agent #when SubagentStop fires #then exits without output", () => {
		// given
		const cwd = createWorkspace();

		// when
		const output = runSubagentStopHook(createInput(cwd, { agent_type: "worker" }), nodeFileSystem);

		// then
		expect(output).toBe("");
	});

	it("#given malformed input and unknown event #when hook runs #then exits without output", () => {
		// given
		const cwd = createWorkspace();

		// when
		const malformedOutput = runSubagentStopHook({ hook_event_name: "SubagentStop", session_id: 123 }, nodeFileSystem);
		const unknownEventOutput = runSubagentStopHook(createUnknownEventInput(cwd), nodeFileSystem);

		// then
		expect(malformedOutput).toBe("");
		expect(unknownEventOutput).toBe("");
	});

	it("#given context pressure appears in transcript #when hook runs #then exits without output", () => {
		// given
		const cwd = createWorkspace();
		const transcriptPath = join(cwd, "transcript.jsonl");
		writeFileSync(transcriptPath, "context_length_exceeded\n");

		// when
		const output = runSubagentStopHook(createInput(cwd, { transcript_path: transcriptPath }), nodeFileSystem);

		// then
		expect(output).toBe("");
	});
});

type BlockOutput = {
	readonly decision: "block";
	readonly reason: string;
};

const nodeFileSystem = {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
};

function createWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "lazycodex-executor-verify-"));
	cleanupRoots.push(root);
	return root;
}

function createWorkspaceWithParentOutsideReceipt(): { readonly cwd: string } {
	const root = createWorkspace();
	const cwd = join(root, "project");
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(root, "outside.txt"), "outside\n");
	return { cwd };
}

function existingAbsoluteReceiptOutsideEvidenceRoot(): string {
	if (existsSync("/etc/passwd") && statSync("/etc/passwd").size > 0) return "/etc/passwd";
	return existingReceiptTargetOutsideEvidenceRoot();
}

function existingReceiptTargetOutsideEvidenceRoot(): string {
	if (existsSync("/etc/passwd") && statSync("/etc/passwd").size > 0) return "/etc/passwd";
	const root = createWorkspace();
	const receiptPath = join(root, "outside.txt");
	writeFileSync(receiptPath, "outside\n");
	return receiptPath;
}

function createInput(cwd: string, overrides: Partial<SubagentStopInput> = {}): SubagentStopInput {
	return {
		hook_event_name: "SubagentStop",
		agent_type: "lazycodex-executor",
		agent_id: "agent_1",
		session_id: "sess.1",
		cwd,
		transcript_path: "/dev/null",
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: true,
		last_assistant_message: "done!",
		...overrides,
	};
}

function createUnknownEventInput(cwd: string): Record<string, string | boolean> {
	return {
		hook_event_name: "Stop",
		agent_type: "lazycodex-executor",
		agent_id: "agent_1",
		session_id: "sess.1",
		cwd,
		transcript_path: "/dev/null",
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: true,
		last_assistant_message: "done!",
	};
}

function parseBlockOutput(output: string): BlockOutput {
	const parsed: unknown = JSON.parse(output);
	if (!isBlockOutput(parsed)) throw new Error("expected block output");
	return parsed;
}

function isBlockOutput(value: unknown): value is BlockOutput {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"decision" in value &&
		"reason" in value &&
		value.decision === "block" &&
		typeof value.reason === "string"
	);
}
