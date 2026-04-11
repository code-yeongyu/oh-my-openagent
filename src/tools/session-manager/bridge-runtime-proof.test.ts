import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "omo-bridge-runtime-proof-"));
const TEST_MESSAGE_STORAGE = join(TEST_ROOT, "message");
const TEST_PART_STORAGE = join(TEST_ROOT, "part");
const TEST_SESSION_STORAGE = join(TEST_ROOT, "session");
const TEST_TODO_DIR = join(TEST_ROOT, "todos");
const TEST_TRANSCRIPT_DIR = join(TEST_ROOT, "transcripts");
const GENERATED_PROJECT_DIR = join(TEST_ROOT, "generated-project");

mock.module("./constants", () => ({
	OPENCODE_STORAGE: TEST_ROOT,
	MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
	PART_STORAGE: TEST_PART_STORAGE,
	SESSION_STORAGE: TEST_SESSION_STORAGE,
	TODO_DIR: TEST_TODO_DIR,
	TRANSCRIPT_DIR: TEST_TRANSCRIPT_DIR,
	SESSION_LIST_DESCRIPTION: "test",
	SESSION_READ_DESCRIPTION: "test",
	SESSION_SEARCH_DESCRIPTION: "test",
	SESSION_INFO_DESCRIPTION: "test",
	SESSION_DELETE_DESCRIPTION: "test",
	TOOL_NAME_PREFIX: "session_",
}));

mock.module("../../shared/opencode-storage-detection", () => ({
	isSqliteBackend: () => false,
	resetSqliteBackendCache: () => {},
}));

mock.module("../../shared/opencode-storage-paths", () => ({
	OPENCODE_STORAGE: TEST_ROOT,
	MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
	PART_STORAGE: TEST_PART_STORAGE,
	SESSION_STORAGE: TEST_SESSION_STORAGE,
}));

mock.module("../../shared/opencode-message-dir", () => ({
	getMessageDir: (sessionID: string) => {
		if (!sessionID.startsWith("ses_")) return null;
		if (/[/\\]|\.\./.test(sessionID)) return null;
		if (!existsSync(TEST_MESSAGE_STORAGE)) return null;

		const directPath = join(TEST_MESSAGE_STORAGE, sessionID);
		if (existsSync(directPath)) return directPath;

		return null;
	},
}));

const { createSessionManagerTools } = await import(
	`./tools?bridge-proof=${Date.now()}-${Math.random()}`
);

const mockCtx = {
	directory: GENERATED_PROJECT_DIR,
	client: undefined,
} as PluginInput;
const mockContext: ToolContext = {
	sessionID: "bridge-runtime-proof",
	messageID: "bridge-runtime-proof-msg",
	agent: "test-agent",
	directory: GENERATED_PROJECT_DIR,
	worktree: GENERATED_PROJECT_DIR,
	abort: new AbortController().signal,
	metadata: () => {},
	ask: async () => {},
};

function seedGeneratedProject(): void {
	mkdirSync(join(GENERATED_PROJECT_DIR, ".opencode"), { recursive: true });
	writeFileSync(
		join(GENERATED_PROJECT_DIR, ".opencode", "opencode.json"),
		JSON.stringify(
			{
				$schema: "https://opencode.ai/config.json",
				plugin: ["oh-my-openagent"],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(GENERATED_PROJECT_DIR, ".opencode", "oh-my-openagent.jsonc"),
		"{}\n",
	);
}

function seedBridgeRuntimeStorage(): string {
	const sessionID = "ses_bridge_runtime_smoke";
	const projectID = "proj_bridge_runtime";

	mkdirSync(join(TEST_MESSAGE_STORAGE, sessionID), { recursive: true });
	mkdirSync(join(TEST_PART_STORAGE, "msg_bridge_user"), { recursive: true });
	mkdirSync(join(TEST_PART_STORAGE, "msg_bridge_assistant"), {
		recursive: true,
	});
	mkdirSync(join(TEST_SESSION_STORAGE, projectID), { recursive: true });
	mkdirSync(TEST_TODO_DIR, { recursive: true });

	writeFileSync(
		join(TEST_SESSION_STORAGE, projectID, `${sessionID}.json`),
		JSON.stringify({
			id: sessionID,
			projectID,
			directory: GENERATED_PROJECT_DIR,
			time: { created: 1_700_000_000_000, updated: 1_700_000_000_500 },
		}),
	);

	writeFileSync(
		join(TEST_MESSAGE_STORAGE, sessionID, "msg_bridge_user.json"),
		JSON.stringify({
			id: "msg_bridge_user",
			role: "user",
			agent: "build",
			time: { created: 1_700_000_000_000 },
		}),
	);
	writeFileSync(
		join(TEST_PART_STORAGE, "msg_bridge_user", "part_001.json"),
		JSON.stringify({
			id: "part_001",
			type: "text",
			text: "Investigate bridge auth regression",
		}),
	);

	writeFileSync(
		join(TEST_MESSAGE_STORAGE, sessionID, "msg_bridge_assistant.json"),
		JSON.stringify({
			id: "msg_bridge_assistant",
			role: "assistant",
			agent: "oracle",
			time: { created: 1_700_000_000_500 },
		}),
	);
	writeFileSync(
		join(TEST_PART_STORAGE, "msg_bridge_assistant", "part_001.json"),
		JSON.stringify({
			id: "part_001",
			type: "text",
			text: "Bridge health looks stable after plugin removal",
		}),
	);

	writeFileSync(
		join(TEST_TODO_DIR, `${sessionID}.json`),
		JSON.stringify([
			{
				id: "todo_bridge",
				content: "Verify bridge runtime smoke",
				status: "completed",
				priority: "high",
			},
		]),
	);

	return sessionID;
}

describe("bridge runtime proof", () => {
	beforeEach(() => {
		if (existsSync(TEST_ROOT)) {
			rmSync(TEST_ROOT, { recursive: true, force: true });
		}
		mkdirSync(TEST_ROOT, { recursive: true });
		mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true });
		mkdirSync(TEST_PART_STORAGE, { recursive: true });
		mkdirSync(TEST_SESSION_STORAGE, { recursive: true });
		mkdirSync(TEST_TODO_DIR, { recursive: true });
		mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true });
		seedGeneratedProject();
	});

	afterAll(() => {
		mock.restore();
		rmSync(TEST_ROOT, { recursive: true, force: true });
	});

	test("generated OCK bridge artifacts work with canonical OMO session tools after plugin removal", async () => {
		const sessionID = seedBridgeRuntimeStorage();
		const tools = createSessionManagerTools(mockCtx);

		expect(
			existsSync(
				join(GENERATED_PROJECT_DIR, ".opencode", "plugin", "sessions.ts"),
			),
		).toBe(false);
		expect(
			existsSync(
				join(GENERATED_PROJECT_DIR, ".opencode", "plugin", "skill-mcp.ts"),
			),
		).toBe(false);
		expect(
			readFileSync(
				join(GENERATED_PROJECT_DIR, ".opencode", "opencode.json"),
				"utf-8",
			),
		).toContain("oh-my-openagent");
		expect(
			existsSync(
				join(GENERATED_PROJECT_DIR, ".opencode", "oh-my-openagent.jsonc"),
			),
		).toBe(true);
		expect("find_sessions" in tools).toBe(false);
		expect("read_session" in tools).toBe(false);

		const listResult = await tools.session_list.execute(
			{ project_path: GENERATED_PROJECT_DIR, limit: 5 },
			mockContext,
		);
		const searchResult = await tools.session_search.execute(
			{ query: "bridge", session_id: sessionID, limit: 5 },
			mockContext,
		);
		const readResult = await tools.session_read.execute(
			{ session_id: sessionID, include_todos: true },
			mockContext,
		);

		expect(listResult).toContain(sessionID);
		expect(searchResult).toContain(sessionID);
		expect(searchResult).toContain("bridge auth regression");
		expect(readResult).toContain("Investigate bridge auth regression");
		expect(readResult).toContain(
			"Bridge health looks stable after plugin removal",
		);
		expect(readResult).toContain("Verify bridge runtime smoke");
	});
});
